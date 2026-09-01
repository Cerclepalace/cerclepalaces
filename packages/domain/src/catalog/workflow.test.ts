/**
 * Le parcours entier, joué du début à la fin.
 *
 * Chaque règle est déjà testée là où elle vit. Ce fichier vérifie autre chose :
 * qu'elles s'enchaînent, et surtout **qu'aucune ne peut être sautée**. Un
 * commerçant qui arriverait au bout sans être validé, ou un produit qui
 * arriverait en rayon sans conformité, n'apparaîtrait dans aucun test unitaire —
 * il apparaît ici.
 */

import { describe, expect, it } from "vitest";

import {
  assertMerchantTransition,
  canActivate,
  checkKybDossier,
  type KybDossier,
  type MerchantStatus,
} from "../merchant/status.js";
import { canChangeCompliance, type ComplianceStatus } from "../compliance/status.js";
import { checkComplianceSubmission } from "./publication.js";
import { evaluateListing, type ListingCandidate } from "./listing-gate.js";
import type { CataloguePolicy, LegalEvidence } from "./policy.js";

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
    { categorySlug: "fleurs-cbd", decision: "ALLOWED", evidenceIds: ["ev_source"], decidedAt: NOW, note: null },
  ],
  prohibitedSubstances: [],
  analytes: [
    { analyte: "THC", decision: "RESTRICTED", maxPercent: 0.3, evidenceIds: ["ev_source"], decidedAt: NOW },
    { analyte: "CBD", decision: "UNRESTRICTED", maxPercent: null, evidenceIds: [], decidedAt: NOW },
  ],
  reviewedAt: NOW,
  maxAgeDays: 180,
};

const dossierVide: KybDossier = {
  legalName: null,
  tradeName: null,
  registrationNumber: null,
  locations: [],
  ownerCount: 0,
};

const dossierComplet: KybDossier = {
  legalName: "Cercle Palace SAS",
  tradeName: "Cercle Palace",
  registrationNumber: "912 345 678 00019",
  locations: [
    { line1: "1 place de la République", postalCode: "75011", city: "Paris", country: "FR" },
  ],
  ownerCount: 1,
};

const dossierCoa = {
  productName: "Fleur CBD — Amnesia",
  batchNumber: "LOT-2026-0417",
  supplier: "Chanvre du Sud SARL",
  thcContent: 0.2,
  cbdContent: 12.4,
  expiresAt: jours(365),
  documentKinds: ["CERTIFICATE_OF_ANALYSIS"],
} as const;

const produit = (overrides: Partial<ListingCandidate>): ListingCandidate => ({
  submission: dossierCoa,
  merchantStatus: "PENDING_VALIDATION",
  kyb: dossierVide,
  complianceStatus: "PENDING_REVIEW",
  complianceExpiresAt: jours(365),
  categorySlug: "fleurs-cbd",
  declaredComposition: ["fleur de chanvre"],
  declaredAnalytes: [
    { analyte: "THC", percent: 0.2 },
    { analyte: "CBD", percent: 12.4 },
  ],
  isListed: true,
  stock: 20,
  priceCents: 1_190,
  ...overrides,
});

