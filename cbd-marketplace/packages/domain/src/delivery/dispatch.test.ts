import { describe, expect, it } from "vitest";

import {
  distanceMeters,
  isEligible,
  rankCandidates,
  type DispatchCandidate,
  type DispatchRequest,
} from "./dispatch.js";

/** Le shop de référence du pilote : place de la République, Paris. */
const pickup = { lat: 48.8674, lng: 2.3636 };

const request: DispatchRequest = {
  pickup,
  zoneId: "paris-centre",
  maxPickupDistanceMeters: 4_000,
  maxConcurrentMissions: 1,
};

const courier = (overrides: Partial<DispatchCandidate> = {}): DispatchCandidate => ({
  courierId: "c1",
  verification: "APPROVED",
  availability: "AVAILABLE",
  zoneId: "paris-centre",
  position: { lat: 48.8687, lng: 2.3653 }, // ~200 m du shop
  activeMissions: 0,
  ...overrides,
});

describe("distanceMeters", () => {
  it("vaut zéro pour un même point", () => {
    expect(distanceMeters(pickup, pickup)).toBe(0);
  });

  it("reste dans l'ordre de grandeur attendu à l'échelle d'une ville", () => {
    // République → Bastille, environ 1,7 km à vol d'oiseau.
    const bastille = { lat: 48.8532, lng: 2.3692 };
    const distance = distanceMeters(pickup, bastille);
    expect(distance).toBeGreaterThan(1_400);
    expect(distance).toBeLessThan(2_000);
  });

  it("est symétrique", () => {
    const other = { lat: 48.8532, lng: 2.3692 };
    expect(distanceMeters(pickup, other)).toBe(distanceMeters(other, pickup));
  });
});

describe("isEligible", () => {
  it("accepte un coursier approuvé, disponible, dans la zone et à portée", () => {
    expect(isEligible(courier(), request)).toBe(true);
  });

  it("écarte un coursier non approuvé même s'il est devant le shop", () => {
    expect(isEligible(courier({ verification: "UNDER_REVIEW" }), request)).toBe(false);
    expect(isEligible(courier({ verification: "SUSPENDED" }), request)).toBe(false);
    expect(isEligible(courier({ verification: "REJECTED" }), request)).toBe(false);
  });

  it("écarte un coursier hors ligne ou déjà en mission", () => {
    expect(isEligible(courier({ availability: "OFFLINE" }), request)).toBe(false);
    expect(isEligible(courier({ availability: "ON_MISSION" }), request)).toBe(false);
  });

  it("écarte un coursier d'une autre zone", () => {
    expect(isEligible(courier({ zoneId: "lyon-centre" }), request)).toBe(false);
  });

  it("écarte un coursier trop éloigné du shop", () => {
    expect(isEligible(courier({ position: { lat: 48.9362, lng: 2.3574 } }), request)).toBe(false);
  });

  it("écarte un coursier ayant atteint sa charge maximale", () => {
    expect(isEligible(courier({ activeMissions: 1 }), request)).toBe(false);
  });
});

describe("rankCandidates", () => {
  it("classe le plus proche en premier", () => {
    const ranked = rankCandidates(
      [
        courier({ courierId: "loin", position: { lat: 48.8532, lng: 2.3692 } }),
        courier({ courierId: "proche" }),
      ],
      request,
    );
    expect(ranked.map((c) => c.courierId)).toEqual(["proche", "loin"]);
  });

  it("départage deux coursiers équidistants par leur charge", () => {
    const ranked = rankCandidates(
      [
        courier({ courierId: "chargé", activeMissions: 1 }),
        courier({ courierId: "libre", activeMissions: 0 }),
      ],
      { ...request, maxConcurrentMissions: 3 },
    );
    expect(ranked.map((c) => c.courierId)).toEqual(["libre", "chargé"]);
  });

  it("est déterministe à distance et charge égales", () => {
    const candidates = [courier({ courierId: "b" }), courier({ courierId: "a" })];
    expect(rankCandidates(candidates, request).map((c) => c.courierId)).toEqual(["a", "b"]);
  });

  it("renvoie une liste vide quand personne n'est éligible", () => {
    expect(rankCandidates([courier({ availability: "OFFLINE" })], request)).toHaveLength(0);
  });
});
