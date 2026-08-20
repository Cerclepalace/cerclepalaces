import {
  DEFAULT_DISPATCH_POLICY,
  DeliveryTransitionError,
  tenantScope,
  type Assignment,
  type DispatchState,
  type DriverCandidate,
} from "@cbd/domain";
import { describe, expect, it } from "vitest";

import {
  DeliveryConflictError,
  DeliveryNotFoundError,
  respondToAssignment,
  runDispatchRound,
  transitionDelivery,
} from "./service.js";
import { FakeDeliveryStore, aDelivery, anAssignment } from "./store.fake.js";
import type { DeliverySnapshot } from "./repository.js";

const shop = tenantScope("mer_a");
const T0 = new Date("2026-06-01T18:00:00Z");
const plus = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);

const pickup = { lat: 48.8674, lng: 2.3636 };

const driver = (overrides: Partial<DriverCandidate> = {}): DriverCandidate => ({
  driverId: "drv_1",
  verification: "APPROVED",
  availability: "ONLINE",
  zoneIds: ["paris-centre"],
  position: { lat: 48.8687, lng: 2.3653 },
  activeDeliveries: 0,
  supportedCategories: ["standard"],
  ...overrides,
});

const buildState =
  (candidates: readonly DriverCandidate[], roundNumber = 0) =>
  (delivery: DeliverySnapshot, assignments: readonly Assignment[]): DispatchState => ({
    deliveryId: delivery.id,
    deliveryStatus: delivery.status,
    pickup,
    pickupZoneId: delivery.pickupZoneId ?? "paris-centre",
    category: "standard",
    roundNumber,
    candidates,
    assignments,
    policy: DEFAULT_DISPATCH_POLICY,
  });

describe("transition de livraison", () => {
  it("écrit le statut et son historique ensemble", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "ASSIGNED", assignedDriverId: "drv_1" })]);

    const résultat = await transitionDelivery(store, shop, {
      deliveryId: "dlv_1",
      toStatus: "PICKED_UP",
      actor: "driver",
      actorUserId: "usr_drv",
    });

    expect(résultat.toStatus).toBe("PICKED_UP");
    expect(store.get("dlv_1")?.status).toBe("PICKED_UP");
    expect(store.statusEvents).toHaveLength(1);
    expect(store.statusEvents[0]).toMatchObject({ fromStatus: "ASSIGNED", toStatus: "PICKED_UP" });
  });

  it("refuse un acteur non autorisé et n'écrit rien", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "IN_TRANSIT" })]);

    await expect(
      transitionDelivery(store, shop, {
        deliveryId: "dlv_1",
        toStatus: "DELIVERED",
        actor: "merchant_owner",
        actorUserId: "usr_shop",
      }),
    ).rejects.toThrow(DeliveryTransitionError);

    expect(store.get("dlv_1")?.status).toBe("IN_TRANSIT");
    expect(store.statusEvents).toHaveLength(0);
  });

  // TEST 9 de la mission, au niveau service.
  it("refuse toute transition depuis un état terminal", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "DELIVERED" })]);
    await expect(
      transitionDelivery(store, shop, {
        deliveryId: "dlv_1",
        toStatus: "CANCELLED",
        actor: "admin",
        actorUserId: "usr_admin",
      }),
    ).rejects.toThrow(DeliveryConflictError);
  });

  it("signale une livraison inexistante", async () => {
    const store = new FakeDeliveryStore([]);
    await expect(
      transitionDelivery(store, shop, {
        deliveryId: "inconnue",
        toStatus: "OFFERING",
        actor: "system",
        actorUserId: null,
      }),
    ).rejects.toThrow(DeliveryNotFoundError);
  });

  it("est idempotente", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "PENDING_DISPATCH" })]);
    const commande = {
      deliveryId: "dlv_1",
      toStatus: "OFFERING" as const,
      actor: "system" as const,
      actorUserId: null,
    };
    await transitionDelivery(store, shop, commande);
    await transitionDelivery(store, shop, commande);
    expect(store.statusEvents).toHaveLength(1);
  });

  it("rejette une écriture concurrente au lieu de l'écraser", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "ASSIGNED" })]);
    store.onBeforeUpdate = (id) => store.bumpVersion(id);

    await expect(
      transitionDelivery(store, shop, {
        deliveryId: "dlv_1",
        toStatus: "PICKED_UP",
        actor: "driver",
        actorUserId: "usr_drv",
      }),
    ).rejects.toThrow(DeliveryConflictError);
    expect(store.statusEvents).toHaveLength(0);
  });

  it("audite les issues sensibles, pas les étapes ordinaires", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "IN_TRANSIT" })]);
    await transitionDelivery(store, shop, {
      deliveryId: "dlv_1",
      toStatus: "DELIVERED",
      actor: "driver",
      actorUserId: "usr_drv",
    });
    expect(store.auditEntries).toHaveLength(1);

    const store2 = new FakeDeliveryStore([aDelivery({ status: "PICKED_UP" })]);
    await transitionDelivery(store2, shop, {
      deliveryId: "dlv_1",
      toStatus: "IN_TRANSIT",
      actor: "driver",
      actorUserId: "usr_drv",
    });
    expect(store2.auditEntries).toHaveLength(0);
  });
});

