/**
 * Tests adversariaux du portail de mise en vente.
 *
 * Les autres suites décrivent des situations plausibles et vérifient que le
 * système les traite bien. Celle-ci fait le contraire : elle cherche à faire
 * passer un produit qui ne devrait pas passer.
 *
 * **Chacun de ces tests a échoué avant le correctif qu'il accompagne.** C'est la
 * seule raison de leur existence : un test adversarial qui n'a jamais été rouge
 * ne prouve pas qu'une porte est fermée, il prouve qu'on ne l'a pas poussée.
 */

import { describe, expect, it } from "vitest";

import type { KybDossier } from "../merchant/status.js";
import { assertMerchantTransition } from "../merchant/status.js";
import { evaluateListing, type ListingCandidate } from "./listing-gate.js";
import {
  EMPTY_CATALOGUE_POLICY,
  checkPolicyFreshness,
  decideAnalyte,
  decideCategory,
  findProhibitedSubstances,
  normaliseSubstance,
  supportsAuthorisation,
  type CataloguePolicy,
  type LegalEvidence,
} from "./policy.js";

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

/**
 * Politique de test. Les noms de substances et le plafond sont **fictifs** et
 * n'affirment aucun droit : ils servent à vérifier le mécanisme, pas à énoncer
 * une règle. Aucune valeur réglementaire réelle n'est écrite dans ce dépôt.
 */
const POLITIQUE: CataloguePolicy = {
  evidence: [preuve],
  categories: [
    { categorySlug: "FLOWER", decision: "ALLOWED", evidenceIds: ["ev_source"], decidedAt: NOW, note: null },
    { categorySlug: "FOOD", decision: "PROHIBITED", evidenceIds: [], decidedAt: NOW, note: null },
  ],
  prohibitedSubstances: [
    {
      substance: "SUBSTANCE-FICTIVE-X",
      aliases: ["SubstanceFictiveXAcetate"],
      evidenceIds: [],
      decidedAt: NOW,
    },
  ],
  analytes: [
    { analyte: "ANALYTE-ENCADRE", decision: "RESTRICTED", maxPercent: 1, evidenceIds: ["ev_source"], decidedAt: NOW },
    {
      analyte: "DELTA9_THC",
      decision: "RESTRICTED",
      maxPercent: 0.3,
      evidenceIds: ["ev_source"],
      decidedAt: NOW,
    },
    {
      analyte: "TOTAL_THC",
      decision: "UNRESTRICTED",
      maxPercent: null,
      evidenceIds: [],
      decidedAt: NOW,
    },
  ],
  conditionalAnalytes: [],
  reviewedAt: NOW,
  maxAgeDays: 180,
};

const kyb: KybDossier = {
  legalName: "Cercle Palace SAS",
  tradeName: "Cercle Palace",
  registrationNumber: "912 345 678 00019",
  locations: [{ line1: "1 place", postalCode: "75011", city: "Paris", country: "FR" }],
  ownerCount: 1,
};

const dossier = {
  productName: "Produit de test",
  batchNumber: "LOT-TEST-1",
  supplier: "Fournisseur de test",
  laboratory: "Laboratoire de test",
  delta9ThcPercent: 0.2,
  totalThcPercent: 0.25,
  cbdContent: 10,
  issuedAt: jours(-1),
  expiresAt: jours(365),
  documentKinds: ["CERTIFICATE_OF_ANALYSIS"],
} as const;

const conforme = (overrides: Partial<ListingCandidate> = {}): ListingCandidate => ({
  submission: dossier,
  merchantStatus: "ACTIVE",
  kyb,
  complianceStatus: "APPROVED",
  complianceExpiresAt: jours(90),
  categorySlug: "FLOWER",
  declaredComposition: ["ingrédient neutre"],
  declaredAnalytes: [{ analyte: "ANALYTE-ENCADRE", percent: 0.5 }],
  isListed: true,
  stock: 10,
  priceCents: 1_000,
  ...overrides,
});

