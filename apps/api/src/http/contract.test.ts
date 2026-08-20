import { describe, expect, it } from "vitest";

import {
  ALL_ROUTES,
  ADMIN_ROUTES,
  DELIVERY_ROUTES,
  DRIVER_ROUTES,
  availabilitySchema,
  proofSchema,
  rejectOfferSchema,
  statusForError,
} from "./contract.js";

describe("cohérence du contrat", () => {
  it("ne déclare aucune route en double", () => {
    const clés = ALL_ROUTES.map((r) => `${r.method} ${r.path}`);
    expect(new Set(clés).size).toBe(clés.length);
  });

  it("donne un rôle à chaque route", () => {
    for (const route of ALL_ROUTES) {
      expect(route.roles.length, `${route.method} ${route.path}`).toBeGreaterThan(0);
    }
  });

  it("couvre le parcours driver de bout en bout", () => {
    const chemins = ALL_ROUTES.map((r) => r.path);
    for (const attendu of [
      "/driver/availability",
      "/driver/deliveries/offers",
      "/driver/deliveries/:id/accept",
      "/driver/deliveries/:id/reject",
      "/deliveries/:id/pickup",
      "/deliveries/:id/in-transit",
      "/deliveries/:id/delivered",
    ]) {
      expect(chemins).toContain(attendu);
    }
  });

  it("marque comme tenantée toute route touchant une livraison précise", () => {
    for (const route of [...DRIVER_ROUTES, ...DELIVERY_ROUTES]) {
      if (route.path.includes("/deliveries/:id")) {
        expect(route.tenantScoped, route.path).toBe(true);
      }
    }
  });

  it("n'ouvre les routes d'observabilité qu'aux rôles plateforme", () => {
    for (const route of ADMIN_ROUTES) {
      expect(route.roles.every((r) => r === "admin" || r === "support_agent"), route.path).toBe(true);
    }
  });

  it("réserve l'annulation à l'administration", () => {
    const annulation = DELIVERY_ROUTES.find((r) => r.path.endsWith("/cancel"));
    expect(annulation?.roles).toEqual(["admin"]);
  });

  it("n'expose aucune route de paiement", () => {
    for (const route of ALL_ROUTES) {
      expect(route.path).not.toMatch(/pay|checkout|charge|refund/i);
    }
  });
});

describe("validation des entrées", () => {
  it("n'accepte que les trois disponibilités connues", () => {
    expect(availabilitySchema.safeParse({ availability: "ONLINE" }).success).toBe(true);
    expect(availabilitySchema.safeParse({ availability: "BUSY" }).success).toBe(false);
  });

  it("rend le motif de refus facultatif", () => {
    expect(rejectOfferSchema.safeParse({}).success).toBe(true);
    expect(rejectOfferSchema.safeParse({ reason: "trop loin" }).success).toBe(true);
  });

  it("n'accepte jamais un code de confirmation en clair", () => {
    const résultat = proofSchema.safeParse({ type: "CODE", code: "1234", codeHash: "abc" });
    expect(résultat.success).toBe(true);
    if (résultat.success) expect(Object.keys(résultat.data)).not.toContain("code");
  });
});

describe("correspondance des erreurs", () => {
  it("répond 404 sur une frontière de tenant, jamais 403", () => {
    // Un 403 confirmerait l'existence de la ressource.
    const erreur = Object.assign(new Error("x"), { name: "TenantMismatchError" });
    expect(statusForError(erreur)).toBe(404);
  });

  it("répond 409 sur un conflit de version ou de transition", () => {
    for (const nom of ["DeliveryConflictError", "DeliveryTransitionError", "OrderConflictError"]) {
      expect(statusForError(Object.assign(new Error("x"), { name: nom }))).toBe(409);
    }
  });

  it("répond 501 quand un provider n'est pas configuré", () => {
    for (const nom of ["PaymentNotConfiguredError", "DeliveryProviderNotConfiguredError"]) {
      expect(statusForError(Object.assign(new Error("x"), { name: nom }))).toBe(501);
    }
  });

  it("retombe sur 500 pour une erreur inconnue", () => {
    expect(statusForError(new Error("boum"))).toBe(500);
  });
});
