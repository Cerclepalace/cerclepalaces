/**
 * Isolation multi-tenant.
 *
 * Ces tests sont la contrepartie exécutable de la décision d'architecture : la
 * frontière de tenant V1 est le repository, pas la base. Sans eux, « repository
 * scopé » resterait une intention.
 */

import { adminScope, tenantScope } from "@cbd/domain";
import { describe, expect, it } from "vitest";

import { DeliveryNotFoundError, transitionDelivery } from "./service.js";
import { FakeDeliveryStore, aDelivery } from "./store.fake.js";

const shopA = tenantScope("mer_a");
const shopB = tenantScope("mer_b");

const deuxShops = () =>
  new FakeDeliveryStore([
    aDelivery({ id: "dlv_a", merchantId: "mer_a", orderId: "ord_a" }),
    aDelivery({ id: "dlv_b", merchantId: "mer_b", orderId: "ord_b" }),
  ]);

// TEST A / TEST 8 de la mission.
describe("un shop ne lit jamais les données d'un autre", () => {
  it("renvoie null pour une livraison d'un autre tenant", async () => {
    const store = deuxShops();
    await store.runInTransaction(async (repo) => {
      expect(await repo.findById(shopA, "dlv_b")).toBeNull();
      expect(await repo.findById(shopB, "dlv_a")).toBeNull();
    });
  });

  it("trouve bien sa propre livraison", async () => {
    const store = deuxShops();
    await store.runInTransaction(async (repo) => {
      expect((await repo.findById(shopA, "dlv_a"))?.id).toBe("dlv_a");
      expect((await repo.findById(shopB, "dlv_b"))?.id).toBe("dlv_b");
    });
  });

  it("ne distingue pas « inexistante » de « appartient à un autre »", async () => {
    const store = deuxShops();
    await store.runInTransaction(async (repo) => {
      // Les deux renvoient null : sinon on pourrait énumérer les livraisons
      // des concurrents par différence de réponse.
      expect(await repo.findById(shopA, "dlv_b")).toBeNull();
      expect(await repo.findById(shopA, "dlv_inexistante")).toBeNull();
    });
  });

  it("exclut les livraisons d'autrui des listes", async () => {
    const store = deuxShops();
    await store.runInTransaction(async (repo) => {
      const listeA = await repo.listByStatus(shopA, "PENDING_DISPATCH");
      expect(listeA.map((d) => d.id)).toEqual(["dlv_a"]);
      expect(listeA.every((d) => d.merchantId === "mer_a")).toBe(true);
    });
  });
});

// TEST B de la mission.
describe("un shop ne modifie jamais les données d'un autre", () => {
  it("refuse une transition sur la livraison d'autrui", async () => {
    const store = deuxShops();

    await expect(
      transitionDelivery(store, shopA, {
        deliveryId: "dlv_b",
        toStatus: "OFFERING",
        actor: "system",
        actorUserId: null,
      }),
    ).rejects.toThrow(DeliveryNotFoundError);

    // La livraison de B est intacte, et rien n'a été journalisé.
    expect(store.get("dlv_b")?.status).toBe("PENDING_DISPATCH");
    expect(store.get("dlv_b")?.version).toBe(1);
    expect(store.statusEvents).toHaveLength(0);
  });

  it("laisse chaque shop agir sur sa propre livraison", async () => {
    const store = deuxShops();

    await transitionDelivery(store, shopA, {
      deliveryId: "dlv_a",
      toStatus: "OFFERING",
      actor: "system",
      actorUserId: null,
    });

    expect(store.get("dlv_a")?.status).toBe("OFFERING");
    expect(store.get("dlv_b")?.status).toBe("PENDING_DISPATCH");
  });

  it("refuse une écriture directe de statut hors scope", async () => {
    const store = deuxShops();
    await store.runInTransaction(async (repo) => {
      const écrit = await repo.updateStatus(shopA, {
        deliveryId: "dlv_b",
        expectedVersion: 1,
        toStatus: "CANCELLED",
      });
      expect(écrit).toBe(false);
    });
    expect(store.get("dlv_b")?.status).toBe("PENDING_DISPATCH");
  });
});