/** Repère : le candidat de référence passe bien. Sans lui, tout test « bloque » est trivial. */
it("le candidat de référence passe", () => {
  expect(evaluateListing(conforme(), POLITIQUE, NOW).listable).toBe(true);
});

describe("A-01 — sauter le contrôle des taux en ne déclarant rien", () => {
  it("ne laisse pas un produit passer sans aucune mesure", () => {
    const verdict = evaluateListing(conforme({ declaredAnalytes: [] }), POLITIQUE, NOW);
    expect(verdict.listable).toBe(false);
    expect(verdict.blockers).toContain("ANALYTE_NOT_DECLARED");
  });

  it("exige la mesure de chaque analyte encadré, pas d'un seul", () => {
    const deuxRègles: CataloguePolicy = {
      ...POLITIQUE,
      analytes: [
        ...POLITIQUE.analytes,
        { analyte: "AUTRE-ENCADRE", decision: "RESTRICTED", maxPercent: 2, evidenceIds: ["ev_source"], decidedAt: NOW },
      ],
    };
    const verdict = evaluateListing(conforme(), deuxRègles, NOW);
    expect(verdict.findings.filter((f) => f.blocker === "ANALYTE_NOT_DECLARED")).toHaveLength(1);
    expect(verdict.findings[0]?.detail).toContain("AUTRE-ENCADRE");
  });

  it("n'exige pas de mesurer un analyte explicitement non restreint", () => {
    const avecLibre: CataloguePolicy = {
      ...POLITIQUE,
      analytes: [
        ...POLITIQUE.analytes,
        { analyte: "ANALYTE-LIBRE", decision: "UNRESTRICTED", maxPercent: null, evidenceIds: [], decidedAt: NOW },
      ],
    };
    expect(evaluateListing(conforme(), avecLibre, NOW).listable).toBe(true);
  });
});

