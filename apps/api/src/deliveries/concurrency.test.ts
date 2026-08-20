/**
 * Tests de conditions de course.
 *
 * Chaque test ouvre une **vraie** fenêtre de concurrence : toutes les tâches
 * lisent l'état avant qu'aucune n'écrive, grâce au point d'interleaving du
 * dépôt. Sans ça, Node exécuterait les tâches l'une après l'autre et les tests
 * passeraient même sur du code cassé.
 *
 * Correspondance avec la spécification : scénarios 1 à 8 et 10. Le scénario 9
 * (crash de la base en milieu de transaction) exige un vrai PostgreSQL qu'on
 * tue — il relève d'un test d'intégration, pas de cette suite. Ce qui est
 * vérifiable ici, en revanche, c'est que l'échec d'une transaction n'annule
 * que ses propres écritures : c'est le dernier bloc de ce fichier.
 */

import {
  eventsMatchStoredStatus,
  replayDeliveryEvents,
  tenantScope,
} from "@cbd/domain";
import { describe, expect, it } from "vitest";

import { InterleavePoint, fulfilled, runConcurrently } from "./concurrency.harness.js";
import {
  DeliveryConflictError,
  respondToAssignment,
  transitionDelivery,
} from "./service.js";
import { FakeDeliveryStore, aDelivery, anAssignment } from "./store.fake.js";

const shop = tenantScope("mer_a");
const T0 = new Date("2026-06-01T18:00:00Z");
const plus = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);

// ---------------------------------------------------------------------------
// SCÉNARIO 1 — deux drivers acceptent exactement en même temps
// ---------------------------------------------------------------------------

describe("scénario 1 — acceptation simultanée", () => {
  it("n'en laisse gagner qu'un, sous course réelle", async () => {
    const store = new FakeDeliveryStore(
      [aDelivery({ status: "OFFERING", version: 1 })],
      [
        anAssignment({ id: "asg_a", driverId: "drv_a", rank: 1, expiresAt: plus(30) }),
        anAssignment({ id: "asg_b", driverId: "drv_b", rank: 2, expiresAt: plus(30) }),
      ],
    );

    const point = new InterleavePoint();
    store.interleave = point;

    const course = runConcurrently(2, (i) =>
      respondToAssignment(store, shop, {
        assignmentId: i === 0 ? "asg_a" : "asg_b",
        driverId: i === 0 ? "drv_a" : "drv_b",
        response: "ACCEPTED",
        now: plus(5),
      }),
    );

    // Les deux ont lu l'état ; on les laisse écrire ensuite.
    await point.waitForArrivals(2);
    point.releaseAll();

    const résultats = fulfilled(await course);
    const gagnants = résultats.filter((r) => r.kind === "ACCEPTED");
    const perdants = résultats.filter((r) => r.kind === "REFUSED");

    expect(gagnants).toHaveLength(1);
    expect(perdants).toHaveLength(1);
    expect(perdants[0]).toMatchObject({ code: "DELIVERY_ALREADY_ASSIGNED" });
  });

  it("n'écrit qu'un seul ACCEPTED et un seul événement", async () => {
    const store = new FakeDeliveryStore(
      [aDelivery({ status: "OFFERING", version: 1 })],
      [
        anAssignment({ id: "asg_a", driverId: "drv_a", rank: 1, expiresAt: plus(30) }),
        anAssignment({ id: "asg_b", driverId: "drv_b", rank: 2, expiresAt: plus(30) }),
      ],
    );
    const point = new InterleavePoint();
    store.interleave = point;

    const course = runConcurrently(2, (i) =>
      respondToAssignment(store, shop, {
        assignmentId: i === 0 ? "asg_a" : "asg_b",
        driverId: i === 0 ? "drv_a" : "drv_b",
        response: "ACCEPTED",
        now: plus(5),
      }),
    );
    await point.waitForArrivals(2);
    point.releaseAll();
    await course;

    expect(store.allAssignments().filter((a) => a.status === "ACCEPTED")).toHaveLength(1);
    expect(store.eventsFor("dlv_1")).toHaveLength(1);
    expect(store.get("dlv_1")?.status).toBe("ASSIGNED");
  });
});

