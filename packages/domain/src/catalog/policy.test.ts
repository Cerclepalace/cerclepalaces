import { describe, expect, it } from "vitest";

import {
  EMPTY_CATALOGUE_POLICY,
  decideAnalyte,
  decideCategory,
  findProhibitedSubstances,
  supportsAuthorisation,
  type CataloguePolicy,
  type LegalEvidence,
} from "./policy.js";

const NOW = new Date("2026-09-01T10:00:00Z");

const preuve = (overrides: Partial<LegalEvidence> = {}): LegalEvidence => ({
  id: "ev_1",
  kind: "CASE_LAW",
  reference: "Référence citable de la source",
  sourceUrl: null,
  status: "VERIFIED",
  verifiedAt: NOW,
  verifiedBy: "juriste@example.test",
  ...overrides,
});

const politique = (overrides: Partial<CataloguePolicy> = {}): CataloguePolicy => ({
  ...EMPTY_CATALOGUE_POLICY,
  reviewedAt: NOW,
  maxAgeDays: 180,
  ...overrides,
});

describe("preuve juridique", () => {
  it("soutient une autorisation quand elle est vérifiée, datée et attribuée", () => {
    expect(supportsAuthorisation(preuve(), NOW)).toBe(true);
  });

  it("ne soutient rien tant qu'elle n'est pas vérifiée", () => {
    expect(supportsAuthorisation(preuve({ status: "UNVERIFIED" }), NOW)).toBe(false);
  });

  it("cesse de soutenir une autorisation une fois remplacée", () => {
    // Elle reste dans l'historique — c'est ce qui explique une décision passée —
    // mais elle ne porte plus rien.
    expect(supportsAuthorisation(preuve({ status: "SUPERSEDED" }), NOW)).toBe(false);
  });

  it("refuse une case cochée sans vérificateur ni date", () => {
    // « VERIFIED » sans auteur n'est pas une vérification.
    expect(supportsAuthorisation(preuve({ verifiedBy: null }), NOW)).toBe(false);
    expect(supportsAuthorisation(preuve({ verifiedBy: "   " }), NOW)).toBe(false);
    expect(supportsAuthorisation(preuve({ verifiedAt: null }), NOW)).toBe(false);
  });
});

describe("politique vide", () => {
  it("n'autorise rien", () => {
    // Le comportement correct d'un système qui ne sait pas encore.
    expect(decideCategory(EMPTY_CATALOGUE_POLICY, "fleurs-cbd", NOW)).toEqual({
      decision: "UNDECIDED",
      cause: "NO_RULE",
    });
    expect(decideAnalyte(EMPTY_CATALOGUE_POLICY, { analyte: "THC", percent: 0.2 }, NOW)).toMatchObject({
      decision: "UNDECIDED",
      cause: "NO_RULE",
    });
  });
});

