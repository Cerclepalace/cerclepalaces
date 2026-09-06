/**
 * Régressions de l'audit forensique.
 *
 * Chaque test correspond à un finding confirmé. Ils ont été écrits **avant** le
 * correctif et échouaient tous : c'est la seule façon de savoir qu'ils testent
 * réellement quelque chose.
 */

import { tenantScope } from "@cbd/domain";
import { describe, expect, it } from "vitest";

import { InterleavePoint, runConcurrently } from "./concurrency.harness.js";
import {
  DeliveryConflictError,
  respondToAssignment,
  runDispatchRound,
  transitionDelivery,
} from "./service.js";
import { FakeDeliveryStore, aDelivery, anAssignment } from "./store.fake.js";
import { buildTestState, driver, plus } from "./test-helpers.js";

const shop = tenantScope("mer_a");

// ---------------------------------------------------------------------------
// C1 — le résultat de updateStatus était ignoré dans runDispatchRound
// ---------------------------------------------------------------------------

describe("C1 — conflit de version pendant un tour de dispatch", () => {
  it("échoue au lieu d'écrire un événement mensonger", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "PENDING_DISPATCH", version: 1 })]);
    // Quelqu'un d'autre écrit entre la lecture et l'écriture du tour.
    store.onBeforeUpdate = (id) => {
      store.bumpVersion(id);
      store.onBeforeUpdate = undefined;
    };

    await expect(
      runDispatchRound(store, shop, {
        deliveryId: "dlv_1",
        buildState: buildTestState([driver()]),
        now: plus(0),
      }),
    ).rejects.toThrow(DeliveryConflictError);

    // Rien ne subsiste : ni statut, ni événement, ni proposition.
    expect(store.get("dlv_1")?.status).toBe("PENDING_DISPATCH");
    expect(store.eventsFor("dlv_1")).toHaveLength(0);
    expect(store.allAssignments()).toHaveLength(0);
    expect(store.rounds).toHaveLength(0);
  });

  it("laisse le journal cohérent avec l'état après un tour réussi", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "PENDING_DISPATCH", version: 1 })]);

    await runDispatchRound(store, shop, {
      deliveryId: "dlv_1",
      buildState: buildTestState([driver()]),
      now: plus(0),
    });

    expect(store.get("dlv_1")?.status).toBe("OFFERING");
    expect(store.eventsFor("dlv_1").map((e) => e.toStatus)).toEqual(["OFFERING"]);
  });
});

// ---------------------------------------------------------------------------
// D1 — double dispatch sous workers concurrents
// ---------------------------------------------------------------------------

