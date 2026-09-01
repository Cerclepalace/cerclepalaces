import { describe, expect, it } from "vitest";

import type { KybDossier } from "../merchant/status.js";
import {
  LISTING_BLOCKERS,
  LISTING_BLOCKER_LABEL_FR,
  evaluateListing,
  type ListingCandidate,
} from "./listing-gate.js";
import { EMPTY_CATALOGUE_POLICY, type CataloguePolicy, type LegalEvidence } from "./policy.js";

const NOW = new Date("2026-09-01T10:00:00Z");
const jours = (n: number): Date => new Date(NOW.getTime() + n * 86_400_000);

const preuve: LegalEvidence = {
  id: "ev_source",
  kind: "OFFICIAL_PUBLICATION",
  reference: "Référence citable de la source",
  sourceUrl: null,
  status: "VERIFIED",
  verifiedAt: NOW,
  verifiedBy: "juriste@example.test",
};

/** Politique qui autorise la catégorie du pilote et encadre un analyte. */
const POLITIQUE: CataloguePolicy = {
  evidence: [preuve],
  categories: [
    { categorySlug: "fleurs-cbd", decision: "ALLOWED", evidenceIds: ["ev_source"], decidedAt: NOW, note: null },
    { categorySlug: "comestibles", decision: "PROHIBITED", evidenceIds: [], decidedAt: NOW, note: null },
  ],
  prohibitedSubstances: [{ substance: "Substance-A", aliases: ["SubA"], evidenceIds: [], decidedAt: NOW }],
  analytes: [
    { analyte: "THC", decision: "RESTRICTED", maxPercent: 0.3, evidenceIds: ["ev_source"], decidedAt: NOW },
    { analyte: "CBD", decision: "UNRESTRICTED", maxPercent: null, evidenceIds: [], decidedAt: NOW },
  ],
  reviewedAt: NOW,
  maxAgeDays: 180,
};

const kybComplet: KybDossier = {
  legalName: "Cercle Palace SAS",
  tradeName: "Cercle Palace",
  registrationNumber: "912 345 678 00019",
  locations: [
    { line1: "1 place de la République", postalCode: "75011", city: "Paris", country: "FR" },
  ],
  ownerCount: 1,
};

/** Dossier de conformité complet, réutilisé par toutes les fabriques. */
const dossierComplet = {
  productName: "Fleur CBD — Amnesia",
  batchNumber: "LOT-2026-0417",
  supplier: "Chanvre du Sud SARL",
  thcContent: 0.2,
  cbdContent: 12.4,
  expiresAt: jours(365),
  documentKinds: ["CERTIFICATE_OF_ANALYSIS"],
} as const;

const candidat = (overrides: Partial<ListingCandidate> = {}): ListingCandidate => ({
  submission: dossierComplet,
  merchantStatus: "ACTIVE",
  kyb: kybComplet,
  complianceStatus: "APPROVED",
  complianceExpiresAt: jours(90),
  categorySlug: "fleurs-cbd",
  declaredComposition: ["fleur de chanvre"],
  declaredAnalytes: [
    { analyte: "THC", percent: 0.2 },
    { analyte: "CBD", percent: 12.4 },
  ],
  isListed: true,
  stock: 12,
  priceCents: 1_190,
  ...overrides,
});

describe("chemin nominal", () => {
  it("laisse passer un produit dont tout est en règle", () => {
    const verdict = evaluateListing(candidat(), POLITIQUE, NOW);
    expect(verdict).toEqual({ listable: true, findings: [], blockers: [] });
  });
});

describe("vendeur", () => {
  it("bloque un shop qui n'est pas actif", () => {
    for (const statut of ["PENDING_VALIDATION", "SUSPENDED", "CLOSED"] as const) {
      const verdict = evaluateListing(candidat({ merchantStatus: statut }), POLITIQUE, NOW);
      expect(verdict.blockers, statut).toContain("MERCHANT_NOT_ACTIVE");
    }
  });

  it("bloque un dossier KYB incomplet et dit ce qui manque", () => {
    const verdict = evaluateListing(
      candidat({ kyb: { ...kybComplet, registrationNumber: null } }),
      POLITIQUE,
      NOW,
    );
    expect(verdict.blockers).toEqual(["MERCHANT_KYB_INCOMPLETE"]);
    expect(verdict.findings[0]?.detail).toContain("MISSING_REGISTRATION_NUMBER");
  });

  it("distingue un shop actif au dossier incomplet d'un shop suspendu", () => {
    // Deux problèmes différents, deux corrections différentes.
    const verdict = evaluateListing(
      candidat({ merchantStatus: "SUSPENDED", kyb: { ...kybComplet, ownerCount: 0 } }),
      POLITIQUE,
      NOW,
    );
    expect(verdict.blockers).toEqual(["MERCHANT_NOT_ACTIVE", "MERCHANT_KYB_INCOMPLETE"]);
  });
});