describe("catégories", () => {
  const autorisée = politique({
    evidence: [preuve({ id: "ev_source" })],
    categories: [
      {
        categorySlug: "fleurs-cbd",
        decision: "ALLOWED",
        evidenceIds: ["ev_source"],
        decidedAt: NOW,
        note: null,
      },
    ],
  });

  it("autorise une catégorie soutenue par une preuve vérifiée", () => {
    const verdict = decideCategory(autorisée, "fleurs-cbd", NOW);
    expect(verdict.decision).toBe("ALLOWED");
    if (verdict.decision === "ALLOWED") expect(verdict.evidence).toHaveLength(1);
  });

  it("ignore la casse et les espaces du slug", () => {
    expect(decideCategory(autorisée, "  Fleurs-CBD ", NOW).decision).toBe("ALLOWED");
  });

  it("interdit sans exiger de preuve", () => {
    // Refuser de vendre n'a jamais besoin d'être sourcé : se tromper dans ce
    // sens coûte une vente, se tromper dans l'autre coûte autre chose.
    const p = politique({
      categories: [
        { categorySlug: "comestibles", decision: "PROHIBITED", evidenceIds: [], decidedAt: NOW, note: null },
      ],
    });
    expect(decideCategory(p, "comestibles", NOW).decision).toBe("PROHIBITED");
  });

  it("rend une catégorie jamais examinée indécise, pas autorisée", () => {
    // Le cas qui existe réellement aujourd'hui sur presque tout.
    expect(decideCategory(autorisée, "resines", NOW)).toEqual({
      decision: "UNDECIDED",
      cause: "NO_RULE",
    });
  });

  it("rouvre une autorisation dont la preuve n'a jamais été vérifiée", () => {
    const p = politique({
      evidence: [preuve({ id: "ev_source", status: "UNVERIFIED" })],
      categories: [
        { categorySlug: "fleurs-cbd", decision: "ALLOWED", evidenceIds: ["ev_source"], decidedAt: NOW, note: null },
      ],
    });
    expect(decideCategory(p, "fleurs-cbd", NOW)).toEqual({
      decision: "UNDECIDED",
      cause: "AUTHORISATION_UNSUPPORTED",
    });
  });

  it("rouvre une autorisation dont la preuve a été remplacée", () => {
    // Ni autorisé ni interdit : un dossier redevenu ouvert. Le dire ainsi
    // permet de le rouvrir au lieu de le subir.
    const p = politique({
      evidence: [preuve({ id: "ev_source", status: "SUPERSEDED" })],
      categories: [
        { categorySlug: "fleurs-cbd", decision: "ALLOWED", evidenceIds: ["ev_source"], decidedAt: NOW, note: null },
      ],
    });
    expect(decideCategory(p, "fleurs-cbd", NOW)).toEqual({
      decision: "UNDECIDED",
      cause: "AUTHORISATION_UNSUPPORTED",
    });
  });

  it("suffit d'une preuve vérifiée parmi plusieurs", () => {
    const p = politique({
      evidence: [
        preuve({ id: "ev_vieille", status: "SUPERSEDED" }),
        preuve({ id: "ev_neuve" }),
      ],
      categories: [
        {
          categorySlug: "fleurs-cbd",
          decision: "ALLOWED",
          evidenceIds: ["ev_vieille", "ev_neuve"],
          decidedAt: NOW,
          note: null,
        },
      ],
    });
    expect(decideCategory(p, "fleurs-cbd", NOW).decision).toBe("ALLOWED");
  });

  it("ne se laisse pas soutenir par une preuve qu'elle ne cite pas", () => {
    const p = politique({
      evidence: [preuve({ id: "ev_autre" })],
      categories: [
        { categorySlug: "fleurs-cbd", decision: "ALLOWED", evidenceIds: ["ev_absente"], decidedAt: NOW, note: null },
      ],
    });
    expect(decideCategory(p, "fleurs-cbd", NOW).decision).toBe("UNDECIDED");
  });
});

describe("substances prohibées", () => {
  const p = politique({
    prohibitedSubstances: [
      { substance: "Substance-A", aliases: [], evidenceIds: [], decidedAt: NOW },
      { substance: "Substance-B", aliases: [], evidenceIds: [], decidedAt: NOW },
    ],
  });

  it("ne signale rien sur une composition propre", () => {
    expect(findProhibitedSubstances(p, ["eau", "huile de chanvre"])).toEqual([]);
  });

  it("rend toutes les substances trouvées, pas la première", () => {
    // Retirer un ingrédient à la fois pour découvrir le suivant, c'est ne pas
    // comprendre son refus.
    expect(findProhibitedSubstances(p, ["eau", "substance-a", "SUBSTANCE-B"])).toEqual([
      "Substance-A",
      "Substance-B",
    ]);
  });

  it("est une liste de refus, pas d'autorisation", () => {
    // Une substance absente de la liste n'est pas suspecte par défaut : on ne
    // peut pas énumérer tout ce qui est licite.
    expect(findProhibitedSubstances(p, ["ingrédient jamais vu"])).toEqual([]);
    expect(findProhibitedSubstances(EMPTY_CATALOGUE_POLICY, ["substance-a"])).toEqual([]);
  });
});

