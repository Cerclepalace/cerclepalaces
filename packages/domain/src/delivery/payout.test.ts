import { describe, expect, it } from "vitest";

import {
  PAYOUT_CALCULATION_VERSION,
  calculateDriverPayout,
  payoutBalances,
  type PayoutRates,
} from "./payout.js";

/**
 * Tarifs d'exemple. Aucun n'est arrêté : le statut juridique du driver et le
 * modèle économique restent ouverts (docs/TO_VERIFY.md, décisions 01 et 04).
 * Ces tests vérifient la mécanique, pas le choix des chiffres.
 */
const rates: PayoutRates = {
  baseFeeCents: 300,
  distanceRateCentsPerKm: 80,
  waitingRateCentsPerMinute: 15,
  minimumPayoutCents: 0,
};

describe("calcul par poste", () => {
  it("décompose la rémunération", () => {
    const payout = calculateDriverPayout({
      rates,
      distanceMeters: 2_500,
      waitingSeconds: 240,
      bonusCents: 100,
    });

    expect(payout.baseAmountCents).toBe(300);
    expect(payout.distanceAmountCents).toBe(200); // 2,5 km × 80
    expect(payout.waitingAmountCents).toBe(60); // 4 min × 15
    expect(payout.bonusAmountCents).toBe(100);
    expect(payout.totalAmountCents).toBe(660);
  });

  it("équilibre toujours les postes avec le total", () => {
    const payout = calculateDriverPayout({
      rates,
      distanceMeters: 3_333,
      waitingSeconds: 137,
      bonusCents: 50,
    });
    expect(payoutBalances(payout)).toBe(true);
  });

  it("enregistre la version de la formule", () => {
    const payout = calculateDriverPayout({ rates, distanceMeters: 0, waitingSeconds: 0, bonusCents: 0 });
    expect(payout.calculationVersion).toBe(PAYOUT_CALCULATION_VERSION);
  });
});

// TEST 12 de la mission.
describe("pureté et déterminisme", () => {
  it("donne le même résultat pour les mêmes entrées", () => {
    const input = { rates, distanceMeters: 1_800, waitingSeconds: 90, bonusCents: 0 };
    const a = calculateDriverPayout(input);
    const b = calculateDriverPayout(input);
    const c = calculateDriverPayout(input);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("ne dépend d'aucune horloge ni d'aucun aléa", () => {
    const input = { rates, distanceMeters: 1_000, waitingSeconds: 60, bonusCents: 0 };
    const résultats = Array.from({ length: 50 }, () => calculateDriverPayout(input).totalAmountCents);
    expect(new Set(résultats).size).toBe(1);
  });

  it("ne mute pas ses entrées", () => {
    const input = { rates, distanceMeters: 1_000, waitingSeconds: 60, bonusCents: 25 };
    const copie = structuredClone(input);
    calculateDriverPayout(input);
    expect(input).toEqual(copie);
  });
});

describe("plancher garanti", () => {
  it("complète jusqu'au minimum quand le calcul est en dessous", () => {
    const payout = calculateDriverPayout({
      rates: { ...rates, minimumPayoutCents: 500 },
      distanceMeters: 200,
      waitingSeconds: 0,
      bonusCents: 0,
    });
    expect(payout.totalAmountCents).toBe(500);
    expect(payout.minimumTopUpCents).toBeGreaterThan(0);
    expect(payoutBalances(payout)).toBe(true);
  });

  it("ne complète pas quand le calcul dépasse déjà le minimum", () => {
    const payout = calculateDriverPayout({
      rates: { ...rates, minimumPayoutCents: 400 },
      distanceMeters: 5_000,
      waitingSeconds: 0,
      bonusCents: 0,
    });
    expect(payout.minimumTopUpCents).toBe(0);
    expect(payout.totalAmountCents).toBe(700); // 300 + 400
  });

  it("n'impose aucun plancher par défaut", () => {
    expect(rates.minimumPayoutCents).toBe(0);
  });
});

describe("robustesse", () => {
  it("ramène les entrées négatives à zéro plutôt que de payer à l'envers", () => {
    const payout = calculateDriverPayout({
      rates,
      distanceMeters: -5_000,
      waitingSeconds: -600,
      bonusCents: -100,
    });
    expect(payout.distanceAmountCents).toBe(0);
    expect(payout.waitingAmountCents).toBe(0);
    expect(payout.bonusAmountCents).toBe(0);
    expect(payout.totalAmountCents).toBe(300);
  });

  it("ne produit jamais de total négatif", () => {
    const payout = calculateDriverPayout({
      rates: { ...rates, baseFeeCents: -1_000 },
      distanceMeters: 0,
      waitingSeconds: 0,
      bonusCents: 0,
    });
    expect(payout.totalAmountCents).toBeGreaterThanOrEqual(0);
  });

  it("ne rend jamais de montant fractionnaire", () => {
    for (let distance = 137; distance < 9_000; distance += 331) {
      const payout = calculateDriverPayout({ rates, distanceMeters: distance, waitingSeconds: 47, bonusCents: 0 });
      expect(Number.isInteger(payout.totalAmountCents), `${distance} m`).toBe(true);
      expect(payoutBalances(payout)).toBe(true);
    }
  });
});

describe("la formule reste configurable", () => {
  it("ne fige aucun tarif : doubler le kilométrage double la part distance", () => {
    const base = calculateDriverPayout({ rates, distanceMeters: 4_000, waitingSeconds: 0, bonusCents: 0 });
    const doublé = calculateDriverPayout({
      rates: { ...rates, distanceRateCentsPerKm: rates.distanceRateCentsPerKm * 2 },
      distanceMeters: 4_000,
      waitingSeconds: 0,
      bonusCents: 0,
    });
    expect(doublé.distanceAmountCents).toBe(base.distanceAmountCents * 2);
  });

  it("supporte un modèle purement forfaitaire", () => {
    const payout = calculateDriverPayout({
      rates: { baseFeeCents: 500, distanceRateCentsPerKm: 0, waitingRateCentsPerMinute: 0, minimumPayoutCents: 0 },
      distanceMeters: 8_000,
      waitingSeconds: 900,
      bonusCents: 0,
    });
    expect(payout.totalAmountCents).toBe(500);
  });
});
