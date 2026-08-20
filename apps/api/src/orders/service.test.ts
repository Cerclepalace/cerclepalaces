import { OrderTransitionError, adminScope, tenantScope } from "@cbd/domain";
import { describe, expect, it } from "vitest";

import {
  OrderConflictError,
  OrderNotFoundError,
  transitionOrder,
} from "./service.js";
import { FakeOrderStore, anOrder } from "./store.fake.js";

const shop = tenantScope("mer_a");

describe("transition acceptée", () => {
  it("écrit le statut et son événement d'historique ensemble", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PAID" })]);

    const result = await transitionOrder(store, shop, {
      orderId: "ord_1",
      toStatus: "ACCEPTED",
      actor: "merchant_staff",
      actorUserId: "usr_shop",
    });

    expect(result.toStatus).toBe("ACCEPTED");
    expect(store.get("ord_1")?.status).toBe("ACCEPTED");
    expect(store.statusEvents).toHaveLength(1);
    expect(store.statusEvents[0]).toMatchObject({
      fromStatus: "PAID",
      toStatus: "ACCEPTED",
      actorRole: "merchant_staff",
      actorId: "usr_shop",
    });
  });

  it("incrémente la version à chaque écriture", async () => {
    const store = new FakeOrderStore([anOrder({ status: "ACCEPTED", version: 4 })]);
    await transitionOrder(store, shop, {
      orderId: "ord_1",
      toStatus: "PREPARING",
      actor: "merchant_owner",
      actorUserId: "usr_shop",
    });
    expect(store.get("ord_1")?.version).toBe(5);
  });

  it("enregistre la raison métier de la transition", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PREPARING" })]);
    await transitionOrder(store, shop, {
      orderId: "ord_1",
      toStatus: "READY_FOR_PICKUP",
      actor: "merchant_staff",
      actorUserId: "usr_shop",
    });
    expect(store.statusEvents[0]?.reason).toMatch(/prête/i);
  });
});

describe("transitions refusées", () => {
  it("refuse un acteur non autorisé et n'écrit rien", async () => {
    const store = new FakeOrderStore([anOrder({ status: "OUT_FOR_DELIVERY" })]);

    await expect(
      transitionOrder(store, shop, {
        orderId: "ord_1",
        toStatus: "DELIVERED",
        actor: "customer",
        actorUserId: "usr_client",
      }),
    ).rejects.toThrow(OrderTransitionError);

    expect(store.get("ord_1")?.status).toBe("OUT_FOR_DELIVERY");
    expect(store.statusEvents).toHaveLength(0);
    expect(store.auditEntries).toHaveLength(0);
  });

  it("refuse un saut d'étape même à un admin", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PAID" })]);
    await expect(
      transitionOrder(store, shop, {
        orderId: "ord_1",
        toStatus: "DELIVERED",
        actor: "admin",
        actorUserId: "usr_admin",
      }),
    ).rejects.toThrow(OrderTransitionError);
    expect(store.get("ord_1")?.status).toBe("PAID");
  });

  it("refuse toute transition depuis un état terminal", async () => {
    const store = new FakeOrderStore([anOrder({ status: "DELIVERED" })]);
    await expect(
      transitionOrder(store, shop, {
        orderId: "ord_1",
        toStatus: "CANCELLED",
        actor: "admin",
        actorUserId: "usr_admin",
      }),
    ).rejects.toThrow(OrderConflictError);
  });

  it("signale une commande inexistante", async () => {
    const store = new FakeOrderStore([]);
    await expect(
      transitionOrder(store, shop, {
        orderId: "inconnu",
        toStatus: "ACCEPTED",
        actor: "merchant_owner",
        actorUserId: "usr_shop",
      }),
    ).rejects.toThrow(OrderNotFoundError);
  });

  it("refuse un acteur système porteur d'un utilisateur", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PENDING_PAYMENT" })]);
    await expect(
      transitionOrder(store, shop, {
        orderId: "ord_1",
        toStatus: "PAID",
        actor: "system",
        actorUserId: "usr_client",
      }),
    ).rejects.toThrow(/système/i);
  });
});

describe("écritures concurrentes", () => {
  it("rejette la seconde écriture au lieu d'écraser la première", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PAID", version: 1 })]);
    // Quelqu'un d'autre écrit entre la lecture et l'écriture.
    store.onBeforeUpdate = (orderId) => store.bumpVersion(orderId);

    await expect(
      transitionOrder(store, shop, {
        orderId: "ord_1",
        toStatus: "ACCEPTED",
        actor: "merchant_owner",
        actorUserId: "usr_shop",
      }),
    ).rejects.toThrow(OrderConflictError);

    expect(store.statusEvents).toHaveLength(0);
  });
});

describe("idempotence", () => {
  it("ne produit pas de second événement quand un webhook est rejoué", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PENDING_PAYMENT" })]);

    const command = {
      orderId: "ord_1",
      toStatus: "PAID" as const,
      actor: "system" as const,
      actorUserId: null,
    };

    await transitionOrder(store, shop, command);
    await transitionOrder(store, shop, command);
    await transitionOrder(store, shop, command);

    expect(store.get("ord_1")?.status).toBe("PAID");
    expect(store.statusEvents).toHaveLength(1);
  });
});

