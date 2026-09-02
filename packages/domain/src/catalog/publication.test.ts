import { describe, expect, it } from "vitest";

import {
  SUBMISSION_GAPS,
  checkComplianceSubmission,
  type ComplianceSubmission,
} from "./publication.js";

const NOW = new Date("2026-09-01T10:00:00Z");
const jours = (n: number): Date => new Date(NOW.getTime() + n * 86_400_000);

const dossier = (overrides: Partial<ComplianceSubmission> = {}): ComplianceSubmission => ({
  productName: "Fleur CBD — Amnesia",
  batchNumber: "LOT-2026-0417",
  supplier: "Chanvre du Sud SARL",
  laboratory: "Laboratoire de test",
  delta9ThcPercent: 0.28,
  totalThcPercent: 0.3,
  cbdContent: 12.4,
  issuedAt: jours(-1),
  expiresAt: jours(365),
  documentKinds: ["CERTIFICATE_OF_ANALYSIS"],
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
        laboratory: null,
        batchNumber: "  ",
        supplier: null,
        delta9ThcPercent: null,
        totalThcPercent: null,
        cbdContent: null,
        issuedAt: null,
        expiresAt: null,
        documentKinds: [],
      },
      NOW,
    );
    expect(résultat.gaps).toEqual([
      "MISSING_NAME",
      "MISSING_CERTIFICATE_OF_ANALYSIS",
      "MISSING_LABORATORY",
      "MISSING_BATCH_NUMBER",
      "MISSING_SUPPLIER",
      "MISSING_DECLARED_CONTENTS",
      "MISSING_ISSUE_DATE",
    ]);
  });

  it("exige les deux taux, pas un seul", () => {
    expect(checkComplianceSubmission(dossier({ delta9ThcPercent: null }), NOW).gaps).toEqual([
      "MISSING_DECLARED_CONTENTS",
    ]);
    expect(checkComplianceSubmission(dossier({ cbdContent: null }), NOW).gaps).toEqual([
      "MISSING_DECLARED_CONTENTS",
    ]);
  });

  it("accepte un taux de zéro, qui est une valeur déclarée", () => {
    // 0 est une information, pas une absence : le confondre avec `null`
    // refuserait un produit sans THC, ce qui est exactement l'inverse du but.
    expect(checkComplianceSubmission(dossier({ delta9ThcPercent: 0 }), NOW).complete).toBe(true);
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
      {
        productName: null,
        laboratory: null,
        batchNumber: null,
        supplier: null,
        delta9ThcPercent: null,
        totalThcPercent: null,
        cbdContent: null,
        issuedAt: null,
        expiresAt: jours(-5),
        documentKinds: [],
      },
      NOW,
    );
    for (const gap of résultat.gaps) expect(SUBMISSION_GAPS).toContain(gap);
  });
});
