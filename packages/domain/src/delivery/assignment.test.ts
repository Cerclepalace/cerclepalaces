import { describe, expect, it } from "vitest";

import {
  acceptedAssignment,
  alreadyOfferedDriverIds,
  hasSingleAcceptedAssignment,
  isExpired,
  isPending,
  respondToOffer,
  type Assignment,
} from "./assignment.js";

const T0 = new Date("2026-06-01T12:00:00Z");
const plus = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);

const offer = (overrides: Partial<Assignment> = {}): Assignment => ({
  id: "asg_1",
  deliveryId: "dlv_1",
  driverId: "drv_1",
  status: "OFFERED",
  rank: 1,
  offeredAt: T0,
  expiresAt: plus(30),
  ...overrides,
});

describe("expiration d'une proposition", () => {
  // TEST 2 de la mission.
  it("devient expirée quand l'horloge dépasse expiresAt", () => {
    const proposition = offer();
    expect(isExpired(proposition, plus(29))).toBe(false);
    expect(isExpired(proposition, plus(30))).toBe(true);
    expect(isExpired(proposition, plus(31))).toBe(true);
  });

  it("n'expire que ce qui est encore OFFERED", () => {
    expect(isExpired(offer({ status: "ACCEPTED" }), plus(999))).toBe(false);
    expect(isExpired(offer({ status: "REJECTED" }), plus(999))).toBe(false);
  });

  it("distingue en attente et expirée", () => {
    const proposition = offer();
    expect(isPending(proposition, plus(10))).toBe(true);
    expect(isPending(proposition, plus(40))).toBe(false);
  });
});

describe("acceptation", () => {
  it("accepte une proposition vivante", () => {
    const résultat = respondToOffer({
      assignment: offer(),
      respondingDriverId: "drv_1",
      response: "ACCEPTED",
      siblings: [],
      now: plus(5),
    });
    expect(résultat).toEqual({ ok: true, status: "ACCEPTED" });
  });

  it("refuse une acceptation après expiration", () => {
    const résultat = respondToOffer({
      assignment: offer(),
      respondingDriverId: "drv_1",
      response: "ACCEPTED",
      siblings: [],
      now: plus(45),
    });
    expect(résultat.ok).toBe(false);
    if (!résultat.ok) expect(résultat.code).toBe("OFFER_EXPIRED");
  });

  it("refuse une réponse venant d'un autre driver", () => {
    const résultat = respondToOffer({
      assignment: offer(),
      respondingDriverId: "drv_intrus",
      response: "ACCEPTED",
      siblings: [],
      now: plus(5),
    });
    expect(résultat.ok).toBe(false);
    if (!résultat.ok) expect(résultat.code).toBe("WRONG_DRIVER");
  });

  it("refuse une seconde réponse sur la même proposition", () => {
    const résultat = respondToOffer({
      assignment: offer({ status: "REJECTED" }),
      respondingDriverId: "drv_1",
      response: "ACCEPTED",
      siblings: [],
      now: plus(5),
    });
    expect(résultat.ok).toBe(false);
    if (!résultat.ok) expect(résultat.code).toBe("ALREADY_RESOLVED");
  });
});

