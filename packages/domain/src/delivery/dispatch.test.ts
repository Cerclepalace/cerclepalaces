import { describe, expect, it } from "vitest";

import type { Assignment } from "./assignment.js";
import {
  DEFAULT_DISPATCH_POLICY,
  distanceMeters,
  evaluateCandidates,
  nextOffer,
  planOffers,
  selectCandidates,
  shouldReassign,
  type DispatchState,
  type DriverCandidate,
} from "./dispatch.js";

const T0 = new Date("2026-06-01T18:00:00Z");
const plus = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);

/** Le shop de référence du pilote : place de la République, Paris. */
const pickup = { lat: 48.8674, lng: 2.3636 };

const driver = (overrides: Partial<DriverCandidate> = {}): DriverCandidate => ({
  driverId: "drv_1",
  verification: "APPROVED",
  availability: "ONLINE",
  zoneIds: ["paris-centre"],
  position: { lat: 48.8687, lng: 2.3653 }, // ~200 m du shop
  activeDeliveries: 0,
  supportedCategories: ["standard"],
  ...overrides,
});

const state = (overrides: Partial<DispatchState> = {}): DispatchState => ({
  deliveryId: "dlv_1",
  deliveryStatus: "PENDING_DISPATCH",
  pickup,
  pickupZoneId: "paris-centre",
  category: "standard",
  roundNumber: 0,
  candidates: [driver()],
  assignments: [],
  policy: DEFAULT_DISPATCH_POLICY,
  ...overrides,
});

describe("distanceMeters", () => {
  it("vaut zéro pour un même point", () => {
    expect(distanceMeters(pickup, pickup)).toBe(0);
  });

  it("reste dans l'ordre de grandeur attendu à l'échelle d'une ville", () => {
    const bastille = { lat: 48.8532, lng: 2.3692 };
    const distance = distanceMeters(pickup, bastille);
    expect(distance).toBeGreaterThan(1_400);
    expect(distance).toBeLessThan(2_000);
  });

  it("est symétrique", () => {
    const autre = { lat: 48.8532, lng: 2.3692 };
    expect(distanceMeters(pickup, autre)).toBe(distanceMeters(autre, pickup));
  });
});

// TESTS 4 et 5 de la mission.
describe("exclusions, avec leur motif", () => {
  const motifPour = (candidat: DriverCandidate, override: Partial<DispatchState> = {}) =>
    evaluateCandidates(state({ candidates: [candidat], ...override }))[0];

  it("écarte un driver OFFLINE", () => {
    const évaluation = motifPour(driver({ availability: "OFFLINE" }));
    expect(évaluation?.eligible).toBe(false);
    expect(évaluation?.reason).toBe("DRIVER_OFFLINE");
  });

  it("écarte un driver en PAUSED", () => {
    expect(motifPour(driver({ availability: "PAUSED" }))?.reason).toBe("DRIVER_OFFLINE");
  });

  it("écarte un driver non approuvé, même devant le shop", () => {
    for (const verification of ["UNDER_REVIEW", "REJECTED", "SUSPENDED"] as const) {
      expect(motifPour(driver({ verification }))?.reason).toBe("DRIVER_NOT_APPROVED");
    }
  });

  it("écarte un driver hors zone", () => {
    expect(motifPour(driver({ zoneIds: ["lyon-centre"] }))?.reason).toBe("OUTSIDE_ZONE");
  });

  it("écarte un driver dont la catégorie ne correspond pas", () => {
    expect(motifPour(driver({ supportedCategories: ["frais"] }))?.reason).toBe(
      "CATEGORY_NOT_SUPPORTED",
    );
  });

  it("écarte un driver à pleine charge", () => {
    expect(motifPour(driver({ activeDeliveries: 1 }))?.reason).toBe("AT_CAPACITY");
  });

  it("écarte un driver trop éloigné", () => {
    expect(motifPour(driver({ position: { lat: 48.9362, lng: 2.3574 } }))?.reason).toBe("TOO_FAR");
  });

  it("écarte un driver déjà sollicité sur cette course", () => {
    const déjàOffert: Assignment = {
      id: "asg_1",
      deliveryId: "dlv_1",
      driverId: "drv_1",
      status: "REJECTED",
      rank: 1,
      offeredAt: T0,
      expiresAt: plus(30),
    };
    expect(motifPour(driver(), { assignments: [déjàOffert] })?.reason).toBe("ALREADY_OFFERED");
  });

  it("retient un driver éligible sans motif", () => {
    const évaluation = motifPour(driver());
    expect(évaluation?.eligible).toBe(true);
    expect(évaluation?.reason).toBeNull();
  });

  it("évalue tous les candidats, y compris ceux écartés", () => {
    const évaluations = evaluateCandidates(
      state({
        candidates: [
          driver({ driverId: "ok" }),
          driver({ driverId: "hors_ligne", availability: "OFFLINE" }),
          driver({ driverId: "hors_zone", zoneIds: ["ailleurs"] }),
        ],
      }),
    );
    expect(évaluations).toHaveLength(3);
    expect(évaluations.filter((e) => e.eligible)).toHaveLength(1);
  });
});