describe("conformité du produit", () => {
  it("bloque tout ce qui n'est pas APPROVED", () => {
    for (const statut of ["PENDING_REVIEW", "REJECTED", "SUSPENDED", "EXPIRED"] as const) {
      expect(
        evaluateListing(candidat({ complianceStatus: statut }), POLITIQUE, NOW).blockers,
        statut,
      ).toContain("COMPLIANCE_NOT_APPROVED");
    }
  });

  it("bloque un certificat périmé même si le statut dit encore APPROVED", () => {
    const verdict = evaluateListing(
      candidat({ complianceStatus: "APPROVED", complianceExpiresAt: jours(-1) }),
      POLITIQUE,
      NOW,
    );
    expect(verdict.blockers).toEqual(["COMPLIANCE_EXPIRED"]);
    expect(verdict.findings[0]?.detail).toContain("2026-08-31");
  });
});

describe("politique de catalogue", () => {
  it("bloque un produit sans catégorie", () => {
    expect(evaluateListing(candidat({ categorySlug: null }), POLITIQUE, NOW).blockers).toEqual([
      "CATEGORY_MISSING",
    ]);
    expect(evaluateListing(candidat({ categorySlug: "  " }), POLITIQUE, NOW).blockers).toEqual([
      "CATEGORY_MISSING",
    ]);
  });

  it("bloque une catégorie écartée par la plateforme", () => {
    expect(
      evaluateListing(candidat({ categorySlug: "comestibles" }), POLITIQUE, NOW).blockers,
    ).toEqual(["CATEGORY_PROHIBITED"]);
  });

  it("bloque une catégorie jamais examinée", () => {
    // Le silence n'autorise pas : c'est ce qui empêche de vendre par défaut ce
    // que personne n'a regardé.
    const verdict = evaluateListing(candidat({ categorySlug: "resines" }), POLITIQUE, NOW);
    expect(verdict.blockers).toEqual(["CATEGORY_UNDECIDED"]);
    expect(verdict.findings[0]?.detail).toContain("jamais examinée");
  });

  it("bloque une catégorie autorisée dont la preuve a été remplacée", () => {
    const périmée: CataloguePolicy = {
      ...POLITIQUE,
      evidence: [{ ...preuve, status: "SUPERSEDED" }],
    };
    const verdict = evaluateListing(candidat(), périmée, NOW);
    expect(verdict.blockers).toContain("CATEGORY_UNDECIDED");
    expect(verdict.findings[0]?.detail).toContain("sans preuve juridique vérifiée");
  });

  it("bloque une substance prohibée déclarée, en la nommant", () => {
    const verdict = evaluateListing(
      candidat({ declaredComposition: ["fleur de chanvre", "substance-a"] }),
      POLITIQUE,
      NOW,
    );
    expect(verdict.blockers).toEqual(["SUBSTANCE_PROHIBITED"]);
    expect(verdict.findings[0]?.detail).toContain("Substance-A");
  });

  it("bloque un taux au-dessus du plafond, en disant lequel et de combien", () => {
    const verdict = evaluateListing(
      candidat({ declaredAnalytes: [{ analyte: "THC", percent: 0.9 }] }),
      POLITIQUE,
      NOW,
    );
    expect(verdict.blockers).toEqual(["ANALYTE_ABOVE_LIMIT"]);
    expect(verdict.findings[0]?.detail).toBe("THC déclaré à 0.9 %, plafond 0.3 %.");
  });

  it("bloque un analyte dont la règle n'est pas tranchée", () => {
    const verdict = evaluateListing(
      candidat({ declaredAnalytes: [{ analyte: "CBN", percent: 1 }] }),
      POLITIQUE,
      NOW,
    );
    // Deux motifs, et c'est juste : le THC encadré n'est plus mesuré, et le CBN
    // déclaré relève d'une règle inexistante.
    expect(verdict.blockers).toEqual(["ANALYTE_NOT_DECLARED", "ANALYTE_UNDECIDED"]);
  });

  it("bloque tout sous une politique vide", () => {
    // Un environnement neuf ne vend rien tant que personne n'a rien tranché.
    const verdict = evaluateListing(candidat(), EMPTY_CATALOGUE_POLICY, NOW);
    expect(verdict.listable).toBe(false);
    // Une politique vide n'a jamais été revue : elle est périmée par
    // construction, en plus de ne rien trancher.
    expect(verdict.blockers).toEqual([
      "POLICY_STALE",
      "CATEGORY_UNDECIDED",
      "ANALYTE_UNDECIDED",
      "ANALYTE_UNDECIDED",
    ]);
  });
});