describe("traçabilité", () => {
  it("audite une escalade en incident, sans y voir un remboursement", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PREPARING" })]);

    const result = await transitionOrder(store, shop, {
      orderId: "ord_1",
      toStatus: "INCIDENT",
      actor: "admin",
      actorUserId: "usr_admin",
    });

    // Un incident est une escalade : la question du remboursement se pose
    // quand il se referme, pas quand il s'ouvre.
    expect(result.refundDecisionRequired).toBe(false);
    expect(store.auditEntries).toHaveLength(1);
    expect(store.auditEntries[0]).toMatchObject({
      actorUserId: "usr_admin",
      targetType: "Order",
      targetId: "ord_1",
    });
  });

  it("signale le remboursement quand l'incident se referme en annulation", async () => {
    const store = new FakeOrderStore([anOrder({ status: "INCIDENT" })]);

    const result = await transitionOrder(store, shop, {
      orderId: "ord_1",
      toStatus: "CANCELLED",
      actor: "admin",
      actorUserId: "usr_admin",
    });

    expect(result.refundDecisionRequired).toBe(true);
    expect(store.auditEntries[0]?.metadata).toMatchObject({ refundDecisionRequired: true });
  });

  it("n'audite pas une étape ordinaire du chemin nominal", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PAID" })]);
    await transitionOrder(store, shop, {
      orderId: "ord_1",
      toStatus: "ACCEPTED",
      actor: "merchant_owner",
      actorUserId: "usr_shop",
    });
    expect(store.auditEntries).toHaveLength(0);
    expect(store.statusEvents).toHaveLength(1);
  });

  it("audite une livraison confirmée", async () => {
    const store = new FakeOrderStore([anOrder({ status: "OUT_FOR_DELIVERY" })]);
    await transitionOrder(store, shop, {
      orderId: "ord_1",
      toStatus: "DELIVERED",
      actor: "driver",
      actorUserId: "usr_coursier",
    });
    expect(store.auditEntries).toHaveLength(1);
  });

  it("ne signale pas de remboursement avant encaissement", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PENDING_PAYMENT" })]);
    const result = await transitionOrder(store, shop, {
      orderId: "ord_1",
      toStatus: "CANCELLED",
      actor: "customer",
      actorUserId: "usr_client",
    });
    expect(result.refundDecisionRequired).toBe(false);
  });
});

describe("parcours complet", () => {
  it("déroule une commande du paiement à la livraison", async () => {
    const store = new FakeOrderStore([anOrder({ status: "PENDING_PAYMENT" })]);

    const étapes = [
      { toStatus: "PAID", actor: "system", actorUserId: null },
      { toStatus: "ACCEPTED", actor: "merchant_staff", actorUserId: "usr_shop" },
      { toStatus: "PREPARING", actor: "merchant_staff", actorUserId: "usr_shop" },
      { toStatus: "READY_FOR_PICKUP", actor: "merchant_staff", actorUserId: "usr_shop" },
      { toStatus: "DRIVER_ASSIGNED", actor: "system", actorUserId: null },
      { toStatus: "PICKED_UP", actor: "driver", actorUserId: "usr_coursier" },
      { toStatus: "OUT_FOR_DELIVERY", actor: "driver", actorUserId: "usr_coursier" },
      { toStatus: "DELIVERED", actor: "driver", actorUserId: "usr_coursier" },
    ] as const;

    for (const étape of étapes) {
      await transitionOrder(store, shop, { orderId: "ord_1", ...étape });
    }

    expect(store.get("ord_1")?.status).toBe("DELIVERED");
    expect(store.statusEvents).toHaveLength(8);
    // L'historique reconstitue la commande dans l'ordre, sans trou.
    expect(store.statusEvents.map((e) => e.toStatus)).toEqual(étapes.map((e) => e.toStatus));
  });
});

// Isolation multi-tenant sur les commandes : même exigence que sur les
// livraisons, vérifiée séparément parce qu'elle passe par un autre dépôt.
describe("isolation multi-tenant", () => {
  const shopB = tenantScope("mer_b");

  const deuxShops = () =>
    new FakeOrderStore([
      anOrder({ id: "ord_a", merchantId: "mer_a" }),
      anOrder({ id: "ord_b", merchantId: "mer_b" }),
    ]);

  it("ne lit jamais la commande d'un autre tenant", async () => {
    const store = deuxShops();
    await store.runInTransaction(async (repo) => {
      expect(await repo.findById(shop, "ord_b")).toBeNull();
      expect(await repo.findById(shopB, "ord_a")).toBeNull();
      expect((await repo.findById(shop, "ord_a"))?.id).toBe("ord_a");
    });
  });

  it("refuse une transition sur la commande d'un autre tenant", async () => {
    const store = deuxShops();

    await expect(
      transitionOrder(store, shop, {
        orderId: "ord_b",
        toStatus: "ACCEPTED",
        actor: "merchant_owner",
        actorUserId: "usr_shop",
      }),
    ).rejects.toThrow(OrderNotFoundError);

    expect(store.get("ord_b")?.status).toBe("PAID");
    expect(store.statusEvents).toHaveLength(0);
  });

  it("ne distingue pas « inexistante » de « appartient à un autre »", async () => {
    const store = deuxShops();
    await store.runInTransaction(async (repo) => {
      expect(await repo.findById(shop, "ord_b")).toBeNull();
      expect(await repo.findById(shop, "ord_jamais_vue")).toBeNull();
    });
  });

  it("n'accepte pas un merchantId nu à la place du scope", async () => {
    const store = deuxShops();
    await store.runInTransaction(async (repo) => {
      // @ts-expect-error un objet littéral n'est pas un TenantScope
      await repo.findById({ merchantId: "mer_b" }, "ord_b");
      // @ts-expect-error le scope n'est jamais optionnel
      await repo.findById("ord_a");
    });
  });

  it("réserve l'accès inter-tenant à une méthode nommée", async () => {
    const store = deuxShops();
    await store.runInTransaction(async (repo) => {
      expect((await repo.findForAdmin(adminScope("usr_admin"), "ord_b"))?.id).toBe("ord_b");
      // @ts-expect-error un TenantScope n'est pas un AdminScope
      await repo.findForAdmin(shop, "ord_b");
    });
  });
});