// TEST C de la mission.
describe("propositions et journaux restent cloisonnés", () => {
  it("ne rend aucune proposition d'un autre tenant", async () => {
    const store = new FakeDeliveryStore(
      [aDelivery({ id: "dlv_b", merchantId: "mer_b" })],
      [
        {
          id: "asg_b",
          deliveryId: "dlv_b",
          driverId: "drv_1",
          status: "OFFERED",
          rank: 1,
          offeredAt: new Date("2026-06-01T18:00:00Z"),
          expiresAt: new Date("2026-06-01T18:00:30Z"),
        },
      ],
    );

    await store.runInTransaction(async (repo) => {
      expect(await repo.listAssignments(shopA, "dlv_b")).toHaveLength(0);
      expect(await repo.findAssignmentById(shopA, "asg_b")).toBeNull();
      // Le vrai propriétaire, lui, la voit.
      expect(await repo.findAssignmentById(shopB, "asg_b")).not.toBeNull();
    });
  });

  it("refuse d'écrire un journal de dispatch hors scope", async () => {
    const store = deuxShops();
    await expect(
      store.runInTransaction(async (repo) => {
        await repo.recordDispatchRound(shopA, {
          deliveryId: "dlv_b",
          roundNumber: 1,
          startedAt: new Date(),
          decisions: [],
        });
      }),
    ).rejects.toThrow(/hors scope/);
    expect(store.rounds).toHaveLength(0);
  });
});

// TEST F de la mission.
describe("accès administrateur", () => {
  it("passe par une méthode explicitement nommée", async () => {
    const store = deuxShops();
    const admin = adminScope("usr_admin");

    await store.runInTransaction(async (repo) => {
      expect((await repo.findForAdmin(admin, "dlv_a"))?.id).toBe("dlv_a");
      expect((await repo.findForAdmin(admin, "dlv_b"))?.id).toBe("dlv_b");
    });
  });

  it("ne peut pas être atteint avec un TenantScope", async () => {
    const store = deuxShops();
    await store.runInTransaction(async (repo) => {
      // @ts-expect-error un TenantScope n'est pas un AdminScope
      await repo.findForAdmin(shopA, "dlv_b");
    });
  });

  it("ne donne aucun bypass implicite : findById reste scopé même pour un admin", async () => {
    const store = deuxShops();
    await store.runInTransaction(async (repo) => {
      // @ts-expect-error un AdminScope n'est pas un TenantScope
      await repo.findById(adminScope("usr_admin"), "dlv_b");
    });
  });
});

// TEST E de la mission.
describe("le scope n'est pas contournable au typage", () => {
  it("refuse un merchantId nu à la place du scope", async () => {
    const store = deuxShops();
    await store.runInTransaction(async (repo) => {
      // @ts-expect-error un objet littéral n'est pas un TenantScope
      await repo.findById({ merchantId: "mer_b" }, "dlv_b");
      // @ts-expect-error une chaîne n'est pas un TenantScope
      await repo.findById("mer_b", "dlv_b");
    });
  });

  it("n'offre aucune variante sans scope", async () => {
    const store = deuxShops();
    await store.runInTransaction(async (repo) => {
      // @ts-expect-error le scope n'est jamais optionnel
      await repo.findById("dlv_a");
    });
  });
});

// TEST G de la mission.
describe("un driver ne franchit pas la frontière de tenant", () => {
  it("ne peut pas atteindre une livraison d'un autre shop via son identité", async () => {
    // Un driver travaillant pour plusieurs shops passe toujours par le
    // TenantScope de la livraison concernée. Son identité de driver n'ouvre
    // aucune porte : le dépôt ne l'interroge jamais.
    const store = new FakeDeliveryStore([
      aDelivery({ id: "dlv_a", merchantId: "mer_a", assignedDriverId: "drv_1" }),
      aDelivery({ id: "dlv_b", merchantId: "mer_b", assignedDriverId: "drv_1" }),
    ]);

    await store.runInTransaction(async (repo) => {
      // Même driver assigné des deux côtés, mais chaque lecture reste scopée.
      expect((await repo.findById(shopA, "dlv_a"))?.assignedDriverId).toBe("drv_1");
      expect(await repo.findById(shopA, "dlv_b")).toBeNull();
      expect((await repo.findById(shopB, "dlv_b"))?.assignedDriverId).toBe("drv_1");
      expect(await repo.findById(shopB, "dlv_a")).toBeNull();
    });
  });
});
