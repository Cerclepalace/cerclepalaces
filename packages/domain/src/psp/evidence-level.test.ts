/**
 * L'axe de preuve, et la frontière qui le sépare de la décision.
 *
 * Deux choses sont vérifiées ici, et la seconde compte autant que la première :
 * que le niveau se dérive correctement des champs d'une réponse, et qu'il ne
 * touche jamais à ce que le verdict décide.
 */

import { describe, expect, it } from "vitest";

import {
  PROVIDER_EVIDENCE_LEVELS,
  missingForOpposability,
  qualificationEvidenceLevel,
  responseEvidenceLevel,
} from "./evidence-level.js";
import { assessQualification, type QualificationResponse } from "./qualification.js";
import { NUVEI, PROVIDER_DOSSIERS, ROXPAY, STANCER, STRIPE } from "./registre.js";

const LE_JOUR = new Date("2026-08-26T00:00:00Z");

const réponse = (overrides: Partial<QualificationResponse> = {}): QualificationResponse => ({
  point: "ACTIVITY_ACCEPTED",
  answer: "YES",
  source: "WRITTEN_EMAIL",
  answeredAt: LE_JOUR,
  reference: "thr-123",
  conditions: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// La dérivation
// ---------------------------------------------------------------------------

describe("le niveau se dérive des seuls champs de la réponse", () => {
  it("trois niveaux, pas un quatrième", () => {
    expect(PROVIDER_EVIDENCE_LEVELS).toEqual(["VERIFIED", "CONVERGENT", "UNVERIFIED"]);
  });

  it("source engageante, datée, retrouvable : opposable", () => {
    expect(responseEvidenceLevel(réponse())).toBe("VERIFIED");
    expect(missingForOpposability(réponse())).toBeNull();
  });

  it("datée mais sans référence : établie, non opposable", () => {
    const r = réponse({ reference: null });
    expect(responseEvidenceLevel(r)).toBe("CONVERGENT");
    expect(missingForOpposability(r)).toContain("Référence d'archive");
  });

  it("une référence vide ne vaut pas une référence", () => {
    expect(responseEvidenceLevel(réponse({ reference: "   " }))).toBe("CONVERGENT");
  });

  it("sans date, rien n'est établi", () => {
    expect(responseEvidenceLevel(réponse({ answeredAt: null }))).toBe("UNVERIFIED");
    expect(responseEvidenceLevel(réponse({ answeredAt: new Date("invalide") }))).toBe("UNVERIFIED");
  });

  it("les quatre sources non opposables n'établissent rien, même complètes", () => {
    // Le pendant, côté preuve, de la règle qui veut qu'aucune de ces sources ne
    // qualifie jamais : une date et une référence ne rachètent pas la source.
    for (const source of ["SALES_CALL", "TECHNICAL_DOCUMENTATION", "SANDBOX_ACCESS", "MARKETING_PAGE"] as const) {
      const r = réponse({ source });
      expect(responseEvidenceLevel(r), source).toBe("UNVERIFIED");
      expect(missingForOpposability(r), source).toContain("n'engage pas");
    }
  });

  it("le niveau ignore le contenu de la réponse", () => {
    // Un refus parfaitement archivé et une acceptation parfaitement archivée
    // sont tous deux opposables. La force d'une preuve ne dépend pas de ce qui
    // nous arrange.
    for (const answer of ["YES", "NO", "YES_WITH_CONDITIONS", "NO_ANSWER", "UNKNOWN"] as const) {
      expect(responseEvidenceLevel(réponse({ answer })), answer).toBe("VERIFIED");
    }
  });

  it("un dossier sans réponse n'établit rien", () => {
    expect(qualificationEvidenceLevel([])).toBe("UNVERIFIED");
  });

  it("un dossier prend le niveau de sa réponse la mieux établie", () => {
    expect(
      qualificationEvidenceLevel([réponse({ reference: null }), réponse()]),
    ).toBe("VERIFIED");
    expect(
      qualificationEvidenceLevel([réponse({ source: "SALES_CALL" }), réponse({ reference: null })]),
    ).toBe("CONVERGENT");
  });
});

// ---------------------------------------------------------------------------
// Les neuf dossiers réels
// ---------------------------------------------------------------------------

describe("les neuf dossiers réels, tels que le registre les porte", () => {
  it("les trois refus écrits sont établis sans être opposables", () => {
    // Constat, non arbitrage : les trois portent des champs de preuve
    // identiques — WRITTEN_EMAIL, une date, aucune référence d'archive. Rien
    // dans le registre typé ne les distingue, et ce test ne prétend pas le
    // contraire. Voir la note du dossier Nuvei dans docs/PSP-REGISTRE.md.
    for (const dossier of [NUVEI, ROXPAY, STANCER]) {
      expect(
        qualificationEvidenceLevel(dossier.qualification.responses),
        dossier.providerName,
      ).toBe("CONVERGENT");
    }
  });

  it("les six autres n'établissent rien", () => {
    const sansPreuve = PROVIDER_DOSSIERS.filter(
      (d) => ![NUVEI, ROXPAY, STANCER].includes(d),
    );
    expect(sansPreuve).toHaveLength(6);
    for (const dossier of sansPreuve) {
      expect(
        qualificationEvidenceLevel(dossier.qualification.responses),
        dossier.providerName,
      ).toBe("UNVERIFIED");
    }
  });

  it("Stripe n'établit rien, faute de réponse et non faute de preuve", () => {
    expect(STRIPE.qualification.responses).toEqual([]);
    expect(qualificationEvidenceLevel(STRIPE.qualification.responses)).toBe("UNVERIFIED");
  });

  it("aucun dossier n'atteint le niveau opposable", () => {
    const opposables = PROVIDER_DOSSIERS.filter(
      (d) => qualificationEvidenceLevel(d.qualification.responses) === "VERIFIED",
    ).map((d) => d.providerName);
    expect(opposables).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// L'orthogonalité
// ---------------------------------------------------------------------------

describe("le niveau de preuve ne touche pas au verdict", () => {
  it("les neuf dossiers restent non qualifiés, quel que soit leur niveau", () => {
    for (const dossier of PROVIDER_DOSSIERS) {
      expect(assessQualification(dossier.qualification).qualified, dossier.providerName).toBe(false);
    }
  });

  it("deux réponses de niveaux différents peuvent partager un verdict", () => {
    // C'est l'orthogonalité, montrée plutôt qu'affirmée : un refus opposable et
    // un refus non retrouvable rendent le même verdict et diffèrent d'un niveau.
    const opposable = réponse({ answer: "NO" });
    const nonRetrouvable = réponse({ answer: "NO", reference: null });

    const verdicts = [opposable, nonRetrouvable].map(
      (r) =>
        assessQualification({ providerName: "X", responses: [r] }).qualified === false
          ? "bloquant"
          : "qualifié",
    );
    expect(verdicts).toEqual(["bloquant", "bloquant"]);

    expect(responseEvidenceLevel(opposable)).toBe("VERIFIED");
    expect(responseEvidenceLevel(nonRetrouvable)).toBe("CONVERGENT");
  });

  it("deux réponses de même niveau peuvent avoir des verdicts opposés", () => {
    // La réciproque : même preuve, décisions inverses. Les deux axes ne se
    // déduisent donc ni l'un de l'autre, dans aucun sens.
    const acceptation = réponse({ answer: "YES" });
    const refus = réponse({ answer: "NO" });
    expect(responseEvidenceLevel(acceptation)).toBe(responseEvidenceLevel(refus));

    const v = (r: QualificationResponse): string => {
      const a = assessQualification({ providerName: "X", responses: [r] });
      return a.qualified ? "SATISFIED" : (a.blocking.find((b) => b.point === r.point)?.verdict ?? "?");
    };
    expect(v(acceptation)).not.toBe(v(refus));
  });
});
