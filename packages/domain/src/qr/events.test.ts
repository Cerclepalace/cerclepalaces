import { describe, expect, it } from "vitest";

import {
  ACQUISITION_EVENTS,
  funnelRates,
  funnelStep,
  shopUrl,
  suggestSlug,
  type FunnelCounts,
} from "./events.js";

describe("suggestSlug", () => {
  it("produit un slug lisible depuis un nom commercial", () => {
    expect(suggestSlug("Green CBD Paris")).toBe("green-cbd-paris");
  });

  it("retire les accents plutôt que de les remplacer par des tirets", () => {
    expect(suggestSlug("Chanvre & Café — Bordeaux")).toBe("chanvre-cafe-bordeaux");
  });

  it("ne laisse jamais de tiret en début ou en fin", () => {
    expect(suggestSlug("!! Le Shop !!")).toBe("le-shop");
  });

  it("borne la longueur pour rester imprimable", () => {
    expect(suggestSlug("a".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

describe("shopUrl", () => {
  it("construit l'URL publique d'un shop", () => {
    expect(shopUrl("https://plateforme.fr", "green-cbd-paris")).toBe(
      "https://plateforme.fr/shop/green-cbd-paris",
    );
  });

  it("tolère une base terminée par un slash", () => {
    expect(shopUrl("https://plateforme.fr/", "green-cbd-paris")).toBe(
      "https://plateforme.fr/shop/green-cbd-paris",
    );
  });
});

describe("funnelStep", () => {
  it("ordonne le tunnel du scan à la commande", () => {
    expect(funnelStep("qr_scan")).toBe(0);
    expect(funnelStep("order_completed")).toBe(ACQUISITION_EVENTS.length - 1);
    expect(funnelStep("add_to_cart")).toBeGreaterThan(funnelStep("shop_view"));
  });
});

describe("funnelRates", () => {
  const counts: FunnelCounts = {
    qr_scan: 200,
    shop_view: 180,
    product_view: 120,
    add_to_cart: 40,
    checkout_started: 25,
    order_completed: 20,
  };

  it("calcule le taux qui décide de l'intérêt d'un support physique", () => {
    expect(funnelRates(counts).scanToOrder).toBeCloseTo(0.1);
  });

  it("calcule les taux intermédiaires", () => {
    const rates = funnelRates(counts);
    expect(rates.scanToCart).toBeCloseTo(0.2);
    expect(rates.cartToOrder).toBeCloseTo(0.5);
    expect(rates.checkoutToOrder).toBeCloseTo(0.8);
  });

  it("renvoie zéro plutôt qu'une division par zéro sur un QR jamais scanné", () => {
    const rates = funnelRates({
      qr_scan: 0,
      shop_view: 0,
      product_view: 0,
      add_to_cart: 0,
      checkout_started: 0,
      order_completed: 0,
    });
    expect(rates.scanToOrder).toBe(0);
    expect(rates.cartToOrder).toBe(0);
    expect(Number.isFinite(rates.scanToCart)).toBe(true);
  });
});