describe("analytes mesurés", () => {
  const restreint = politique({
    evidence: [preuve({ id: "ev_seuil" })],
    analytes: [
      { analyte: "THC", decision: "RESTRICTED", maxPercent: 0.3, evidenceIds: ["ev_seuil"], decidedAt: NOW },
    ],
  });

  it("accepte un taux sous le plafond configuré", () => {
    expect(decideAnalyte(restreint, { analyte: "THC", percent: 0.2 }, NOW)).toMatchObject({
      decision: "WITHIN_LIMIT",
      maxPercent: 0.3,
    });
  });

  it("accepte un taux exactement égal au plafond", () => {
    // « au plus 0,3 % » n'est pas « moins de 0,3 % ».
    expect(decideAnalyte(restreint, { analyte: "THC", percent: 0.3 }, NOW).decision).toBe("WITHIN_LIMIT");
  });

  it("refuse un taux au-dessus du plafond, en disant lequel et de combien", () => {
    expect(decideAnalyte(restreint, { analyte: "THC", percent: 0.31 }, NOW)).toEqual({
      analyte: "THC",
      decision: "ABOVE_LIMIT",
      declaredPercent: 0.31,
      maxPercent: 0.3,
    });
  });

  it("refuse de statuer quand aucune règle n'existe", () => {
    // C'est ce refus qui garantit qu'aucun seuil ne s'est glissé dans le code
    // sans avoir été décidé.
    expect(decideAnalyte(restreint, { analyte: "CBN", percent: 1 }, NOW)).toEqual({
      analyte: "CBN",
      decision: "UNDECIDED",
      cause: "NO_RULE",
    });
  });

  it("refuse un plafond que personne ne peut sourcer", () => {
    const p = politique({
      evidence: [preuve({ id: "ev_seuil", status: "UNVERIFIED" })],
      analytes: [
        { analyte: "THC", decision: "RESTRICTED", maxPercent: 0.3, evidenceIds: ["ev_seuil"], decidedAt: NOW },
      ],
    });
    expect(decideAnalyte(p, { analyte: "THC", percent: 0.1 }, NOW)).toEqual({
      analyte: "THC",
      decision: "UNDECIDED",
      cause: "RESTRICTION_UNSUPPORTED",
    });
  });

  it("refuse une restriction sans plafond chiffré", () => {
    const p = politique({
      evidence: [preuve({ id: "ev_seuil" })],
      analytes: [
        { analyte: "THC", decision: "RESTRICTED", maxPercent: null, evidenceIds: ["ev_seuil"], decidedAt: NOW },
      ],
    });
    expect(decideAnalyte(p, { analyte: "THC", percent: 0.1 }, NOW)).toEqual({
      analyte: "THC",
      decision: "UNDECIDED",
      cause: "NO_LIMIT_SET",
    });
  });

  it("accepte un analyte explicitement déclaré non restreint", () => {
    // Un acte conscient, pas un oubli — et qui n'exige pas de preuve, puisqu'il
    // n'affirme aucune interdiction.
    const p = politique({
      analytes: [{ analyte: "CBD", decision: "UNRESTRICTED", maxPercent: null, evidenceIds: [], decidedAt: NOW }],
    });
    expect(decideAnalyte(p, { analyte: "CBD", percent: 22 }, NOW)).toEqual({
      analyte: "CBD",
      decision: "UNRESTRICTED",
    });
  });

  it("ignore la casse du nom d'analyte", () => {
    expect(decideAnalyte(restreint, { analyte: " thc ", percent: 0.1 }, NOW).decision).toBe(
      "WITHIN_LIMIT",
    );
  });
});