// ---------------------------------------------------------------------------
// SCÉNARIO 2 — acceptation contre expiration
// ---------------------------------------------------------------------------

describe("scénario 2 — acceptation et annulation concurrentes", () => {
  it("laisse passer l'une ou l'autre, jamais les deux", async () => {
    const store = new FakeDeliveryStore(
      [aDelivery({ status: "OFFERING", version: 1 })],
      [anAssignment({ id: "asg_a", driverId: "drv_a", expiresAt: plus(30) })],
    );
    const point = new InterleavePoint();
    store.interleave = point;

    const course = Promise.allSettled([
      respondToAssignment(store, shop, {
        assignmentId: "asg_a",
        driverId: "drv_a",
        response: "ACCEPTED",
        now: plus(5),
      }),
      transitionDelivery(store, shop, {
        deliveryId: "dlv_1",
        toStatus: "CANCELLED",
        actor: "admin",
        actorUserId: "usr_admin",
      }),
    ]);

    await point.waitForArrivals(2);
    point.releaseAll();
    await course;

    const statut = store.get("dlv_1")?.status;
    expect(["ASSIGNED", "CANCELLED"]).toContain(statut);

    // Un seul des deux a laissé une trace : l'autre a été rejeté par le verrou.
    expect(store.eventsFor("dlv_1")).toHaveLength(1);
    expect(store.eventsFor("dlv_1")[0]?.toStatus).toBe(statut);
  });

  it("n'assigne jamais une course déjà annulée", async () => {
    const store = new FakeDeliveryStore(
      [aDelivery({ status: "OFFERING", version: 1 })],
      [anAssignment({ id: "asg_a", driverId: "drv_a", expiresAt: plus(30) })],
    );
    const point = new InterleavePoint();
    store.interleave = point;

    const course = Promise.allSettled([
      respondToAssignment(store, shop, {
        assignmentId: "asg_a",
        driverId: "drv_a",
        response: "ACCEPTED",
        now: plus(5),
      }),
      transitionDelivery(store, shop, {
        deliveryId: "dlv_1",
        toStatus: "CANCELLED",
        actor: "admin",
        actorUserId: "usr_admin",
      }),
    ]);
    await point.waitForArrivals(2);
    // L'annulation écrit d'abord.
    point.releaseNext();
    point.releaseNext();
    await course;

    if (store.get("dlv_1")?.status === "CANCELLED") {
      expect(store.get("dlv_1")?.assignedDriverId).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// SCÉNARIO 3 — retry HTTP client
// ---------------------------------------------------------------------------

describe("scénario 3 — la même requête rejouée cinq fois", () => {
  it("ne change l'état qu'une fois et n'écrit qu'un événement", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "ASSIGNED", assignedDriverId: "drv_1" })]);

    const commande = {
      deliveryId: "dlv_1",
      toStatus: "PICKED_UP" as const,
      actor: "driver" as const,
      actorUserId: "usr_drv",
    };

    for (let i = 0; i < 5; i += 1) {
      await transitionDelivery(store, shop, commande);
    }

    expect(store.get("dlv_1")?.status).toBe("PICKED_UP");
    expect(store.eventsFor("dlv_1")).toHaveLength(1);
    // La version n'avance qu'une fois : les rejeux ne touchent pas la ligne.
    expect(store.get("dlv_1")?.version).toBe(2);
  });

  it("reste idempotent même si les rejeux arrivent en parallèle", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "ASSIGNED", assignedDriverId: "drv_1" })]);
    const point = new InterleavePoint();
    store.interleave = point;

    const course = runConcurrently(5, () =>
      transitionDelivery(store, shop, {
        deliveryId: "dlv_1",
        toStatus: "PICKED_UP",
        actor: "driver",
        actorUserId: "usr_drv",
      }),
    );

    await point.waitForArrivals(5);
    point.releaseAll();
    const résultats = await course;

    // Une seule écriture réussit ; les autres échouent proprement en conflit.
    expect(store.eventsFor("dlv_1")).toHaveLength(1);
    expect(store.get("dlv_1")?.status).toBe("PICKED_UP");

    const conflits = résultats.filter(
      (r) => r.status === "rejected" && r.reason instanceof DeliveryConflictError,
    );
    expect(conflits.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// SCÉNARIO 4 — job de worker dupliqué
// ---------------------------------------------------------------------------

describe("scénario 4 — le même job exécuté trois fois", () => {
  it("ne produit qu'une transition et aucun événement dupliqué", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "PENDING_DISPATCH" })]);
    const point = new InterleavePoint();
    store.interleave = point;

    const job = () =>
      transitionDelivery(store, shop, {
        deliveryId: "dlv_1",
        toStatus: "OFFERING",
        actor: "system",
        actorUserId: null,
      });

    const course = runConcurrently(3, job);
    await point.waitForArrivals(3);
    point.releaseAll();
    await course;

    expect(store.get("dlv_1")?.status).toBe("OFFERING");
    expect(store.eventsFor("dlv_1")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// SCÉNARIO 5 — cent drivers sur une seule course
// ---------------------------------------------------------------------------

describe("scénario 5 — cent acceptations simultanées", () => {
  it("n'en laisse aboutir qu'une, sans état corrompu", async () => {
    const propositions = Array.from({ length: 100 }, (_unused, i) =>
      anAssignment({
        id: `asg_${i}`,
        driverId: `drv_${i}`,
        rank: i + 1,
        expiresAt: plus(30),
      }),
    );

    const store = new FakeDeliveryStore(
      [aDelivery({ status: "OFFERING", version: 1 })],
      propositions,
    );
    const point = new InterleavePoint();
    store.interleave = point;

    const course = runConcurrently(100, (i) =>
      respondToAssignment(store, shop, {
        assignmentId: `asg_${i}`,
        driverId: `drv_${i}`,
        response: "ACCEPTED",
        now: plus(5),
      }),
    );

    await point.waitForArrivals(100);
    point.releaseAll();
    const résultats = fulfilled(await course);

    expect(résultats.filter((r) => r.kind === "ACCEPTED")).toHaveLength(1);
    expect(résultats.filter((r) => r.kind === "REFUSED")).toHaveLength(99);

    // L'état reste cohérent : un seul driver, un seul événement.
    expect(store.get("dlv_1")?.status).toBe("ASSIGNED");
    expect(store.allAssignments().filter((a) => a.status === "ACCEPTED")).toHaveLength(1);
    expect(store.eventsFor("dlv_1")).toHaveLength(1);

    const gagnant = store.allAssignments().find((a) => a.status === "ACCEPTED");
    expect(store.get("dlv_1")?.assignedDriverId).toBe(gagnant?.driverId);
  });
});

// ---------------------------------------------------------------------------
// SCÉNARIO 6 — double finalisation
// ---------------------------------------------------------------------------

describe("scénario 6 — driver et système finalisent ensemble", () => {
  it("ne produit qu'un seul DELIVERED", async () => {
    const store = new FakeDeliveryStore([
      aDelivery({ status: "IN_TRANSIT", assignedDriverId: "drv_1" }),
    ]);
    const point = new InterleavePoint();
    store.interleave = point;

    const course = Promise.allSettled([
      transitionDelivery(store, shop, {
        deliveryId: "dlv_1",
        toStatus: "DELIVERED",
        actor: "driver",
        actorUserId: "usr_drv",
      }),
      transitionDelivery(store, shop, {
        deliveryId: "dlv_1",
        toStatus: "DELIVERED",
        actor: "driver",
        actorUserId: "usr_drv",
      }),
    ]);

    await point.waitForArrivals(2);
    point.releaseAll();
    await course;

    expect(store.get("dlv_1")?.status).toBe("DELIVERED");
    expect(store.eventsFor("dlv_1")).toHaveLength(1);
    expect(store.auditEntries.filter((a) => a.action.endsWith("delivered"))).toHaveLength(1);
  });

  it("rend l'état final immuable après coup", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "IN_TRANSIT" })]);
    await transitionDelivery(store, shop, {
      deliveryId: "dlv_1",
      toStatus: "DELIVERED",
      actor: "driver",
      actorUserId: "usr_drv",
    });

    for (const cible of ["CANCELLED", "FAILED", "IN_TRANSIT"] as const) {
      await expect(
        transitionDelivery(store, shop, {
          deliveryId: "dlv_1",
          toStatus: cible,
          actor: "admin",
          actorUserId: "usr_admin",
        }),
      ).rejects.toThrow(DeliveryConflictError);
    }
    expect(store.eventsFor("dlv_1")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// SCÉNARIO 7 — isolation multi-tenant sous charge
// ---------------------------------------------------------------------------

describe("scénario 7 — deux tenants en parallèle", () => {
  it("ne laisse fuir aucune donnée entre shops sous concurrence", async () => {
    const shopB = tenantScope("mer_b");

    const livraisons = [
      ...Array.from({ length: 50 }, (_unused, i) =>
        aDelivery({ id: `dlv_${i}`, merchantId: "mer_a", status: "PENDING_DISPATCH" }),
      ),
      // Mêmes identifiants relatifs chez B, pour piéger un filtrage absent.
      ...Array.from({ length: 50 }, (_unused, i) =>
        aDelivery({ id: `dlv_b_${i}`, merchantId: "mer_b", status: "PENDING_DISPATCH" }),
      ),
    ];

    const store = new FakeDeliveryStore(livraisons);

    await Promise.all([
      runConcurrently(50, (i) =>
        transitionDelivery(store, shop, {
          deliveryId: `dlv_${i}`,
          toStatus: "OFFERING",
          actor: "system",
          actorUserId: null,
        }),
      ),
      runConcurrently(50, (i) =>
        transitionDelivery(store, shopB, {
          deliveryId: `dlv_b_${i}`,
          toStatus: "OFFERING",
          actor: "system",
          actorUserId: null,
        }),
      ),
    ]);

    // Chacun a fait avancer les siennes, et seulement les siennes.
    await store.runInTransaction(async (repo) => {
      const aEnCours = await repo.listByStatus(shop, "OFFERING");
      const bEnCours = await repo.listByStatus(shopB, "OFFERING");
      expect(aEnCours).toHaveLength(50);
      expect(bEnCours).toHaveLength(50);
      expect(aEnCours.every((d) => d.merchantId === "mer_a")).toBe(true);
      expect(bEnCours.every((d) => d.merchantId === "mer_b")).toBe(true);
    });
  });

  it("refuse une écriture croisée même noyée dans la charge", async () => {
    const shopB = tenantScope("mer_b");
    const store = new FakeDeliveryStore([
      aDelivery({ id: "dlv_a", merchantId: "mer_a" }),
      aDelivery({ id: "dlv_b", merchantId: "mer_b" }),
    ]);

    const résultats = await runConcurrently(20, (i) =>
      transitionDelivery(store, i % 2 === 0 ? shop : shopB, {
        // Chacun vise la livraison de l'autre.
        deliveryId: i % 2 === 0 ? "dlv_b" : "dlv_a",
        toStatus: "OFFERING",
        actor: "system",
        actorUserId: null,
      }),
    );

    expect(résultats.every((r) => r.status === "rejected")).toBe(true);
    expect(store.get("dlv_a")?.status).toBe("PENDING_DISPATCH");
    expect(store.get("dlv_b")?.status).toBe("PENDING_DISPATCH");
    expect(store.statusEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SCÉNARIO 8 + 10 — cohérence du journal et rejeu
// ---------------------------------------------------------------------------

describe("scénario 8 — cohérence journal / état sous concurrence", () => {
  it("écrit exactement un événement par changement d'état", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "PENDING_DISPATCH" })]);

    const étapes = [
      { toStatus: "OFFERING", actor: "system", actorUserId: null },
      { toStatus: "ASSIGNED", actor: "system", actorUserId: null },
      { toStatus: "PICKED_UP", actor: "driver", actorUserId: "usr_drv" },
      { toStatus: "IN_TRANSIT", actor: "driver", actorUserId: "usr_drv" },
      { toStatus: "DELIVERED", actor: "driver", actorUserId: "usr_drv" },
    ] as const;

    for (const étape of étapes) {
      // Chaque étape est tentée cinq fois en parallèle : une seule doit passer.
      const point = new InterleavePoint();
      store.interleave = point;
      const course = runConcurrently(5, () =>
        transitionDelivery(store, shop, { deliveryId: "dlv_1", ...étape }),
      );
      await point.waitForArrivals(5);
      point.releaseAll();
      await course;
      store.interleave = undefined;
    }

    const journal = store.eventsFor("dlv_1");
    expect(journal).toHaveLength(5);
    expect(journal.map((e) => e.toStatus)).toEqual(étapes.map((e) => e.toStatus));
  });

  it("laisse un journal rejouable qui redonne l'état stocké", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "PENDING_DISPATCH" })]);

    for (const étape of [
      { toStatus: "OFFERING", actor: "system", actorUserId: null },
      { toStatus: "ASSIGNED", actor: "system", actorUserId: null },
      { toStatus: "PICKED_UP", actor: "driver", actorUserId: "usr_drv" },
      { toStatus: "IN_TRANSIT", actor: "driver", actorUserId: "usr_drv" },
      { toStatus: "DELIVERED", actor: "driver", actorUserId: "usr_drv" },
    ] as const) {
      await transitionDelivery(store, shop, { deliveryId: "dlv_1", ...étape });
    }

    const journal = store.eventsFor("dlv_1").map((e, i) => ({
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      createdAt: plus(i),
    }));

    const rejeu = replayDeliveryEvents(journal);
    expect(rejeu.ok).toBe(true);
    if (rejeu.ok) expect(rejeu.finalStatus).toBe(store.get("dlv_1")?.status);
    expect(eventsMatchStoredStatus(journal, "DELIVERED")).toBe(true);
  });

  it("ne laisse aucun événement orphelin après une transition refusée", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "OFFERING" })]);

    await expect(
      transitionDelivery(store, shop, {
        deliveryId: "dlv_1",
        toStatus: "DELIVERED",
        actor: "admin",
        actorUserId: "usr_admin",
      }),
    ).rejects.toThrow();

    expect(store.statusEvents).toHaveLength(0);
    expect(store.auditEntries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Atomicité — ce que le scénario 9 vérifie sans tuer une base
// ---------------------------------------------------------------------------

describe("atomicité d'une transaction échouée", () => {
  it("n'annule que ses propres écritures, pas celles des voisines", async () => {
    const store = new FakeDeliveryStore([
      aDelivery({ id: "dlv_ok", merchantId: "mer_a", status: "PENDING_DISPATCH" }),
      aDelivery({ id: "dlv_ko", merchantId: "mer_a", status: "PENDING_DISPATCH" }),
    ]);

    await Promise.allSettled([
      transitionDelivery(store, shop, {
        deliveryId: "dlv_ok",
        toStatus: "OFFERING",
        actor: "system",
        actorUserId: null,
      }),
      // Celle-ci échoue : transition inexistante.
      transitionDelivery(store, shop, {
        deliveryId: "dlv_ko",
        toStatus: "DELIVERED",
        actor: "system",
        actorUserId: null,
      }),
    ]);

    // La réussie a tenu, l'échouée n'a rien laissé.
    expect(store.get("dlv_ok")?.status).toBe("OFFERING");
    expect(store.get("dlv_ko")?.status).toBe("PENDING_DISPATCH");
    expect(store.eventsFor("dlv_ok")).toHaveLength(1);
    expect(store.eventsFor("dlv_ko")).toHaveLength(0);
  });

  it("ne laisse jamais un état écrit sans son événement", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "IN_TRANSIT" })]);
    const point = new InterleavePoint();
    store.interleave = point;

    const course = runConcurrently(10, () =>
      transitionDelivery(store, shop, {
        deliveryId: "dlv_1",
        toStatus: "DELIVERED",
        actor: "driver",
        actorUserId: "usr_drv",
      }),
    );
    await point.waitForArrivals(10);
    point.releaseAll();
    await course;

    // Invariant global : un changement d'état ⇔ un événement.
    const journal = store.eventsFor("dlv_1").map((e, i) => ({
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      createdAt: plus(i),
    }));
    expect(eventsMatchStoredStatus(journal, store.get("dlv_1")!.status, "IN_TRANSIT")).toBe(true);
  });
});