describe("A-02 — franchir le plafond par une mesure illisible", () => {
  it("refuse NaN au lieu de le déclarer conforme", () => {
    // `NaN > plafond` vaut `false` en JavaScript : la comparaison seule
    // renvoyait « conforme ».
    expect(decideAnalyte(POLITIQUE, { analyte: "ANALYTE-ENCADRE", percent: Number.NaN }, NOW)).toEqual({
      analyte: "ANALYTE-ENCADRE",
      decision: "UNDECIDED",
      cause: "INVALID_MEASUREMENT",
    });
  });

  it("refuse un taux négatif", () => {
    expect(
      decideAnalyte(POLITIQUE, { analyte: "ANALYTE-ENCADRE", percent: -5 }, NOW).decision,
    ).toBe("UNDECIDED");
  });

  it("refuse un taux supérieur à cent pour cent", () => {
    expect(
      decideAnalyte(POLITIQUE, { analyte: "ANALYTE-ENCADRE", percent: 999 }, NOW).decision,
    ).toBe("UNDECIDED");
  });

  it("refuse l'infini", () => {
    for (const valeur of [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(
        decideAnalyte(POLITIQUE, { analyte: "ANALYTE-ENCADRE", percent: valeur }, NOW).decision,
      ).toBe("UNDECIDED");
    }
  });

  it("bloque le portail entier sur une mesure illisible", () => {
    const verdict = evaluateListing(
      conforme({ declaredAnalytes: [{ analyte: "ANALYTE-ENCADRE", percent: Number.NaN }] }),
      POLITIQUE,
      NOW,
    );
    expect(verdict.listable).toBe(false);
    expect(verdict.blockers).toContain("ANALYTE_UNDECIDED");
  });

  it("accepte encore un zéro, qui est une mesure valide", () => {
    expect(
      decideAnalyte(POLITIQUE, { analyte: "ANALYTE-ENCADRE", percent: 0 }, NOW).decision,
    ).toBe("WITHIN_LIMIT");
  });
});

describe("A-03 — échapper à la liste de refus par l'écriture", () => {
  const variantes = [
    "SUBSTANCE-FICTIVE-X",
    "substance fictive x",
    "SubstanceFictiveX",
    "SUBSTANCE_FICTIVE_X",
    "substance–fictive–x", // tirets demi-cadratin
    "SUBSTANCE-FICTIVE-Χ", // chi grec
    "  substance-fictive-x  ",
  ];

  it("reconnaît toutes les écritures de la même substance", () => {
    for (const variante of variantes) {
      expect(findProhibitedSubstances(POLITIQUE, [variante]), variante).toEqual([
        "SUBSTANCE-FICTIVE-X",
      ]);
    }
  });

  it("reconnaît une substance citée à l'intérieur d'une phrase", () => {
    // Une composition réelle est du texte, pas une liste de jetons.
    expect(
      findProhibitedSubstances(POLITIQUE, ["fleur de chanvre enrichie en substance-fictive-x, 12 %"]),
    ).toEqual(["SUBSTANCE-FICTIVE-X"]);
  });

  it("reconnaît un alias déclaré", () => {
    expect(findProhibitedSubstances(POLITIQUE, ["SubstanceFictiveXAcetate"])).toEqual([
      "SUBSTANCE-FICTIVE-X",
    ]);
  });

  it("ne confond pas deux substances distinctes", () => {
    expect(findProhibitedSubstances(POLITIQUE, ["substance-fictive-y"])).toEqual([]);
  });

  it("normalise de façon idempotente", () => {
    const une = normaliseSubstance("SUBSTANCE-FICTIVE-X");
    expect(normaliseSubstance(une)).toBe(une);
  });
});

describe("A-04 — sauter la liste de refus en ne déclarant pas la composition", () => {
  it("bloque une composition vide", () => {
    expect(evaluateListing(conforme({ declaredComposition: [] }), POLITIQUE, NOW).blockers).toContain(
      "COMPOSITION_NOT_DECLARED",
    );
  });

  it("bloque une composition faite d'espaces", () => {
    expect(
      evaluateListing(conforme({ declaredComposition: ["  ", ""] }), POLITIQUE, NOW).blockers,
    ).toContain("COMPOSITION_NOT_DECLARED");
  });
});

describe("A-06 — arriver en rayon sans dossier de conformité", () => {
  it("bloque un produit dont le dossier n'a pas de certificat d'analyse", () => {
    const verdict = evaluateListing(
      conforme({ submission: { ...dossier, documentKinds: ["SUPPLIER_SHEET"] } }),
      POLITIQUE,
      NOW,
    );
    expect(verdict.blockers).toContain("SUBMISSION_INCOMPLETE");
    expect(verdict.findings[0]?.detail).toContain("MISSING_CERTIFICATE_OF_ANALYSIS");
  });

  it("bloque un dossier sans numéro de lot, même si le statut dit APPROVED", () => {
    // Un statut est le résultat d'un examen, pas sa preuve.
    expect(
      evaluateListing(conforme({ submission: { ...dossier, batchNumber: null } }), POLITIQUE, NOW)
        .blockers,
    ).toContain("SUBMISSION_INCOMPLETE");
  });
});

describe("A-07 — activer un shop au dossier vide", () => {
  const vide: KybDossier = {
    legalName: null,
    tradeName: null,
    registrationNumber: null,
    locations: [],
    ownerCount: 0,
  };

  it("refuse l'activation, même demandée par un admin", () => {
    expect(() => assertMerchantTransition("APPROVED", "ACTIVE", "admin", vide)).toThrow(
      /dossier incomplet/i,
    );
  });

  it("refuse aussi une levée de suspension sur un dossier redevenu incomplet", () => {
    expect(() => assertMerchantTransition("SUSPENDED", "ACTIVE", "admin", vide)).toThrow();
  });

  it("laisse passer les transitions qui n'activent rien", () => {
    expect(assertMerchantTransition("ACTIVE", "SUSPENDED", "admin", vide).to).toBe("SUSPENDED");
  });
});

describe("A-09 — s'appuyer sur une politique jamais revue", () => {
  it("déclare périmée une politique sans date de revue", () => {
    expect(checkPolicyFreshness(EMPTY_CATALOGUE_POLICY, NOW)).toEqual({
      fresh: false,
      cause: "NEVER_REVIEWED",
    });
  });

  it("déclare périmée une politique dont la revue a trop vieilli", () => {
    const vieille: CataloguePolicy = { ...POLITIQUE, reviewedAt: jours(-200) };
    expect(checkPolicyFreshness(vieille, NOW)).toEqual({ fresh: false, cause: "REVIEW_OVERDUE" });
    expect(evaluateListing(conforme(), vieille, NOW).blockers).toContain("POLICY_STALE");
  });

  it("accepte une politique datée dont l'exploitant a désactivé l'expiration", () => {
    // Désactiver doit rester un acte explicite, pas un oubli.
    expect(checkPolicyFreshness({ ...POLITIQUE, maxAgeDays: null }, NOW)).toEqual({ fresh: true });
  });

  it("refuse une politique sans date même si l'expiration est désactivée", () => {
    expect(
      checkPolicyFreshness({ ...POLITIQUE, reviewedAt: null, maxAgeDays: null }, NOW).fresh,
    ).toBe(false);
  });
});

describe("A-11 — soutenir une autorisation avec une preuve impossible", () => {
  it("refuse une preuve vérifiée dans le futur", () => {
    expect(supportsAuthorisation({ ...preuve, verifiedAt: jours(30) }, NOW)).toBe(false);
  });

  it("refuse une preuve dont la date est invalide", () => {
    expect(supportsAuthorisation({ ...preuve, verifiedAt: new Date("pas une date") }, NOW)).toBe(
      false,
    );
  });

  it("ferme la catégorie dont la seule preuve est datée du futur", () => {
    const futur: CataloguePolicy = { ...POLITIQUE, evidence: [{ ...preuve, verifiedAt: jours(30) }] };
    expect(decideCategory(futur, "FLOWER", NOW)).toEqual({
      decision: "UNDECIDED",
      cause: "AUTHORISATION_UNSUPPORTED",
    });
  });

  it("fait tomber la catégorie et le plafond quand la preuve commune disparaît", () => {
    // Une preuve retirée après validation ne laisse rien derrière elle.
    const sansPreuve: CataloguePolicy = { ...POLITIQUE, evidence: [] };
    const verdict = evaluateListing(conforme(), sansPreuve, NOW);
    // Trois motifs : la catégorie, le plafond de l'analyte encadré, et celui du
    // delta-9 — tous trois citaient la même source.
    expect(verdict.blockers).toEqual([
      "CATEGORY_UNDECIDED",
      "ANALYTE_UNDECIDED",
      "ANALYTE_UNDECIDED",
    ]);
  });
});

describe("contourner une garde par une autre route", () => {
  it("ne laisse pas une catégorie autorisée compenser un shop suspendu", () => {
    expect(evaluateListing(conforme({ merchantStatus: "SUSPENDED" }), POLITIQUE, NOW).listable).toBe(
      false,
    );
  });

  it("ne laisse pas un statut APPROVED compenser un certificat expiré", () => {
    expect(
      evaluateListing(conforme({ complianceExpiresAt: jours(-1) }), POLITIQUE, NOW).listable,
    ).toBe(false);
  });

  it("ne laisse pas un stock disponible compenser une catégorie interdite", () => {
    expect(
      evaluateListing(conforme({ categorySlug: "FOOD", stock: 999 }), POLITIQUE, NOW)
        .listable,
    ).toBe(false);
  });

  it("rend tous les motifs quand plusieurs gardes tombent ensemble", () => {
    const verdict = evaluateListing(
      conforme({
        merchantStatus: "SUSPENDED",
        complianceStatus: "REJECTED",
        declaredComposition: [],
        declaredAnalytes: [],
        stock: 0,
      }),
      POLITIQUE,
      NOW,
    );
    expect(verdict.blockers).toEqual([
      "MERCHANT_NOT_ACTIVE",
      "COMPLIANCE_NOT_APPROVED",
      "COMPOSITION_NOT_DECLARED",
      "ANALYTE_NOT_DECLARED",
      "OUT_OF_STOCK",
    ]);
  });
});