describe("tour de dispatch", () => {
  it("crée une proposition et passe la livraison en OFFERING", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "PENDING_DISPATCH" })]);

    const résultat = await runDispatchRound(store, shop, {
      deliveryId: "dlv_1",
      buildState: buildState([driver()]),
      now: T0,
    });

    expect(résultat).toEqual({ kind: "OFFERS_CREATED", offered: ["drv_1"] });
    expect(store.get("dlv_1")?.status).toBe("OFFERING");
    expect(store.allAssignments()).toHaveLength(1);
    expect(store.allAssignments()[0]).toMatchObject({ driverId: "drv_1", status: "OFFERED" });
  });

  it("journalise chaque décision, retenue comme écartée", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "PENDING_DISPATCH" })]);

    await runDispatchRound(store, shop, {
      deliveryId: "dlv_1",
      buildState: buildState([
        driver({ driverId: "retenu" }),
        driver({ driverId: "hors_ligne", availability: "OFFLINE" }),
        driver({ driverId: "hors_zone", zoneIds: ["lyon"] }),
      ]),
      now: T0,
    });

    expect(store.rounds).toHaveLength(1);
    const décisions = store.rounds[0]?.decisions ?? [];
    expect(décisions).toHaveLength(3);
    const parDriver = new Map(décisions.map((d) => [d.driverId, d]));
    expect(parDriver.get("retenu")?.reason).toBe("OFFER_CREATED");
    expect(parDriver.get("hors_ligne")?.reason).toBe("DRIVER_OFFLINE");
    expect(parDriver.get("hors_zone")?.reason).toBe("OUTSIDE_ZONE");
  });

  it("attend tant qu'une proposition est vivante", async () => {
    const store = new FakeDeliveryStore(
      [aDelivery({ status: "OFFERING" })],
      [anAssignment({ expiresAt: plus(30) })],
    );

    const résultat = await runDispatchRound(store, shop, {
      deliveryId: "dlv_1",
      buildState: buildState([driver({ driverId: "drv_2" })], 1),
      now: plus(10),
    });

    expect(résultat.kind).toBe("WAITING");
    expect(store.allAssignments()).toHaveLength(1);
  });

  // TEST 2 de la mission, au niveau service.
  it("marque EXPIRED une proposition dépassée", async () => {
    const store = new FakeDeliveryStore(
      [aDelivery({ status: "OFFERING" })],
      [anAssignment({ expiresAt: plus(30) })],
    );

    const résultat = await runDispatchRound(store, shop, {
      deliveryId: "dlv_1",
      buildState: buildState([driver({ driverId: "drv_2" })], 1),
      now: plus(45),
    });

    expect(résultat).toEqual({ kind: "EXPIRED", assignmentIds: ["asg_1"] });
    expect(store.getAssignment("asg_1")?.status).toBe("EXPIRED");
  });

  // TEST 3 de la mission : réassignation, historique conservé.
  it("propose au driver suivant sans effacer la tentative précédente", async () => {
    const store = new FakeDeliveryStore(
      [aDelivery({ status: "OFFERING" })],
      [anAssignment({ id: "asg_1", driverId: "drv_1", status: "EXPIRED" })],
    );

    await runDispatchRound(store, shop, {
      deliveryId: "dlv_1",
      buildState: buildState(
        [driver({ driverId: "drv_1" }), driver({ driverId: "drv_2", position: { lat: 48.87, lng: 2.37 } })],
        1,
      ),
      now: plus(60),
    });

    const propositions = store.allAssignments();
    expect(propositions).toHaveLength(2);
    // L'ancienne reste, avec son statut.
    expect(propositions.find((a) => a.id === "asg_1")?.status).toBe("EXPIRED");
    // La nouvelle vise un autre driver : drv_1 a déjà été sollicité.
    const nouvelle = propositions.find((a) => a.id !== "asg_1");
    expect(nouvelle?.driverId).toBe("drv_2");
    expect(nouvelle?.status).toBe("OFFERED");
  });

  it("s'épuise quand plus personne n'est éligible", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "PENDING_DISPATCH" })]);
    const résultat = await runDispatchRound(store, shop, {
      deliveryId: "dlv_1",
      buildState: buildState([driver({ availability: "OFFLINE" })]),
      now: T0,
    });
    expect(résultat.kind).toBe("EXHAUSTED");
    // Le tour vide est quand même journalisé : « personne n'était disponible »
    // est une information, pas un silence.
    expect(store.rounds).toHaveLength(1);
  });

  it("ne dispatche pas une livraison déjà assignée", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "ASSIGNED", assignedDriverId: "drv_1" })]);
    const résultat = await runDispatchRound(store, shop, {
      deliveryId: "dlv_1",
      buildState: buildState([driver({ driverId: "drv_2" })]),
      now: T0,
    });
    expect(résultat.kind).toBe("IDLE");
  });
});

