/**
 * Tests adversariaux des gates A-08, A-10, A-12 et A-14.
 *
 * Même discipline que `adversarial.test.ts` : chaque test décrit une tentative
 * de contournement, pas un parcours nominal. Les substances, catégories et
 * seuils utilisés ici sont **fictifs** et n'affirment aucun droit.
 */

import { describe, expect, it } from "vitest";

import {
  CRITICAL_KYB_FIELDS,
  MERCHANT_STATUSES,
  applyCriticalChange,
  assertMerchantTransition,
  canSell,
  detectCriticalChanges,
  type CriticalKybSnapshot,
  type KybDossier,
  type MerchantStatus,
} from "../merchant/status.js";
import { evaluateListing, type ListingCandidate } from "./listing-gate.js";
import type { ComplianceSubmission } from "./publication.js";
import {
  PRODUCT_CATEGORIES,
  decideCategory,
  evaluateConditionalAnalytes,
  findDuplicateEvidenceIds,
  isProductCategory,
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

const POLITIQUE: CataloguePolicy = {
  evidence: [preuve],
  categories: [
    { categorySlug: "FLOWER", decision: "ALLOWED", evidenceIds: ["ev_source"], decidedAt: NOW, note: null },
    { categorySlug: "FOOD", decision: "PROHIBITED", evidenceIds: [], decidedAt: NOW, note: null },
  ],
  prohibitedSubstances: [],
  analytes: [
    { analyte: "ANALYTE-A", decision: "RESTRICTED", maxPercent: 1, evidenceIds: ["ev_source"], decidedAt: NOW },
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

const conforme = (overrides: Partial<ListingCandidate> = {}): ListingCandidate => ({
  submission: {
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
  },
  merchantStatus: "ACTIVE",
  kyb,
  complianceStatus: "APPROVED",
  complianceExpiresAt: jours(90),
  categorySlug: "FLOWER",
  declaredComposition: ["ingrédient neutre"],
  declaredAnalytes: [{ analyte: "ANALYTE-A", percent: 0.5 }],
  isListed: true,
  stock: 10,
  priceCents: 1_000,
  ...overrides,
});

it("le candidat de référence passe", () => {
  expect(evaluateListing(conforme(), POLITIQUE, NOW).listable).toBe(true);
});

// ---------------------------------------------------------------------------
// A-08 — taxonomie
// ---------------------------------------------------------------------------

describe("A-08 — faire passer une catégorie qui n'en est pas une", () => {
  const hostiles: readonly unknown[] = [
    undefined, null, "", "   ", "flower", "Flower", "FLOWER ", " FLOWER",
    "FLEURS", "CBD", "cbd", "FLOWER;FOOD", 0, 1, true, {}, ["FLOWER"],
  ];

  it("refuse toute valeur hors de la taxonomie", () => {
    for (const valeur of hostiles) {
      expect(decideCategory(POLITIQUE, valeur, NOW), JSON.stringify(valeur)).toEqual({
        decision: "UNDECIDED",
        cause: "NOT_A_CATEGORY",
      });
    }
  });

  it("bloque le portail sur une catégorie qui n'existe pas", () => {
    const verdict = evaluateListing(conforme({ categorySlug: "CBD" }), POLITIQUE, NOW);
    expect(verdict.listable).toBe(false);
    expect(verdict.blockers).toContain("CATEGORY_UNKNOWN");
  });

  it("ne connaît aucune catégorie « CBD »", () => {
    // Un produit au CBD peut être une fleur, une huile, un aliment ou un
    // cosmétique, et ces natures ne relèvent pas des mêmes règles.
    expect(isProductCategory("CBD")).toBe(false);
    expect(PRODUCT_CATEGORIES).not.toContain("CBD" as never);
  });

  it("ferme PROHIBITED_DERIVATIVE même si la politique l'autorise", () => {
    // Le seul endroit où le code refuse d'obéir à sa propre politique.
    const complaisante: CataloguePolicy = {
      ...POLITIQUE,
      categories: [
        ...POLITIQUE.categories,
        {
          categorySlug: "PROHIBITED_DERIVATIVE",
          decision: "ALLOWED",
          evidenceIds: ["ev_source"],
          decidedAt: NOW,
          note: null,
        },
      ],
    };
    expect(decideCategory(complaisante, "PROHIBITED_DERIVATIVE", NOW).decision).toBe("PROHIBITED");
    expect(
      evaluateListing(conforme({ categorySlug: "PROHIBITED_DERIVATIVE" }), complaisante, NOW)
        .blockers,
    ).toContain("CATEGORY_PROHIBITED");
  });

  it("n'ouvre jamais OTHER, même avec une preuve vérifiée", () => {
    // OTHER n'est pas une catégorie : c'est l'absence de classement.
    const complaisante: CataloguePolicy = {
      ...POLITIQUE,
      categories: [
        ...POLITIQUE.categories,
        { categorySlug: "OTHER", decision: "ALLOWED", evidenceIds: ["ev_source"], decidedAt: NOW, note: null },
      ],
    };
    expect(decideCategory(complaisante, "OTHER", NOW)).toEqual({
      decision: "UNDECIDED",
      cause: "UNCLASSIFIED",
    });
    expect(evaluateListing(conforme({ categorySlug: "OTHER" }), complaisante, NOW).blockers).toContain(
      "CATEGORY_UNCLASSIFIED",
    );
  });

  it("distingue les quatre refus de catégorie", () => {
    // Chacun se corrige autrement : classer, saisir correctement, demander une
    // décision, ou renoncer.
    const cas = [
      ["INEXISTANTE", "CATEGORY_UNKNOWN"],
      ["OTHER", "CATEGORY_UNCLASSIFIED"],
      ["RESIN", "CATEGORY_UNDECIDED"],
      ["FOOD", "CATEGORY_PROHIBITED"],
    ] as const;
    for (const [slug, attendu] of cas) {
      expect(
        evaluateListing(conforme({ categorySlug: slug }), POLITIQUE, NOW).blockers,
        slug,
      ).toContain(attendu);
    }
  });

  it("dit explicitement que déclarer n'est pas prouver", () => {
    // Limite structurelle assumée : un produit déclaré FLOWER alors qu'il
    // relève de PROHIBITED_DERIVATIVE franchit toutes les portes de ce module.
    // Aucun code ne lit la matière ; seul le contrôle humain le peut.
    expect(evaluateListing(conforme({ categorySlug: "FLOWER" }), POLITIQUE, NOW).listable).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// A-10 — changement critique
// ---------------------------------------------------------------------------

describe("A-10 — vendre après un changement critique du dossier", () => {
  const avant: CriticalKybSnapshot = {
    beneficialOwnerRef: "person-1",
    bankAccountRef: "sha256:aaa",
    legalForm: "SAS",
    registrationNumber: "912 345 678 00019",
    legalName: "Cercle Palace SAS",
  };

  it("détecte chacun des cinq champs critiques", () => {
    const modifications: readonly (readonly [keyof CriticalKybSnapshot, string])[] = [
      ["beneficialOwnerRef", "person-2"],
      ["bankAccountRef", "sha256:bbb"],
      ["legalForm", "SARL"],
      ["registrationNumber", "000 000 000 00000"],
      ["legalName", "Autre Enseigne SAS"],
    ];
    for (const [clé, valeur] of modifications) {
      const détecté = detectCriticalChanges(avant, { ...avant, [clé]: valeur });
      expect(détecté, clé).toHaveLength(1);
      expect(CRITICAL_KYB_FIELDS, clé).toContain(détecté[0]);
    }
  });

  it("ne se déclenche pas sur une correction de frappe", () => {
    // Relancer un examen KYB sur un espace en trop userait la procédure au
    // point qu'on cesserait de la respecter.
    expect(
      detectCriticalChanges(avant, { ...avant, legalName: "  cercle   palace  sas " }),
    ).toEqual([]);
  });

  it("traite l'effacement d'une valeur comme un changement", () => {
    expect(detectCriticalChanges(avant, { ...avant, registrationNumber: null })).toEqual([
      "REGISTRATION_NUMBER",
    ]);
  });

  it("rend tous les champs modifiés, pas le premier", () => {
    const après = { ...avant, legalForm: "SARL", legalName: "Autre" };
    expect([...detectCriticalChanges(avant, après)].sort()).toEqual(["LEGAL_FORM", "LEGAL_NAME"]);
  });

  it("renvoie un shop ACTIVE à l'examen, et il ne vend plus", () => {
    const résultat = applyCriticalChange({
      status: "ACTIVE",
      before: avant,
      after: { ...avant, beneficialOwnerRef: "person-2" },
    });
    expect(résultat).toEqual({
      applies: true,
      toStatus: "KYB_REVIEW",
      changed: ["BENEFICIAL_OWNER"],
    });
    if (!résultat.applies) return;

    // La transition passe par la garde commune, sans passe-droit.
    const nouveau = assertMerchantTransition("ACTIVE", résultat.toStatus, "system", kyb).to;
    expect(nouveau).toBe("KYB_REVIEW");
    expect(canSell(nouveau)).toBe(false);
  });

  it("renvoie aussi un shop APPROVED à l'examen", () => {
    expect(
      applyCriticalChange({
        status: "APPROVED",
        before: avant,
        after: { ...avant, bankAccountRef: "sha256:ccc" },
      }),
    ).toMatchObject({ applies: true, toStatus: "KYB_REVIEW" });
  });

  it("ne déclenche rien quand aucun champ critique ne bouge", () => {
    expect(applyCriticalChange({ status: "ACTIVE", before: avant, after: avant })).toEqual({
      applies: false,
      reason: "NO_CRITICAL_CHANGE",
    });
  });

  it("ne réexamine pas un dossier jamais approuvé ni un shop fermé", () => {
    for (const statut of ["PENDING_VALIDATION", "KYB_REVIEW", "CLOSED"] as const) {
      expect(
        applyCriticalChange({
          status: statut,
          before: avant,
          after: { ...avant, legalForm: "SARL" },
        }),
        statut,
      ).toEqual({ applies: false, reason: "NOT_REVIEWABLE" });
    }
  });

  it("impose de repasser par l'approbation puis l'ouverture pour revendre", () => {
    // Aucun raccourci : KYB_REVIEW ne mène pas directement à ACTIVE.
    let statut: MerchantStatus = "KYB_REVIEW";
    expect(() => assertMerchantTransition(statut, "ACTIVE", "admin", kyb)).toThrow();
    statut = assertMerchantTransition(statut, "APPROVED", "admin", kyb).to;
    expect(canSell(statut)).toBe(false);
    statut = assertMerchantTransition(statut, "ACTIVE", "admin", kyb).to;
    expect(canSell(statut)).toBe(true);
  });

  it("garde un seul état vendeur qui vend", () => {
    const vendeurs = MERCHANT_STATUSES.filter((statut) => canSell(statut));
    expect(vendeurs).toEqual(["ACTIVE"]);
  });
});

// ---------------------------------------------------------------------------
// A-12 — dépendances entre analyses
// ---------------------------------------------------------------------------

describe("A-12 — échapper à une analyse rendue obligatoire", () => {
  const avecCondition: CataloguePolicy = {
    ...POLITIQUE,
    conditionalAnalytes: [
      {
        id: "COND-1",
        triggerAnalyte: "ANALYTE-A",
        triggerAbovePercent: 0.2,
        requiredAnalytes: ["ANALYTE-B"],
        evidenceIds: ["ev_source"],
        decidedAt: NOW,
      },
    ],
  };

  it("ne déclenche rien sous le seuil", () => {
    expect(
      evaluateConditionalAnalytes(avecCondition, [{ analyte: "ANALYTE-A", percent: 0.1 }], NOW),
    ).toEqual([]);
  });

  it("ne déclenche rien si l'analyte déclencheur n'est pas mesuré", () => {
    expect(evaluateConditionalAnalytes(avecCondition, [], NOW)).toEqual([]);
  });

  it("est satisfaite quand l'analyse exigée est présente", () => {
    expect(
      evaluateConditionalAnalytes(
        avecCondition,
        [
          { analyte: "ANALYTE-A", percent: 0.5 },
          { analyte: "ANALYTE-B", percent: 0 },
        ],
        NOW,
      ),
    ).toEqual([{ ruleId: "COND-1", outcome: "SATISFIED", triggeredBy: "ANALYTE-A" }]);
  });

  it("refuse quand l'analyse exigée manque", () => {
    const verdict = evaluateListing(
      conforme({ declaredAnalytes: [{ analyte: "ANALYTE-A", percent: 0.5 }] }),
      avecCondition,
      NOW,
    );
    expect(verdict.listable).toBe(false);
    expect(verdict.blockers).toContain("CONDITIONAL_ANALYTE_MISSING");
    expect(verdict.findings.at(-1)?.detail ?? "").toContain("ANALYTE-B");
  });

  it("refuse une dépendance que personne ne peut sourcer", () => {
    // Ni blocage silencieux, ni effacement silencieux.
    const sansPreuve: CataloguePolicy = { ...avecCondition, evidence: [] };
    const résultats = evaluateConditionalAnalytes(
      sansPreuve,
      [{ analyte: "ANALYTE-A", percent: 0.5 }],
      NOW,
    );
    expect(résultats).toEqual([
      { ruleId: "COND-1", outcome: "UNSUPPORTED", triggeredBy: "ANALYTE-A" },
    ]);
  });

  it("ne déclenche pas sur une mesure invalide", () => {
    // Elle est déjà refusée ailleurs ; la compter ici produirait deux motifs
    // pour une seule cause.
    for (const valeur of [Number.NaN, -1, 500]) {
      expect(
        evaluateConditionalAnalytes(avecCondition, [{ analyte: "ANALYTE-A", percent: valeur }], NOW),
        String(valeur),
      ).toEqual([]);
    }
  });

  it("déclenche dès la mesure quand aucun seuil n'est fixé", () => {
    const sansSeuil: CataloguePolicy = {
      ...avecCondition,
      conditionalAnalytes: [{ ...avecCondition.conditionalAnalytes[0]!, triggerAbovePercent: null }],
    };
    expect(
      evaluateConditionalAnalytes(sansSeuil, [{ analyte: "ANALYTE-A", percent: 0 }], NOW),
    ).toHaveLength(1);
  });

  it("évalue toutes les conditions, sans court-circuit", () => {
    const deux: CataloguePolicy = {
      ...avecCondition,
      conditionalAnalytes: [
        ...avecCondition.conditionalAnalytes,
        {
          id: "COND-2",
          triggerAnalyte: "ANALYTE-A",
          triggerAbovePercent: 0.2,
          requiredAnalytes: ["ANALYTE-C", "ANALYTE-D"],
          evidenceIds: ["ev_source"],
          decidedAt: NOW,
        },
      ],
    };
    const verdict = evaluateListing(
      conforme({ declaredAnalytes: [{ analyte: "ANALYTE-A", percent: 0.5 }] }),
      deux,
      NOW,
    );
    const manquants = verdict.findings.filter((f) => f.blocker === "CONDITIONAL_ANALYTE_MISSING");
    expect(manquants).toHaveLength(2);
    expect(manquants[1]?.detail).toContain("ANALYTE-C, ANALYTE-D");
  });

  it("cumule les motifs conditionnels avec les autres", () => {
    const verdict = evaluateListing(
      conforme({
        merchantStatus: "SUSPENDED",
        declaredAnalytes: [{ analyte: "ANALYTE-A", percent: 0.5 }],
        stock: 0,
      }),
      avecCondition,
      NOW,
    );
    expect(verdict.blockers).toEqual([
      "MERCHANT_NOT_ACTIVE",
      "CONDITIONAL_ANALYTE_MISSING",
      "OUT_OF_STOCK",
    ]);
  });
});

// ---------------------------------------------------------------------------
// A-14 — unicité des identifiants de preuve
// ---------------------------------------------------------------------------

describe("A-14 — ouvrir une catégorie en dupliquant un identifiant", () => {
  it("ne signale rien sur un registre sain", () => {
    expect(findDuplicateEvidenceIds([])).toEqual([]);
    expect(findDuplicateEvidenceIds([preuve, { ...preuve, id: "ev_2" }])).toEqual([]);
  });

  it("tolère deux preuves citant la même source", () => {
    // `reference` peut légitimement se répéter : deux règles peuvent s'appuyer
    // sur le même texte. C'est l'identifiant qui doit être unique.
    expect(
      findDuplicateEvidenceIds([preuve, { ...preuve, id: "ev_2", reference: preuve.reference }]),
    ).toEqual([]);
  });

  it("signale un identifiant partagé", () => {
    expect(
      findDuplicateEvidenceIds([preuve, { ...preuve, status: "UNVERIFIED" }]),
    ).toEqual([{ id: "ev_source", count: 2 }]);
  });

  it("ferme la catégorie dont l'identifiant de preuve est ambigu", () => {
    // Sans cela, il suffirait d'ajouter une ligne homonyme pour qu'une preuve
    // non vérifiée soit couverte par une vérifiée.
    const ambigu: CataloguePolicy = {
      ...POLITIQUE,
      evidence: [preuve, { ...preuve, status: "UNVERIFIED", verifiedBy: null }],
    };
    expect(decideCategory(ambigu, "FLOWER", NOW)).toEqual({
      decision: "UNDECIDED",
      cause: "AUTHORISATION_UNSUPPORTED",
    });
    expect(evaluateListing(conforme(), ambigu, NOW).listable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A-08 (suite) — certificat : delta-9 et THC total ne se substituent pas
// ---------------------------------------------------------------------------

describe("A-08 — faire accepter un certificat invalide", () => {
  const coa: ComplianceSubmission = {
    productName: "Produit de test",
    laboratory: "Laboratoire de test",
    batchNumber: "LOT-TEST-1",
    supplier: "Fournisseur de test",
    delta9ThcPercent: 0.2,
    totalThcPercent: 0.25,
    cbdContent: 10,
    issuedAt: jours(-1),
    expiresAt: jours(365),
    documentKinds: ["CERTIFICATE_OF_ANALYSIS"],
  };

  const refus = (patch: Partial<ComplianceSubmission>, attendu: string): void => {
    const verdict = evaluateListing(
      conforme({ submission: { ...coa, ...patch } }),
      POLITIQUE,
      NOW,
    );
    expect(verdict.listable).toBe(false);
    expect(verdict.findings.map((f) => f.detail).join(" "), attendu).toContain(attendu);
  };

  it("refuse un certificat absent", () => {
    refus({ documentKinds: [] }, "MISSING_CERTIFICATE_OF_ANALYSIS");
  });

  it("refuse un laboratoire absent", () => {
    // Un COA sans émetteur n'engage personne : rien à recontacter, personne à
    // opposer.
    refus({ laboratory: null }, "MISSING_LABORATORY");
    refus({ laboratory: "   " }, "MISSING_LABORATORY");
  });

  it("refuse un lot absent", () => {
    refus({ batchNumber: null }, "MISSING_BATCH_NUMBER");
  });

  it("refuse une date d'émission absente, illisible ou future", () => {
    refus({ issuedAt: null }, "MISSING_ISSUE_DATE");
    refus({ issuedAt: new Date("pas une date") }, "INVALID_ISSUE_DATE");
    // Une analyse ne peut pas avoir été faite demain.
    refus({ issuedAt: jours(1) }, "ISSUE_DATE_IN_FUTURE");
  });

  it("refuse un certificat expiré, et une date d'expiration illisible", () => {
    refus({ expiresAt: jours(-1) }, "CERTIFICATE_ALREADY_EXPIRED");
    refus({ expiresAt: NOW }, "CERTIFICATE_ALREADY_EXPIRED");
    refus({ expiresAt: new Date("nawak") }, "CERTIFICATE_ALREADY_EXPIRED");
  });

  it("refuse un delta-9 négatif ou non numérique", () => {
    refus({ delta9ThcPercent: -1 }, "INVALID_MEASUREMENT");
    refus({ delta9ThcPercent: Number.NaN }, "INVALID_MEASUREMENT");
    refus({ delta9ThcPercent: 500 }, "INVALID_MEASUREMENT");
  });

  it("distingue « non déclaré » de « déclaré n'importe comment »", () => {
    // Les deux se corrigent différemment.
    refus({ delta9ThcPercent: null }, "MISSING_DECLARED_CONTENTS");
    refus({ delta9ThcPercent: Number.NaN }, "INVALID_MEASUREMENT");
  });

  it("confronte le delta-9 au plafond, et lui seul", () => {
    // Le plafond de la politique de test porte sur DELTA9_THC. Un THC total
    // au-dessus de ce chiffre ne doit rien déclencher : il est informatif.
    const verdict = evaluateListing(
      conforme({ submission: { ...coa, delta9ThcPercent: 0.9 } }),
      POLITIQUE,
      NOW,
    );
    expect(verdict.blockers).toContain("ANALYTE_ABOVE_LIMIT");

    const totalÉlevé = evaluateListing(
      conforme({ submission: { ...coa, totalThcPercent: 42 } }),
      POLITIQUE,
      NOW,
    );
    expect(totalÉlevé.listable).toBe(true);
  });

  it("ne substitue jamais le THC total au delta-9", () => {
    // Sans delta-9, un THC total renseigné ne comble rien.
    refus({ delta9ThcPercent: null, totalThcPercent: 0.2 }, "MISSING_DECLARED_CONTENTS");
  });

  it("bloque un delta-9 déclaré qu'aucune règle n'encadre", () => {
    const sansRègleThc: CataloguePolicy = {
      ...POLITIQUE,
      analytes: POLITIQUE.analytes.filter((r) => r.analyte !== "DELTA9_THC"),
    };
    expect(evaluateListing(conforme(), sansRègleThc, NOW).blockers).toContain("ANALYTE_UNDECIDED");
  });
});