// TEST 1 de la mission.
describe("deux drivers acceptent en même temps", () => {
  it("n'en laisse gagner qu'un", () => {
    const pourA = offer({ id: "asg_a", driverId: "drv_a" });
    const pourB = offer({ id: "asg_b", driverId: "drv_b", rank: 2 });

    const premier = respondToOffer({
      assignment: pourA,
      respondingDriverId: "drv_a",
      response: "ACCEPTED",
      siblings: [pourA, pourB],
      now: plus(5),
    });
    expect(premier).toEqual({ ok: true, status: "ACCEPTED" });

    // A vient d'être écrit : B répond sur un état déjà pris.
    const second = respondToOffer({
      assignment: pourB,
      respondingDriverId: "drv_b",
      response: "ACCEPTED",
      siblings: [{ ...pourA, status: "ACCEPTED" }, pourB],
      now: plus(5),
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("DELIVERY_ALREADY_ASSIGNED");
  });

  it("dit au perdant qu'il a perdu la course, pas que son offre a expiré", () => {
    const pourB = offer({ id: "asg_b", driverId: "drv_b" });
    const résultat = respondToOffer({
      assignment: pourB,
      respondingDriverId: "drv_b",
      response: "ACCEPTED",
      siblings: [offer({ id: "asg_a", driverId: "drv_a", status: "ACCEPTED" }), pourB],
      // Offre également expirée : le motif « course prise » doit primer.
      now: plus(60),
    });
    expect(résultat.ok).toBe(false);
    if (!résultat.ok) expect(résultat.code).toBe("DELIVERY_ALREADY_ASSIGNED");
  });
});

describe("refus", () => {
  it("est toujours accepté sans pénalité", () => {
    const résultat = respondToOffer({
      assignment: offer(),
      respondingDriverId: "drv_1",
      response: "REJECTED",
      siblings: [],
      now: plus(5),
    });
    expect(résultat).toEqual({ ok: true, status: "REJECTED" });
  });

  it("reste enregistrable après qu'un autre driver a pris la course", () => {
    const résultat = respondToOffer({
      assignment: offer({ id: "asg_b", driverId: "drv_b" }),
      respondingDriverId: "drv_b",
      response: "REJECTED",
      siblings: [offer({ id: "asg_a", driverId: "drv_a", status: "ACCEPTED" })],
      now: plus(5),
    });
    expect(résultat.ok).toBe(true);
  });
});

describe("invariant : une seule acceptation par livraison", () => {
  it("tient sur un jeu sain", () => {
    expect(
      hasSingleAcceptedAssignment([
        offer({ id: "a", status: "REJECTED" }),
        offer({ id: "b", status: "ACCEPTED" }),
        offer({ id: "c", status: "EXPIRED" }),
      ]),
    ).toBe(true);
  });

  it("détecte une double acceptation", () => {
    expect(
      hasSingleAcceptedAssignment([
        offer({ id: "a", status: "ACCEPTED" }),
        offer({ id: "b", status: "ACCEPTED" }),
      ]),
    ).toBe(false);
  });

  it("retrouve la proposition gagnante", () => {
    const gagnante = offer({ id: "b", driverId: "drv_b", status: "ACCEPTED" });
    expect(acceptedAssignment([offer({ id: "a", status: "EXPIRED" }), gagnante])?.driverId).toBe(
      "drv_b",
    );
  });
});

// TEST 3 de la mission.
describe("réassignation", () => {
  it("conserve l'historique des propositions précédentes", () => {
    const historique: readonly Assignment[] = [
      offer({ id: "asg_1", driverId: "drv_a", status: "EXPIRED" }),
      offer({ id: "asg_2", driverId: "drv_b", status: "REJECTED", rank: 2 }),
      offer({ id: "asg_3", driverId: "drv_c", status: "ACCEPTED", rank: 3 }),
    ];

    expect(historique).toHaveLength(3);
    expect(hasSingleAcceptedAssignment(historique)).toBe(true);
    expect(acceptedAssignment(historique)?.driverId).toBe("drv_c");
    // Les tentatives ratées restent lisibles : c'est ce qui explique le délai.
    expect(historique.filter((a) => a.status === "EXPIRED")).toHaveLength(1);
    expect(historique.filter((a) => a.status === "REJECTED")).toHaveLength(1);
  });

  it("liste les drivers déjà sollicités, pour ne pas les redemander", () => {
    const déjàVus = alreadyOfferedDriverIds([
      offer({ id: "asg_1", driverId: "drv_a", status: "EXPIRED" }),
      offer({ id: "asg_2", driverId: "drv_b", status: "REJECTED" }),
    ]);
    expect([...déjàVus].sort()).toEqual(["drv_a", "drv_b"]);
  });
});