describe("vendeur → produit → conformité → mise en vente", () => {
  it("déroule le parcours complet, étape par étape", () => {
    // --- 1. Le shop candidate. Dossier vide : rien ne passe. ---
    let statutShop: MerchantStatus = "PENDING_VALIDATION";
    let dossier = dossierVide;

    expect(checkKybDossier(dossier).complete).toBe(false);
    expect(canActivate(dossier).ok).toBe(false);

    // --- 2. Il complète son dossier. La validation reste une décision admin. ---
    dossier = dossierComplet;
    expect(canActivate(dossier)).toEqual({ ok: true });
    // Le shop ne peut toujours pas se valider lui-même.
    expect(() =>
      assertMerchantTransition(statutShop, "ACTIVE", "merchant_owner", dossier),
    ).toThrow();

    statutShop = assertMerchantTransition(statutShop, "ACTIVE", "admin", dossier).to;
    expect(statutShop).toBe("ACTIVE");

    // --- 3. Il dépose un produit. Sans COA, le dossier n'est pas déposable. ---
    const sansCoa = checkComplianceSubmission(
      {
        productName: "Fleur CBD — Amnesia",
        batchNumber: "LOT-2026-0417",
        supplier: "Chanvre du Sud SARL",
        thcContent: 0.2,
        cbdContent: 12.4,
        expiresAt: jours(365),
        documentKinds: ["SUPPLIER_SHEET"],
      },
      NOW,
    );
    expect(sansCoa.gaps).toEqual(["MISSING_CERTIFICATE_OF_ANALYSIS"]);

    const avecCoa = checkComplianceSubmission(
      {
        productName: "Fleur CBD — Amnesia",
        batchNumber: "LOT-2026-0417",
        supplier: "Chanvre du Sud SARL",
        thcContent: 0.2,
        cbdContent: 12.4,
        expiresAt: jours(365),
        documentKinds: ["SUPPLIER_SHEET", "CERTIFICATE_OF_ANALYSIS"],
      },
      NOW,
    );
    expect(avecCoa.complete).toBe(true);

    // --- 4. Déposé n'est pas approuvé : le produit ne part pas en rayon. ---
    let conformité: ComplianceStatus = "PENDING_REVIEW";
    expect(
      evaluateListing(produit({ merchantStatus: statutShop, kyb: dossier }), POLITIQUE, NOW)
        .blockers,
    ).toEqual(["COMPLIANCE_NOT_APPROVED"]);

    // Et un commerçant ne s'approuve pas non plus lui-même.
    expect(canChangeCompliance(conformité, "APPROVED", "merchant_owner")).toBe(false);
    expect(canChangeCompliance(conformité, "APPROVED", "admin")).toBe(true);
    conformité = "APPROVED";

    // --- 5. Tout est réuni : le produit passe. ---
    const verdict = evaluateListing(
      produit({ merchantStatus: statutShop, kyb: dossier, complianceStatus: conformité }),
      POLITIQUE,
      NOW,
    );
    expect(verdict).toEqual({ listable: true, findings: [], blockers: [] });
  });

  it("retire le produit du rayon si le shop est suspendu ensuite", () => {
    // Le parcours n'est pas un état acquis : chaque étape reste vérifiée à
    // chaque évaluation.
    const enRayon = produit({
      merchantStatus: "ACTIVE",
      kyb: dossierComplet,
      complianceStatus: "APPROVED",
    });
    expect(evaluateListing(enRayon, POLITIQUE, NOW).listable).toBe(true);

    const suspendu = { ...enRayon, merchantStatus: "SUSPENDED" as const };
    expect(evaluateListing(suspendu, POLITIQUE, NOW).blockers).toEqual(["MERCHANT_NOT_ACTIVE"]);
  });

  it("retire le produit du rayon si sa preuve juridique est remplacée", () => {
    // Une source qui tombe rouvre le dossier, sans qu'aucun produit n'ait bougé.
    const enRayon = produit({
      merchantStatus: "ACTIVE",
      kyb: dossierComplet,
      complianceStatus: "APPROVED",
    });
    const politiqueÉbranlée: CataloguePolicy = {
      ...POLITIQUE,
      evidence: [{ ...preuve, status: "SUPERSEDED" }],
    };

    expect(evaluateListing(enRayon, POLITIQUE, NOW).listable).toBe(true);
    expect(evaluateListing(enRayon, politiqueÉbranlée, NOW).blockers).toEqual([
      "CATEGORY_UNDECIDED",
      // Le plafond THC reposait sur la même source : il tombe aussi.
      "ANALYTE_UNDECIDED",
    ]);
  });

  it("retire le produit du rayon le jour où son certificat expire", () => {
    const enRayon = produit({
      merchantStatus: "ACTIVE",
      kyb: dossierComplet,
      complianceStatus: "APPROVED",
      complianceExpiresAt: jours(1),
    });
    expect(evaluateListing(enRayon, POLITIQUE, NOW).listable).toBe(true);
    expect(evaluateListing(enRayon, POLITIQUE, jours(1)).blockers).toEqual(["COMPLIANCE_EXPIRED"]);
  });

  it("ne laisse aucune étape se sauter", () => {
    // Chaque maillon retiré séparément doit bloquer. Si l'un d'eux passait, une
    // porte serait ouverte quelque part.
    const complet = produit({
      merchantStatus: "ACTIVE",
      kyb: dossierComplet,
      complianceStatus: "APPROVED",
    });

    const maillons: readonly (readonly [string, Partial<ListingCandidate>])[] = [
      ["shop non validé", { merchantStatus: "PENDING_VALIDATION" }],
      ["dossier incomplet", { kyb: dossierVide }],
      ["conformité non validée", { complianceStatus: "PENDING_REVIEW" }],
      ["catégorie non tranchée", { categorySlug: "resines" }],
      ["taux hors plafond", { declaredAnalytes: [{ analyte: "THC", percent: 4 }] }],
      ["produit non listé", { isListed: false }],
      ["stock épuisé", { stock: 0 }],
      ["prix absent", { priceCents: null }],
    ];

    for (const [nom, retrait] of maillons) {
      const verdict = evaluateListing({ ...complet, ...retrait }, POLITIQUE, NOW);
      expect(verdict.listable, nom).toBe(false);
      expect(verdict.blockers.length, nom).toBeGreaterThan(0);
    }
  });
});