describe("classement des candidats", () => {
  it("place le plus proche en premier", () => {
    const classés = selectCandidates(
      state({
        candidates: [
          driver({ driverId: "loin", position: { lat: 48.8532, lng: 2.3692 } }),
          driver({ driverId: "proche" }),
        ],
      }),
    );
    expect(classés.map((c) => c.driverId)).toEqual(["proche", "loin"]);
    expect(classés[0]?.rank).toBe(1);
  });

  it("départage deux candidats équidistants par leur charge", () => {
    const classés = selectCandidates(
      state({
        candidates: [
          driver({ driverId: "chargé", activeDeliveries: 1 }),
          driver({ driverId: "libre", activeDeliveries: 0 }),
        ],
        policy: { ...DEFAULT_DISPATCH_POLICY, maxConcurrentDeliveries: 3 },
      }),
    );
    expect(classés.map((c) => c.driverId)).toEqual(["libre", "chargé"]);
  });

  it("est déterministe à distance et charge égales", () => {
    const candidats = [driver({ driverId: "b" }), driver({ driverId: "a" })];
    expect(selectCandidates(state({ candidates: candidats })).map((c) => c.driverId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("estime un temps d'arrivée à partir de la distance", () => {
    const [premier] = selectCandidates(state());
    expect(premier?.estimatedPickupSeconds).toBeGreaterThan(0);
  });
});

// TEST 6 de la mission.
describe("déterminisme", () => {
  it("produit exactement le même résultat pour le même état et le même now", () => {
    const s = state({
      candidates: [
        driver({ driverId: "a" }),
        driver({ driverId: "b", position: { lat: 48.8700, lng: 2.3700 } }),
        driver({ driverId: "c", availability: "OFFLINE" }),
      ],
    });

    const premier = nextOffer(s, T0);
    const second = nextOffer(s, T0);
    const troisième = nextOffer(s, T0);

    expect(JSON.stringify(premier)).toBe(JSON.stringify(second));
    expect(JSON.stringify(second)).toBe(JSON.stringify(troisième));
  });

  it("n'utilise pas d'horloge interne : un now différent donne une expiration différente", () => {
    const s = state();
    const à0 = nextOffer(s, T0);
    const à60 = nextOffer(s, plus(60));
    expect(à0.kind).toBe("OFFER");
    expect(à60.kind).toBe("OFFER");
    if (à0.kind === "OFFER" && à60.kind === "OFFER") {
      expect(à0.offers[0]?.expiresAt).not.toEqual(à60.offers[0]?.expiresAt);
    }
  });
});

describe("timeout paramétrable", () => {
  it("applique la durée fournie par la politique, pas une constante enfouie", () => {
    for (const secondes of [15, 30, 90]) {
      const offres = planOffers(
        state({ policy: { ...DEFAULT_DISPATCH_POLICY, offerTimeoutSeconds: secondes } }),
        T0,
      );
      expect(offres[0]?.expiresAt.getTime()).toBe(T0.getTime() + secondes * 1000);
    }
  });
});

describe("décision du moteur", () => {
  it("propose au meilleur candidat", () => {
    const décision = nextOffer(state(), T0);
    expect(décision.kind).toBe("OFFER");
    if (décision.kind === "OFFER") {
      expect(décision.offers).toHaveLength(1);
      expect(décision.offers[0]?.driverId).toBe("drv_1");
      expect(décision.roundNumber).toBe(1);
    }
  });

  it("attend tant qu'une proposition est vivante", () => {
    const enCours: Assignment = {
      id: "asg_1",
      deliveryId: "dlv_1",
      driverId: "drv_autre",
      status: "OFFERED",
      rank: 1,
      offeredAt: T0,
      expiresAt: plus(30),
    };
    const décision = nextOffer(state({ deliveryStatus: "OFFERING", assignments: [enCours] }), plus(10));
    expect(décision.kind).toBe("WAIT");
    if (décision.kind === "WAIT") expect(décision.until).toEqual(plus(30));
  });

  it("acte les propositions expirées avant d'en ouvrir de nouvelles", () => {
    const expirée: Assignment = {
      id: "asg_1",
      deliveryId: "dlv_1",
      driverId: "drv_autre",
      status: "OFFERED",
      rank: 1,
      offeredAt: T0,
      expiresAt: plus(30),
    };
    const décision = nextOffer(state({ deliveryStatus: "OFFERING", assignments: [expirée] }), plus(40));
    expect(décision.kind).toBe("EXPIRE");
    if (décision.kind === "EXPIRE") expect(décision.assignmentIds).toEqual(["asg_1"]);
  });

  it("s'épuise quand plus aucun candidat n'est éligible", () => {
    const décision = nextOffer(state({ candidates: [driver({ availability: "OFFLINE" })] }), T0);
    expect(décision.kind).toBe("EXHAUSTED");
  });

  it("s'épuise après le nombre maximum de tours", () => {
    const décision = nextOffer(
      state({ roundNumber: 5, policy: { ...DEFAULT_DISPATCH_POLICY, maxRounds: 5 } }),
      T0,
    );
    expect(décision.kind).toBe("EXHAUSTED");
  });

  it("ne dispatche pas une livraison déjà assignée ou terminée", () => {
    for (const statut of ["ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "CANCELLED"] as const) {
      expect(nextOffer(state({ deliveryStatus: statut }), T0).kind).toBe("IDLE");
    }
  });

  it("respecte le nombre de propositions parallèles", () => {
    const décision = nextOffer(
      state({
        candidates: [
          driver({ driverId: "a" }),
          driver({ driverId: "b", position: { lat: 48.8700, lng: 2.3700 } }),
          driver({ driverId: "c", position: { lat: 48.8710, lng: 2.3710 } }),
        ],
        policy: { ...DEFAULT_DISPATCH_POLICY, parallelOffers: 2 },
      }),
      T0,
    );
    if (décision.kind === "OFFER") expect(décision.offers).toHaveLength(2);
    else expect.unreachable("une offre était attendue");
  });
});

describe("journal des décisions", () => {
  it("consigne les candidats écartés avec leur motif", () => {
    const décision = nextOffer(
      state({
        candidates: [
          driver({ driverId: "retenu" }),
          driver({ driverId: "hors_ligne", availability: "OFFLINE" }),
          driver({ driverId: "hors_zone", zoneIds: ["ailleurs"] }),
        ],
      }),
      T0,
    );
    expect(décision.kind).toBe("OFFER");
    if (décision.kind !== "OFFER") return;

    expect(décision.records).toHaveLength(3);
    const parDriver = new Map(décision.records.map((r) => [r.driverId, r]));
    expect(parDriver.get("retenu")).toMatchObject({ decision: "OFFERED", reason: "OFFER_CREATED", rank: 1 });
    expect(parDriver.get("hors_ligne")).toMatchObject({ decision: "SKIPPED", reason: "DRIVER_OFFLINE" });
    expect(parDriver.get("hors_zone")).toMatchObject({ decision: "SKIPPED", reason: "OUTSIDE_ZONE" });
  });

  it("distingue un candidat éligible non retenu ce tour d'un candidat exclu", () => {
    const décision = nextOffer(
      state({
        candidates: [
          driver({ driverId: "premier" }),
          driver({ driverId: "second", position: { lat: 48.8700, lng: 2.3700 } }),
        ],
      }),
      T0,
    );
    if (décision.kind !== "OFFER") return expect.unreachable();
    const second = décision.records.find((r) => r.driverId === "second");
    expect(second?.reason).toBe("NOT_SELECTED_THIS_ROUND");
  });

  it("conserve distance et estimation pour chaque décision", () => {
    const décision = nextOffer(state(), T0);
    if (décision.kind !== "OFFER") return expect.unreachable();
    expect(décision.records[0]?.distanceMeters).toBeGreaterThan(0);
    expect(décision.records[0]?.estimatedPickupSeconds).toBeGreaterThan(0);
  });
});

describe("shouldReassign", () => {
  it("est vrai quand une course rendue a encore des candidats", () => {
    expect(shouldReassign(state({ deliveryStatus: "UNASSIGNED", roundNumber: 1 }), T0)).toBe(true);
  });

  it("est faux sans candidat restant", () => {
    expect(
      shouldReassign(
        state({
          deliveryStatus: "UNASSIGNED",
          roundNumber: 1,
          candidates: [driver({ availability: "OFFLINE" })],
        }),
        T0,
      ),
    ).toBe(false);
  });

  it("est faux au-delà du nombre maximum de tours", () => {
    expect(
      shouldReassign(
        state({ deliveryStatus: "UNASSIGNED", roundNumber: 5, policy: { ...DEFAULT_DISPATCH_POLICY, maxRounds: 5 } }),
        T0,
      ),
    ).toBe(false);
  });

  it("est faux pour une livraison qui n'a pas été rendue", () => {
    expect(shouldReassign(state({ deliveryStatus: "ASSIGNED" }), T0)).toBe(false);
  });
});

describe("driver non localisé", () => {
  it("est écarté avec un motif, pas filtré en silence", () => {
    const évaluations = evaluateCandidates(
      state({ candidates: [driver({ driverId: "drv_perdu", position: null })] }),
    );

    expect(évaluations).toHaveLength(1);
    expect(évaluations[0]).toMatchObject({
      driverId: "drv_perdu",
      eligible: false,
      reason: "POSITION_UNKNOWN",
      // Une distance inconnue est `null`, pas zéro : zéro voudrait dire « sur
      // place », ce qui le classerait premier.
      distanceMeters: null,
      estimatedPickupSeconds: null,
    });
  });

  it("n'est jamais retenu ni classé", () => {
    const classés = selectCandidates(
      state({
        candidates: [
          driver({ driverId: "drv_perdu", position: null }),
          driver({ driverId: "drv_situé" }),
        ],
      }),
    );
    expect(classés.map((candidat) => candidat.driverId)).toEqual(["drv_situé"]);
  });

  it("laisse la course sans preneur s'il est le seul candidat", () => {
    const décision = nextOffer(
      state({ candidates: [driver({ position: null })] }),
      plus(0),
    );
    expect(décision.kind).toBe("EXHAUSTED");
  });

  it("cède le pas aux motifs plus structurels", () => {
    // Un driver non approuvé *et* non localisé est écarté pour la première
    // raison : c'est celle qui restera vraie quoi qu'il arrive à son GPS.
    const évaluations = evaluateCandidates(
      state({
        candidates: [driver({ verification: "UNDER_REVIEW", position: null })],
      }),
    );
    expect(évaluations[0]?.reason).toBe("DRIVER_NOT_APPROVED");
  });
});