describe("réponse d'un driver", () => {
  it("assigne la course quand le driver accepte", async () => {
    const store = new FakeDeliveryStore(
      [aDelivery({ status: "OFFERING" })],
      [anAssignment({ driverId: "drv_1", expiresAt: plus(30) })],
    );

    const résultat = await respondToAssignment(store, shop, {
      assignmentId: "asg_1",
      driverId: "drv_1",
      response: "ACCEPTED",
      now: plus(5),
    });

    expect(résultat).toEqual({ kind: "ACCEPTED", deliveryId: "dlv_1" });
    expect(store.get("dlv_1")?.status).toBe("ASSIGNED");
    expect(store.get("dlv_1")?.assignedDriverId).toBe("drv_1");
    expect(store.getAssignment("asg_1")?.status).toBe("ACCEPTED");
    expect(store.statusEvents).toHaveLength(1);
  });

  it("enregistre un refus sans pénalité et laisse la course ouverte", async () => {
    const store = new FakeDeliveryStore(
      [aDelivery({ status: "OFFERING" })],
      [anAssignment({ driverId: "drv_1", expiresAt: plus(30) })],
    );

    const résultat = await respondToAssignment(store, shop, {
      assignmentId: "asg_1",
      driverId: "drv_1",
      response: "REJECTED",
      rejectionReason: "trop loin",
      now: plus(5),
    });

    expect(résultat).toEqual({ kind: "REJECTED", deliveryId: "dlv_1" });
    expect(store.getAssignment("asg_1")?.status).toBe("REJECTED");
    expect(store.get("dlv_1")?.status).toBe("OFFERING");
    expect(store.get("dlv_1")?.assignedDriverId).toBeNull();
  });

  it("refuse une acceptation expirée", async () => {
    const store = new FakeDeliveryStore(
      [aDelivery({ status: "OFFERING" })],
      [anAssignment({ driverId: "drv_1", expiresAt: plus(30) })],
    );

    const résultat = await respondToAssignment(store, shop, {
      assignmentId: "asg_1",
      driverId: "drv_1",
      response: "ACCEPTED",
      now: plus(60),
    });

    expect(résultat).toMatchObject({ kind: "REFUSED", code: "OFFER_EXPIRED" });
    expect(store.get("dlv_1")?.status).toBe("OFFERING");
  });

  it("refuse une réponse venant d'un autre driver", async () => {
    const store = new FakeDeliveryStore(
      [aDelivery({ status: "OFFERING" })],
      [anAssignment({ driverId: "drv_1", expiresAt: plus(30) })],
    );

    const résultat = await respondToAssignment(store, shop, {
      assignmentId: "asg_1",
      driverId: "drv_intrus",
      response: "ACCEPTED",
      now: plus(5),
    });

    expect(résultat).toMatchObject({ kind: "REFUSED", code: "WRONG_DRIVER" });
  });

  it("ne voit pas une proposition d'un autre tenant", async () => {
    const store = new FakeDeliveryStore(
      [aDelivery({ id: "dlv_b", merchantId: "mer_b", status: "OFFERING" })],
      [anAssignment({ id: "asg_b", deliveryId: "dlv_b", expiresAt: plus(30) })],
    );

    const résultat = await respondToAssignment(store, shop, {
      assignmentId: "asg_b",
      driverId: "drv_1",
      response: "ACCEPTED",
      now: plus(5),
    });

    expect(résultat).toMatchObject({ kind: "REFUSED", code: "NOT_FOUND" });
    expect(store.get("dlv_b")?.status).toBe("OFFERING");
  });
});

