import { describe, expect, it } from "vitest";

import {
  AVAILABILITY_BLOCKERS,
  SUBMISSION_GAPS,
  checkComplianceSubmission,
  evaluateProductAvailability,
  type ComplianceSubmission,
  type ProductAvailabilityInput,
} from "./publication.js";

const NOW = new Date("2026-09-01T10:00:00Z");
const jours = (n: number): Date => new Date(NOW.getTime() + n * 86_400_000);

const dossier = (overrides: Partial<ComplianceSubmission> = {}): ComplianceSubmission => ({
  productName: "Fleur CBD — Amnesia",
  batchNumber: "LOT-2026-0417",
  supplier: "Chanvre du Sud SARL",
  thcContent: 0.28,
  cbdContent: 12.4,
  expiresAt: jours(365),
  documentKinds: ["CERTIFICATE_OF_ANALYSIS"],
  ...overrides,
});

const disponibilité = (
  overrides: Partial<ProductAvailabilityInput> = {},
): ProductAvailabilityInput => ({
  merchantStatus: "ACTIVE",
  complianceStatus: "APPROVED",
  complianceExpiresAt: jours(90),
  isListed: true,
  stock: 12,
  priceCents: 1_190,
  ...overrides,
});

describe("dépôt d'un dossier de conformité", () => {
  it("accepte un dossier complet", () => {
    expect(checkComplianceSubmission(dossier(), NOW)).toEqual({ complete: true, gaps: [] });
  });

  it("refuse un dossier sans certificat d'analyse", () => {
    // Règle de plateforme : on ne fait pas circuler un produit dont personne
    // n'a analysé le contenu.
    const résultat = checkComplianceSubmission(
      dossier({ documentKinds: ["SUPPLIER_SHEET", "PRODUCT_LABEL"] }),
      NOW,
    );
    expect(résultat.gaps).toEqual(["MISSING_CERTIFICATE_OF_ANALYSIS"]);
  });

  it("accepte un COA accompagné d'autres pièces", () => {
    expect(
      checkComplianceSubmission(
        dossier({ documentKinds: ["SUPPLIER_SHEET", "CERTIFICATE_OF_ANALYSIS"] }),
        NOW,
      ).complete,
    ).toBe(true);
  });

  it("liste tous les manques d'un coup", () => {
    const résultat = checkComplianceSubmission(
      {
        productName: null,
        batchNumber: "  ",
        supplier: null,
        thcContent: null,
        cbdContent: null,
        expiresAt: null,
        documentKinds: [],
      },
      NOW,
    );
    expect(résultat.gaps).toEqual([
      "MISSING_NAME",
      "MISSING_CERTIFICATE_OF_ANALYSIS",
      "MISSING_BATCH_NUMBER",
      "MISSING_SUPPLIER",
      "MISSING_DECLARED_CONTENTS",
    ]);
  });

  it("exige les deux taux, pas un seul", () => {
    expect(checkComplianceSubmission(dossier({ thcContent: null }), NOW).gaps).toEqual([
      "MISSING_DECLARED_CONTENTS",
    ]);
    expect(checkComplianceSubmission(dossier({ cbdContent: null }), NOW).gaps).toEqual([
      "MISSING_DECLARED_CONTENTS",
    ]);
  });

  it("accepte un taux de zéro, qui est une valeur déclarée", () => {
    // 0 est une information, pas une absence : le confondre avec `null`
    // refuserait un produit sans THC, ce qui est exactement l'inverse du but.
    expect(checkComplianceSubmission(dossier({ thcContent: 0 }), NOW).complete).toBe(true);
  });

  it("refuse un certificat déjà expiré au dépôt", () => {
    expect(checkComplianceSubmission(dossier({ expiresAt: jours(-1) }), NOW).gaps).toEqual([
      "CERTIFICATE_ALREADY_EXPIRED",
    ]);
  });

  it("traite l'instant d'expiration comme déjà passé", () => {
    expect(checkComplianceSubmission(dossier({ expiresAt: NOW }), NOW).gaps).toEqual([
      "CERTIFICATE_ALREADY_EXPIRED",
    ]);
  });

  it("accepte un dossier sans date de validité", () => {
    expect(checkComplianceSubmission(dossier({ expiresAt: null }), NOW).complete).toBe(true);
  });

  it("n'invente aucun manque hors de la liste déclarée", () => {
    const résultat = checkComplianceSubmission(
      { productName: null, batchNumber: null, supplier: null, thcContent: null, cbdContent: null, expiresAt: jours(-5), documentKinds: [] },
      NOW,
    );
    for (const gap of résultat.gaps) expect(SUBMISSION_GAPS).toContain(gap);
  });
});