describe("D1 — deux workers dispatchent la même livraison", () => {
  it("un seul tour aboutit, l'autre est rejeté", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "PENDING_DISPATCH", version: 1 })]);
    const point = new InterleavePoint();
    store.interleave = point;

    const course = runConcurrently(2, () =>
      runDispatchRound(store, shop, {
        deliveryId: "dlv_1",
        buildState: buildTestState([driver(), driver({ driverId: "drv_2", position: { lat: 48.87, lng: 2.37 } })]),
        now: plus(0),
      }),
    );

    await point.waitForArrivals(2);
    point.releaseAll();
    const résultats = await course;

    expect(résultats.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(résultats.filter((r) => r.status === "rejected")).toHaveLength(1);

    // Un seul jeu d'offres, un seul tour journalisé, un seul événement.
    expect(store.get("dlv_1")?.status).toBe("OFFERING");
    expect(store.rounds).toHaveLength(1);
    expect(store.eventsFor("dlv_1")).toHaveLength(1);
    expect(store.allAssignments()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// C3 — la FSM était contournée par respondToAssignment
// ---------------------------------------------------------------------------

describe("C3 — acceptation depuis un état qui ne le permet pas", () => {
  it("refuse une acceptation quand la livraison n'est pas en OFFERING", async () => {
    // PENDING_DISPATCH → ASSIGNED n'existe pas dans la table de transitions.
    const store = new FakeDeliveryStore(
      [aDelivery({ status: "PENDING_DISPATCH", version: 1 })],
      [anAssignment({ driverId: "drv_1", expiresAt: plus(30) })],
    );

    const résultat = await respondToAssignment(store, shop, {
      assignmentId: "asg_1",
      driverId: "drv_1",
      response: "ACCEPTED",
      now: plus(5),
    });

    expect(résultat).toMatchObject({ kind: "REFUSED", code: "DELIVERY_NOT_OFFERING" });
    expect(store.get("dlv_1")?.status).toBe("PENDING_DISPATCH");
    expect(store.get("dlv_1")?.assignedDriverId).toBeNull();
    expect(store.eventsFor("dlv_1")).toHaveLength(0);
  });

  it("refuse une acceptation sur une livraison déjà assignée", async () => {
    const store = new FakeDeliveryStore(
      [aDelivery({ status: "ASSIGNED", assignedDriverId: "drv_autre", version: 1 })],
      [anAssignment({ driverId: "drv_1", expiresAt: plus(30) })],
    );

    const résultat = await respondToAssignment(store, shop, {
      assignmentId: "asg_1",
      driverId: "drv_1",
      response: "ACCEPTED",
      now: plus(5),
    });

    expect(résultat.kind).toBe("REFUSED");
    expect(store.get("dlv_1")?.assignedDriverId).toBe("drv_autre");
  });

  it("refuse une acceptation sur une livraison terminée", async () => {
    for (const statut of ["DELIVERED", "CANCELLED", "FAILED"] as const) {
      const store = new FakeDeliveryStore(
        [aDelivery({ status: statut, version: 1 })],
        [anAssignment({ driverId: "drv_1", expiresAt: plus(30) })],
      );
      const résultat = await respondToAssignment(store, shop, {
        assignmentId: "asg_1",
        driverId: "drv_1",
        response: "ACCEPTED",
        now: plus(5),
      });
      expect(résultat.kind, statut).toBe("REFUSED");
    }
  });
});

// ---------------------------------------------------------------------------
// C2 — la réassignation après désistement
// ---------------------------------------------------------------------------

describe("C2 — cycle complet de réassignation", () => {
  it("permet à B d'accepter après le désistement de A", async () => {
    const store = new FakeDeliveryStore([aDelivery({ status: "PENDING_DISPATCH", version: 1 })]);

    // 1. Premier tour : offre à A.
    await runDispatchRound(store, shop, {
      deliveryId: "dlv_1",
      buildState: buildTestState([driver({ driverId: "drv_a" })]),
      now: plus(0),
    });
    const offreA = store.allAssignments()[0];
    expect(offreA?.driverId).toBe("drv_a");

    // 2. A accepte.
    expect(
      (
        await respondToAssignment(store, shop, {
          assignmentId: offreA!.id,
          driverId: "drv_a",
          response: "ACCEPTED",
          now: plus(5),
        })
      ).kind,
    ).toBe("ACCEPTED");
    expect(store.get("dlv_1")?.assignedDriverId).toBe("drv_a");

    // 3. A se désiste.
    await transitionDelivery(store, shop, {
      deliveryId: "dlv_1",
      toStatus: "UNASSIGNED",
      actor: "driver",
      actorUserId: "usr_a",
    });

    // D2 : le driver désisté ne doit plus être attaché à la course.
    expect(store.get("dlv_1")?.status).toBe("UNASSIGNED");
    expect(store.get("dlv_1")?.assignedDriverId).toBeNull();

    // 4. Nouveau tour : offre à B.
    await runDispatchRound(store, shop, {
      deliveryId: "dlv_1",
      buildState: buildTestState(
        [driver({ driverId: "drv_a" }), driver({ driverId: "drv_b", position: { lat: 48.87, lng: 2.37 } })],
        1,
      ),
      now: plus(60),
    });
    const offreB = store.allAssignments().find((a) => a.driverId === "drv_b");
    expect(offreB, "drv_a a déjà été sollicité, l'offre doit aller à drv_b").toBeDefined();

    // 5. B accepte — c'est ce qui échouait avant le correctif.
    const acceptationB = await respondToAssignment(store, shop, {
      assignmentId: offreB!.id,
      driverId: "drv_b",
      response: "ACCEPTED",
      now: plus(65),
    });

    expect(acceptationB).toMatchObject({ kind: "ACCEPTED" });
    expect(store.get("dlv_1")?.status).toBe("ASSIGNED");
    expect(store.get("dlv_1")?.assignedDriverId).toBe("drv_b");
  });

  /**
   * Correction P1-01. La version initiale de ce test partait d'une livraison
   * `OFFERING` portant déjà une proposition `ACCEPTED` — un état que
   * PostgreSQL refuse (`uniq_delivery_accepted_assignment`) et que le modèle
   * corrigé ne produit plus : rendre la course clôt la proposition du driver
   * libéré. Le fait « A avait accepté » n'est pas effacé pour autant, il est
   * daté et clos.
   */
  it("clôt la proposition de A sans effacer son passage", async () => {
    const store = new FakeDeliveryStore(
      [aDelivery({ status: "ASSIGNED", assignedDriverId: "drv_a", version: 1 })],
      [
        anAssignment({ id: "asg_a", driverId: "drv_a", status: "ACCEPTED" }),
        anAssignment({ id: "asg_b", driverId: "drv_b", rank: 2, expiresAt: plus(30) }),
      ],
    );

    // A rend la course.
    await transitionDelivery(store, shop, {
      deliveryId: "dlv_1",
      toStatus: "UNASSIGNED",
      actor: "driver",
      actorUserId: "usr_a",
    });

    // Les deux propositions vivantes sont closes : celle de A, acceptée, et
    // celle de B, encore ouverte sur une course qui n'existe plus sous cette
    // forme.
    expect(store.getAssignment("asg_a")?.status).toBe("CANCELLED");
    expect(store.getAssignment("asg_b")?.status).toBe("CANCELLED");
    // La ligne de A reste, avec son driver : l'historique est lisible.
    expect(store.getAssignment("asg_a")?.driverId).toBe("drv_a");

    // La course repart, B est resollicité et accepte : une acceptation passée
    // ne verrouille rien.
    await transitionDelivery(store, shop, {
      deliveryId: "dlv_1",
      toStatus: "OFFERING",
      actor: "system",
      actorUserId: null,
    });
    const nouvelle = store.addAssignment(
      anAssignment({ id: "asg_b2", driverId: "drv_b", rank: 3, expiresAt: plus(120) }),
    );

    const acceptation = await respondToAssignment(store, shop, {
      assignmentId: nouvelle.id,
      driverId: "drv_b",
      response: "ACCEPTED",
      now: plus(60),
    });

    expect(acceptation).toMatchObject({ kind: "ACCEPTED" });
    expect(store.get("dlv_1")?.assignedDriverId).toBe("drv_b");
    // Invariant tenu par l'index partiel : une seule acceptation vivante.
    expect(
      store.allAssignments().filter((assignment) => assignment.status === "ACCEPTED"),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// D2 — assignedDriverId doit être libéré
// ---------------------------------------------------------------------------

describe("D2 — libération du driver", () => {
  it("détache le driver sur UNASSIGNED même sans le demander", async () => {
    const store = new FakeDeliveryStore([
      aDelivery({ status: "ASSIGNED", assignedDriverId: "drv_1", version: 1 }),
    ]);

    await transitionDelivery(store, shop, {
      deliveryId: "dlv_1",
      toStatus: "UNASSIGNED",
      actor: "driver",
      actorUserId: "usr_drv",
    });

    expect(store.get("dlv_1")?.assignedDriverId).toBeNull();
  });

  it("détache le driver sur les états terminaux d'échec", async () => {
    // Chaque cas part d'un état d'où la transition existe réellement :
    // `PICKED_UP → CANCELLED` n'est pas dans la table, seul `FAILED` l'est.
    const cas = [
      { depuis: "ASSIGNED", vers: "CANCELLED" },
      { depuis: "PICKED_UP", vers: "FAILED" },
      { depuis: "IN_TRANSIT", vers: "FAILED" },
    ] as const;

    for (const { depuis, vers } of cas) {
      const store = new FakeDeliveryStore([
        aDelivery({ status: depuis, assignedDriverId: "drv_1", version: 1 }),
      ]);
      await transitionDelivery(store, shop, {
        deliveryId: "dlv_1",
        toStatus: vers,
        actor: "admin",
        actorUserId: "usr_admin",
      });
      expect(store.get("dlv_1")?.assignedDriverId, `${depuis} → ${vers}`).toBeNull();
    }
  });

  it("garde le driver attaché sur DELIVERED — il a fait la course", async () => {
    const store = new FakeDeliveryStore([
      aDelivery({ status: "IN_TRANSIT", assignedDriverId: "drv_1", version: 1 }),
    ]);
    await transitionDelivery(store, shop, {
      deliveryId: "dlv_1",
      toStatus: "DELIVERED",
      actor: "driver",
      actorUserId: "usr_drv",
    });
    expect(store.get("dlv_1")?.assignedDriverId).toBe("drv_1");
  });
});

// ---------------------------------------------------------------------------
// D3 — les offres vivantes doivent mourir avec la course
// ---------------------------------------------------------------------------

describe("D3 — offres invalidées sur transition terminale", () => {
  it("annule les propositions OFFERED quand la course est annulée", async () => {
    const store = new FakeDeliveryStore(
      [aDelivery({ status: "OFFERING", version: 1 })],
      [
        anAssignment({ id: "asg_1", driverId: "drv_1", expiresAt: plus(30) }),
        anAssignment({ id: "asg_2", driverId: "drv_2", rank: 2, expiresAt: plus(30) }),
      ],
    );

    await transitionDelivery(store, shop, {
      deliveryId: "dlv_1",
      toStatus: "CANCELLED",
      actor: "admin",
      actorUserId: "usr_admin",
    });

    expect(store.getAssignment("asg_1")?.status).toBe("CANCELLED");
    expect(store.getAssignment("asg_2")?.status).toBe("CANCELLED");
  });

  it("ne touche pas aux propositions déjà résolues", async () => {
    const store = new FakeDeliveryStore(
      [aDelivery({ status: "OFFERING", version: 1 })],
      [
        anAssignment({ id: "asg_1", driverId: "drv_1", status: "REJECTED" }),
        anAssignment({ id: "asg_2", driverId: "drv_2", status: "EXPIRED", rank: 2 }),
      ],
    );

    await transitionDelivery(store, shop, {
      deliveryId: "dlv_1",
      toStatus: "CANCELLED",
      actor: "admin",
      actorUserId: "usr_admin",
    });

    expect(store.getAssignment("asg_1")?.status).toBe("REJECTED");
    expect(store.getAssignment("asg_2")?.status).toBe("EXPIRED");
  });

  it("annule aussi les offres quand la course repart au dispatch", async () => {
    const store = new FakeDeliveryStore(
      [aDelivery({ status: "OFFERING", version: 1 })],
      [anAssignment({ id: "asg_1", driverId: "drv_1", expiresAt: plus(30) })],
    );

    await transitionDelivery(store, shop, {
      deliveryId: "dlv_1",
      toStatus: "UNASSIGNED",
      actor: "system",
      actorUserId: null,
    });

    expect(store.getAssignment("asg_1")?.status).toBe("CANCELLED");
  });
});
