import { describe, expect, it } from "vitest";

import {
  breakdownBalances,
  computeBreakdown,
  formatCents,
  productsSubtotal,
  type PspFees,
  type RevenueConfig,
} from "./breakdown.js";

/**
 * Configuration d'exemple reprenant l'illustration du brief : 50 € de produits,
 * 4,90 € de livraison. Les valeurs de commission et de rémunération coursier
 * sont arbitraires tant que le modèle économique n'est pas arrêté — ces tests
 * vérifient la mécanique de répartition, pas le choix des chiffres.
 */
const revenue: RevenueConfig = {
  model: "commission_and_delivery",
  commissionBps: 1_500, // 15 %
  platformFixedFeeCents: 0,
  courierPayoutCents: 450,
  deliveryFeeCents: 490,
};

const psp: PspFees = { variableBps: 140, fixedCents: 25 };

describe("productsSubtotal", () => {
  it("somme les lignes avec leurs quantités", () => {
    expect(
      productsSubtotal([
        { unitPriceCents: 1_500, quantity: 2 },
        { unitPriceCents: 2_000, quantity: 1 },
      ]),
    ).toBe(5_000);
  });

  it("vaut zéro pour un panier vide", () => {
    expect(productsSubtotal([])).toBe(0);
  });
});

describe("computeBreakdown", () => {
  const lines = [{ unitPriceCents: 5_000, quantity: 1 }];
  const breakdown = computeBreakdown({ lines, revenue, psp });

  it("facture au client les produits plus la livraison", () => {
    expect(breakdown.productsSubtotalCents).toBe(5_000);
    expect(breakdown.deliveryFeeCents).toBe(490);
    expect(breakdown.customerTotalCents).toBe(5_490);
  });

  it("reverse au shop le sous-total moins la commission", () => {
    expect(breakdown.merchantPayoutCents).toBe(4_250); // 5000 - 15 %
  });

  it("applique les frais PSP sur le montant réellement encaissé", () => {
    expect(breakdown.pspFeeCents).toBe(102); // 5490 × 1,40 % + 25
  });

  it("déduit la marge plateforme comme un reste", () => {
    expect(breakdown.platformNetCents).toBe(5_490 - 4_250 - 450 - 102);
  });

  it("équilibre toujours la répartition au centime près", () => {
    expect(breakdownBalances(breakdown)).toBe(true);
  });
});

describe("la marge peut être négative", () => {
  it("le montre au lieu de le masquer", () => {
    const coûteux = computeBreakdown({
      lines: [{ unitPriceCents: 1_500, quantity: 1 }],
      revenue: { ...revenue, courierPayoutCents: 600, deliveryFeeCents: 290 },
      psp,
    });
    expect(coûteux.platformNetCents).toBeLessThan(0);
    expect(breakdownBalances(coûteux)).toBe(true);
  });
});

describe("l'équilibre tient sur des montants quelconques", () => {
  it("ne perd jamais un centime en arrondi", () => {
    for (let unitPrice = 199; unitPrice <= 9_999; unitPrice += 137) {
      for (const quantity of [1, 3, 7]) {
        const breakdown = computeBreakdown({
          lines: [{ unitPriceCents: unitPrice, quantity }],
          revenue,
          psp,
        });
        expect(breakdownBalances(breakdown), `${unitPrice} × ${quantity}`).toBe(true);
      }
    }
  });
});

describe("modèle sans commission", () => {
  it("laisse au shop l'intégralité du sous-total produits", () => {
    const breakdown = computeBreakdown({
      lines: [{ unitPriceCents: 5_000, quantity: 1 }],
      revenue: { ...revenue, model: "delivery_fee_only", commissionBps: 0 },
      psp,
    });
    expect(breakdown.merchantPayoutCents).toBe(5_000);
    expect(breakdownBalances(breakdown)).toBe(true);
  });
});

describe("formatCents", () => {
  it("rend un montant lisible en euros", () => {
    expect(formatCents(5_490).replace(/ | /g, " ")).toBe("54,90 €");
  });
});