describe("mise à disposition d'un produit", () => {
  it("autorise la commande quand tout est réuni", () => {
    expect(evaluateProductAvailability(disponibilité(), NOW)).toEqual({
      orderable: true,
      blockers: [],
    });
  });

  it("bloque les produits d'un shop suspendu", () => {
    // Sans cette règle, suspendre un shop ne l'empêcherait pas de vendre.
    for (const statut of ["PENDING_VALIDATION", "SUSPENDED", "CLOSED"] as const) {
      const résultat = evaluateProductAvailability(disponibilité({ merchantStatus: statut }), NOW);
      expect(résultat.blockers, statut).toContain("MERCHANT_NOT_ACTIVE");
      expect(résultat.orderable, statut).toBe(false);
    }
  });

  it("bloque tout ce qui n'est pas APPROVED", () => {
    for (const statut of ["PENDING_REVIEW", "REJECTED", "SUSPENDED", "EXPIRED"] as const) {
      expect(
        evaluateProductAvailability(disponibilité({ complianceStatus: statut }), NOW).blockers,
        statut,
      ).toContain("COMPLIANCE_NOT_APPROVED");
    }
  });

  it("bloque un certificat périmé même si le statut dit encore APPROVED", () => {
    // Le cas le plus dangereux du lot : il ressemble à un produit conforme. La
    // garde ne doit pas attendre qu'une tâche de fond ait basculé le statut.
    const résultat = evaluateProductAvailability(
      disponibilité({ complianceStatus: "APPROVED", complianceExpiresAt: jours(-1) }),
      NOW,
    );
    expect(résultat.orderable).toBe(false);
    expect(résultat.blockers).toEqual(["COMPLIANCE_EXPIRED"]);
  });

  it("accepte un produit sans date de validité", () => {
    expect(
      evaluateProductAvailability(disponibilité({ complianceExpiresAt: null }), NOW).orderable,
    ).toBe(true);
  });

  it("distingue le retrait de la vente et la rupture", () => {
    expect(evaluateProductAvailability(disponibilité({ isListed: false }), NOW).blockers).toEqual([
      "NOT_LISTED",
    ]);
    expect(evaluateProductAvailability(disponibilité({ stock: 0 }), NOW).blockers).toEqual([
      "OUT_OF_STOCK",
    ]);
  });

  it("traite un stock négatif comme une rupture", () => {
    expect(evaluateProductAvailability(disponibilité({ stock: -3 }), NOW).blockers).toEqual([
      "OUT_OF_STOCK",
    ]);
  });

  it("refuse un prix absent ou nul", () => {
    // Un produit à zéro euro dans un catalogue est une erreur de saisie, pas
    // une offre commerciale.
    expect(evaluateProductAvailability(disponibilité({ priceCents: null }), NOW).blockers).toEqual([
      "NO_PRICE",
    ]);
    expect(evaluateProductAvailability(disponibilité({ priceCents: 0 }), NOW).blockers).toEqual([
      "NO_PRICE",
    ]);
  });

  it("rend tous les blocages ensemble, pas le premier", () => {
    const résultat = evaluateProductAvailability(
      {
        merchantStatus: "SUSPENDED",
        complianceStatus: "PENDING_REVIEW",
        complianceExpiresAt: jours(-2),
        isListed: false,
        stock: 0,
        priceCents: null,
      },
      NOW,
    );
    expect(résultat.blockers).toEqual([
      "MERCHANT_NOT_ACTIVE",
      "COMPLIANCE_NOT_APPROVED",
      "COMPLIANCE_EXPIRED",
      "NOT_LISTED",
      "OUT_OF_STOCK",
      "NO_PRICE",
    ]);
  });

  it("n'invente aucun blocage hors de la liste déclarée", () => {
    const résultat = evaluateProductAvailability(
      disponibilité({ merchantStatus: "CLOSED", stock: 0 }),
      NOW,
    );
    for (const blocker of résultat.blockers) expect(AVAILABILITY_BLOCKERS).toContain(blocker);
  });
});