// TEST 1 de la mission, au niveau service : c'est le verrou optimiste qui tranche.
describe("deux drivers acceptent simultanément", () => {
  it("n'en laisse gagner qu'un", async () => {
    const store = new FakeDeliveryStore(
      [aDelivery({ status: "OFFERING", version: 1 })],
      [
        anAssignment({ id: "asg_a", driverId: "drv_a", rank: 1, expiresAt: plus(30) }),
        anAssignment({ id: "asg_b", driverId: "drv_b", rank: 2, expiresAt: plus(30) }),
      ],
    );

    const gagnant = await respondToAssignment(store, shop, {
      assignmentId: "asg_a",
      driverId: "drv_a",
      response: "ACCEPTED",
      now: plus(5),
    });
    expect(gagnant.kind).toBe("ACCEPTED");

    const perdant = await respondToAssignment(store, shop, {
      assignmentId: "asg_b",
      driverId: "drv_b",
      response: "ACCEPTED",
      now: plus(5),
    });
    expect(perdant).toMatchObject({ kind: "REFUSED", code: "DELIVERY_ALREADY_ASSIGNED" });

    expect(store.get("dlv_1")?.assignedDriverId).toBe("drv_a");
    expect(store.allAssignments().filter((a) => a.status === "ACCEPTED")).toHaveLength(1);
  });

  it("laisse le verrou optimiste trancher une égalité parfaite", async () => {
    // Les deux lisent le même état ; une écriture concurrente s'intercale.
    const store = new FakeDeliveryStore(
      [aDelivery({ status: "OFFERING", version: 1 })],
      [anAssignment({ id: "asg_b", driverId: "drv_b", expiresAt: plus(30) })],
    );
    store.onBeforeUpdate = (id) => {
      store.bumpVersion(id);
      store.onBeforeUpdate = undefined;
    };

    const résultat = await respondToAssignment(store, shop, {
      assignmentId: "asg_b",
      driverId: "drv_b",
      response: "ACCEPTED",
      now: plus(5),
    });

    expect(résultat).toMatchObject({ kind: "REFUSED", code: "DELIVERY_ALREADY_ASSIGNED" });
    expect(store.getAssignment("asg_b")?.status).toBe("OFFERED");
  });
});