describe("disponibilité commerciale", () => {
  it("distingue retrait de la vente, rupture et absence de prix", () => {
    expect(evaluateListing(candidat({ isListed: false }), POLITIQUE, NOW).blockers).toEqual([
      "NOT_LISTED",
    ]);
    expect(evaluateListing(candidat({ stock: 0 }), POLITIQUE, NOW).blockers).toEqual([
      "OUT_OF_STOCK",
    ]);
    expect(evaluateListing(candidat({ priceCents: 0 }), POLITIQUE, NOW).blockers).toEqual([
      "NO_PRICE",
    ]);
  });
});

describe("forme du verdict", () => {
  it("rend tous les motifs, dans l'ordre des responsabilités", () => {
    // Un commerçant dont le shop est suspendu doit lire cela avant de lire
    // qu'il lui manque un prix.
    const verdict = evaluateListing(
      {
        submission: dossierComplet,
        merchantStatus: "SUSPENDED",
        kyb: { ...kybComplet, legalName: null },
        complianceStatus: "PENDING_REVIEW",
        complianceExpiresAt: jours(-2),
        categorySlug: "comestibles",
        declaredComposition: ["substance-a"],
        declaredAnalytes: [{ analyte: "THC", percent: 5 }],
        isListed: false,
        stock: 0,
        priceCents: null,
      },
      POLITIQUE,
      NOW,
    );

    expect(verdict.blockers).toEqual([
      "MERCHANT_NOT_ACTIVE",
      "MERCHANT_KYB_INCOMPLETE",
      "COMPLIANCE_NOT_APPROVED",
      "COMPLIANCE_EXPIRED",
      "CATEGORY_PROHIBITED",
      "SUBSTANCE_PROHIBITED",
      "ANALYTE_ABOVE_LIMIT",
      "NOT_LISTED",
      "OUT_OF_STOCK",
      "NO_PRICE",
    ]);
  });

  it("accompagne chaque motif d'un détail exploitable", () => {
    const verdict = evaluateListing(candidat({ stock: -2 }), POLITIQUE, NOW);
    for (const finding of verdict.findings) {
      expect(finding.detail.length, finding.blocker).toBeGreaterThan(5);
    }
  });

  it("n'invente aucun motif hors de la liste déclarée", () => {
    const verdict = evaluateListing(
      candidat({ merchantStatus: "CLOSED", categorySlug: "inconnue", stock: 0 }),
      POLITIQUE,
      NOW,
    );
    for (const blocker of verdict.blockers) {
      expect(LISTING_BLOCKERS).toContain(blocker);
      expect(LISTING_BLOCKER_LABEL_FR[blocker]).toBeTruthy();
    }
  });

  it("garde motifs et détails alignés", () => {
    const verdict = evaluateListing(candidat({ merchantStatus: "CLOSED", isListed: false }), POLITIQUE, NOW);
    expect(verdict.blockers).toEqual(verdict.findings.map((finding) => finding.blocker));
  });

  it("est déterministe", () => {
    const entrée = candidat({ merchantStatus: "SUSPENDED", stock: 0 });
    expect(evaluateListing(entrée, POLITIQUE, NOW)).toEqual(
      evaluateListing(entrée, POLITIQUE, NOW),
    );
  });
});

describe("aucune règle de droit n'est écrite dans le code", () => {
  it("ne connaît aucun seuil sans politique", () => {
    // Le test le plus important du module : sans politique fournie, le code est
    // incapable de statuer sur un taux. Aucun nombre réglementaire n'y dort.
    const verdict = evaluateListing(
      candidat({ declaredAnalytes: [{ analyte: "THC", percent: 0.2 }] }),
      EMPTY_CATALOGUE_POLICY,
      NOW,
    );
    expect(verdict.blockers).toContain("ANALYTE_UNDECIDED");
  });

  it("applique le plafond fourni, quel qu'il soit", () => {
    // Preuve qu'aucune valeur n'est privilégiée : deux politiques différentes
    // donnent deux verdicts différents sur le même produit.
    const strict: CataloguePolicy = {
      ...POLITIQUE,
      analytes: [
        { analyte: "THC", decision: "RESTRICTED", maxPercent: 0.1, evidenceIds: ["ev_source"], decidedAt: NOW },
        { analyte: "CBD", decision: "UNRESTRICTED", maxPercent: null, evidenceIds: [], decidedAt: NOW },
      ],
    };
    expect(evaluateListing(candidat(), POLITIQUE, NOW).listable).toBe(true);
    expect(evaluateListing(candidat(), strict, NOW).blockers).toEqual(["ANALYTE_ABOVE_LIMIT"]);
  });
});
