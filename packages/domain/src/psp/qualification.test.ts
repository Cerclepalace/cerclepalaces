/**
 * Le verdict par défaut est le refus.
 *
 * Ces tests ne vérifient pas qu'un prestataire est bon — le code n'en juge
 * jamais. Ils vérifient qu'aucune absence, aucune capacité technique et aucune
 * parole ne peut se transformer en qualification.
 */

import { describe, expect, it } from "vitest";

import {
  ACQUIRING_POINTS,
  ANSWER_SOURCES,
  CARD_NETWORK_POINTS,
  BINDING_SOURCES,
  ProviderNotQualifiedError,
  QUALIFICATION_POINTS,
  acquiringStillUnknown,
  assertProviderQualified,
  cardNetworksStillUnknown,
  assessQualification,
  emptyQualification,
  isBindingSource,
  type AnswerSource,
  type ProviderQualification,
  type QualificationAnswer,
  type QualificationPoint,
  type QualificationResponse,
} from "./qualification.js";

const LE_JOUR = new Date("2026-08-26T09:00:00Z");

const réponse = (
  point: QualificationPoint,
  overrides: Partial<QualificationResponse> = {},
): QualificationResponse => ({
  point,
  answer: "YES",
  source: "WRITTEN_EMAIL",
  answeredAt: LE_JOUR,
  reference: "fil-support-4271",
  conditions: null,
  ...overrides,
});

/** Dossier complet et opposable : le seul cas qui doit qualifier. */
const dossierComplet = (
  overrides: Partial<QualificationResponse> = {},
  point?: QualificationPoint,
): ProviderQualification => ({
  providerName: "Prestataire de test",
  responses: QUALIFICATION_POINTS.map((p) =>
    point === undefined || p === point ? réponse(p, overrides) : réponse(p),
  ),
});

describe("un dossier vide n'est pas en attente, il est refusé", () => {
  it("bloque sur les dix-sept points", () => {
    const verdict = assessQualification(emptyQualification("Prestataire de test"));
    expect(verdict.qualified).toBe(false);
    if (verdict.qualified) return;
    expect(verdict.blocking).toHaveLength(QUALIFICATION_POINTS.length);
    expect(verdict.blocking.every((b) => b.verdict === "NOT_ASKED")).toBe(true);
  });

  it("lève quand on tente de l'activer", () => {
    expect(() => assertProviderQualified(emptyQualification("X"))).toThrow(
      ProviderNotQualifiedError,
    );
  });
});

describe("ce qui ne qualifie jamais", () => {
  it("une documentation technique", () => {
    // Une API marketplace documentée est une fonction vendue, pas un risque
    // souscrit.
    const verdict = assessQualification(dossierComplet({ source: "TECHNICAL_DOCUMENTATION" }));
    expect(verdict.qualified).toBe(false);
    if (verdict.qualified) return;
    expect(verdict.blocking.every((b) => b.verdict === "NOT_BINDING")).toBe(true);
  });

  it("un accès bac à sable", () => {
    // Il prouve qu'une intégration est possible, pas qu'elle sera autorisée.
    expect(assessQualification(dossierComplet({ source: "SANDBOX_ACCESS" })).qualified).toBe(false);
  });

  it("un échange commercial oral", () => {
    expect(assessQualification(dossierComplet({ source: "SALES_CALL" })).qualified).toBe(false);
  });

  it("une page commerciale", () => {
    expect(assessQualification(dossierComplet({ source: "MARKETING_PAGE" })).qualified).toBe(false);
  });

  it("une absence de réponse", () => {
    const verdict = assessQualification(dossierComplet({ answer: "NO_ANSWER" }));
    expect(verdict.qualified).toBe(false);
    if (verdict.qualified) return;
    // Distinguée de « jamais demandé » : les deux se traitent autrement.
    expect(verdict.blocking.every((b) => b.verdict === "AWAITING_ANSWER")).toBe(true);
  });

  it("une réponse favorable qu'on ne peut pas retrouver", () => {
    for (const trou of [{ answeredAt: null }, { reference: null }, { reference: "   " }]) {
      const verdict = assessQualification(dossierComplet(trou));
      expect(verdict.qualified, JSON.stringify(trou)).toBe(false);
      if (verdict.qualified) continue;
      expect(verdict.blocking[0]?.verdict).toBe("NOT_TRACEABLE");
    }
  });

  it("un « oui sous conditions » dont les conditions ne sont pas écrites", () => {
    const verdict = assessQualification(
      dossierComplet({ answer: "YES_WITH_CONDITIONS", conditions: null }),
    );
    expect(verdict.qualified).toBe(false);
    if (verdict.qualified) return;
    expect(verdict.blocking[0]?.verdict).toBe("CONDITIONS_MISSING");
  });
});

describe("les réseaux cartes ne se déduisent de rien", () => {
  it("une acceptation prestataire ne confirme ni Visa ni Mastercard", () => {
    // « Stripe accepte donc Visa accepte » : la phrase interdite, écrite ici
    // comme un test pour qu'elle ne puisse pas devenir vraie par accident.
    const qualification: ProviderQualification = {
      providerName: "Prestataire de test",
      responses: [
        réponse("ACTIVITY_ACCEPTED"),
        réponse("PRODUCT_CATEGORIES_ACCEPTED"),
      ],
    };
    const verdict = assessQualification(qualification);
    expect(verdict.qualified).toBe(false);
    if (verdict.qualified) return;
    for (const point of CARD_NETWORK_POINTS) {
      expect(
        verdict.blocking.find((b) => b.point === point)?.verdict,
        point,
      ).toBe("NOT_ASKED");
    }
    expect(cardNetworksStillUnknown(qualification)).toBe(true);
  });

  it("un refus prestataire qui invoque Visa ne renseigne pas Visa", () => {
    // Citer un tiers ne l'engage pas : le refus porte sur son émetteur.
    const qualification: ProviderQualification = {
      providerName: "Prestataire de test",
      responses: [réponse("ACTIVITY_ACCEPTED", { answer: "NO" })],
    };
    expect(cardNetworksStillUnknown(qualification)).toBe(true);
    expect(acquiringStillUnknown(qualification)).toBe(true);
  });

  it("un dossier complet ne laisse plus les réseaux inconnus", () => {
    expect(cardNetworksStillUnknown(dossierComplet())).toBe(false);
  });

  it("Visa confirmé ne confirme pas Mastercard", () => {
    const verdict = assessQualification(
      dossierComplet({ answer: "UNKNOWN" }, "MASTERCARD_ACCEPTANCE_CONFIRMED"),
    );
    expect(verdict.qualified).toBe(false);
    if (verdict.qualified) return;
    expect(verdict.blocking).toEqual([
      { point: "MASTERCARD_ACCEPTANCE_CONFIRMED", verdict: "NOT_ASKED" },
    ]);
  });
});

describe("ce qui qualifie", () => {
  it("dix-sept réponses écrites, datées et référencées", () => {
    expect(assessQualification(dossierComplet())).toEqual({
      qualified: true,
      providerName: "Prestataire de test",
    });
  });

  it("un « oui sous conditions » dont les conditions sont écrites", () => {
    const verdict = assessQualification(
      dossierComplet({
        answer: "YES_WITH_CONDITIONS",
        conditions: "Réserve glissante, plafond de volume mensuel.",
      }),
    );
    expect(verdict.qualified).toBe(true);
  });

  it("chacune des quatre sources opposables", () => {
    for (const source of BINDING_SOURCES) {
      expect(assessQualification(dossierComplet({ source })).qualified, source).toBe(true);
    }
  });
});

describe("un seul point manquant suffit à bloquer", () => {
  it("quel qu'il soit", () => {
    for (const point of QUALIFICATION_POINTS) {
      const partiel: ProviderQualification = {
        providerName: "Prestataire de test",
        responses: QUALIFICATION_POINTS.filter((p) => p !== point).map((p) => réponse(p)),
      };
      const verdict = assessQualification(partiel);
      expect(verdict.qualified, point).toBe(false);
      if (verdict.qualified) continue;
      expect(verdict.blocking.map((b) => b.point), point).toEqual([point]);
    }
  });

  it("un refus n'est un refus que s'il vient d'une source qui engage", () => {
    // Le module déclare que quatre sources ne qualifient jamais. Il serait
    // incohérent qu'elles disqualifient : un refus prononcé au téléphone
    // n'engage pas plus son émetteur qu'une acceptation prononcée au
    // téléphone. Le point reste bloqué — mais le dossier cesse d'affirmer que
    // le prestataire a refusé.
    for (const source of ["SALES_CALL", "MARKETING_PAGE", "SANDBOX_ACCESS", "TECHNICAL_DOCUMENTATION"] as const) {
      const verdict = assessQualification(
        dossierComplet({ answer: "NO", source }, "MODEL_B_ACCEPTED"),
      );
      expect(verdict.qualified, source).toBe(false);
      if (verdict.qualified) return;
      expect(verdict.blocking, source).toEqual([
        { point: "MODEL_B_ACCEPTED", verdict: "NOT_BINDING" },
      ]);
    }
  });

  it("les quatre sources opposables rendent bien un refus", () => {
    for (const source of ["WRITTEN_EMAIL", "SIGNED_CONTRACT", "OFFICIAL_LETTER", "MERCHANT_PORTAL_DECISION"] as const) {
      const verdict = assessQualification(
        dossierComplet({ answer: "NO", source }, "MODEL_B_ACCEPTED"),
      );
      expect(verdict.qualified, source).toBe(false);
      if (verdict.qualified) return;
      expect(verdict.blocking, source).toEqual([
        { point: "MODEL_B_ACCEPTED", verdict: "REFUSED" },
      ]);
    }
  });

  it("un refus opposable reste un refus sans référence d'archive", () => {
    // L'état exact des trois refus du registre. Ce qui leur manque se dit sur
    // l'axe de preuve, pas dans le verdict — d'où l'ordre des contrôles.
    const verdict = assessQualification(
      dossierComplet({ answer: "NO", reference: null }, "MODEL_B_ACCEPTED"),
    );
    expect(verdict.qualified).toBe(false);
    if (verdict.qualified) return;
    expect(verdict.blocking).toEqual([{ point: "MODEL_B_ACCEPTED", verdict: "REFUSED" }]);
  });

  it("une absence de réponse ne reçoit aucune signification de source", () => {
    // Un silence n'a pas d'émetteur. Lire la source d'une réponse qui n'existe
    // pas reviendrait à lui en inventer un — et transformerait « personne n'a
    // répondu » en « quelqu'un a répondu sans engagement ».
    for (const source of ["SALES_CALL", "WRITTEN_EMAIL"] as const) {
      const attente = assessQualification(
        dossierComplet({ answer: "NO_ANSWER", source }, "MODEL_B_ACCEPTED"),
      );
      if (attente.qualified) return;
      expect(attente.blocking, source).toEqual([
        { point: "MODEL_B_ACCEPTED", verdict: "AWAITING_ANSWER" },
      ]);

      const jamaisDemandé = assessQualification(
        dossierComplet({ answer: "UNKNOWN", source }, "MODEL_B_ACCEPTED"),
      );
      if (jamaisDemandé.qualified) return;
      expect(jamaisDemandé.blocking, source).toEqual([
        { point: "MODEL_B_ACCEPTED", verdict: "NOT_ASKED" },
      ]);
    }
  });

  it("un refus explicite sur un seul point est bloquant", () => {
    const verdict = assessQualification(dossierComplet({ answer: "NO" }, "MODEL_B_ACCEPTED"));
    expect(verdict.qualified).toBe(false);
    if (verdict.qualified) return;
    expect(verdict.blocking).toEqual([{ point: "MODEL_B_ACCEPTED", verdict: "REFUSED" }]);
  });
});

describe("le prestataire n'est pas l'acquéreur", () => {
  it("dit que l'acquéreur reste inconnu même quand le prestataire a répondu", () => {
    // L'état le plus fréquent du dossier : « ils sont d'accord » sans que
    // personne ne sache qui souscrit le risque.
    const partiel: ProviderQualification = {
      providerName: "Prestataire de test",
      responses: QUALIFICATION_POINTS.filter(
        (point) => !ACQUIRING_POINTS.includes(point),
      ).map((point) => réponse(point)),
    };

    expect(acquiringStillUnknown(partiel)).toBe(true);
    const verdict = assessQualification(partiel);
    if (verdict.qualified) throw new Error("ne devrait pas qualifier");
    expect(verdict.blocking.map((b) => b.point).sort()).toEqual([...ACQUIRING_POINTS].sort());
  });

  it("ne signale plus rien quand l'acquéreur est nommé et le dossier complet", () => {
    expect(acquiringStillUnknown(dossierComplet())).toBe(false);
  });

  it("sépare bien les points acquéreur des points prestataire", () => {
    for (const point of ACQUIRING_POINTS) {
      expect(QUALIFICATION_POINTS).toContain(point);
    }
    expect(ACQUIRING_POINTS).not.toContain("ACTIVITY_ACCEPTED" as never);
  });
});

describe("intégrité du modèle", () => {
  it("rend tous les points bloquants, jamais le premier seulement", () => {
    const verdict = assessQualification(emptyQualification("X"));
    if (verdict.qualified) throw new Error("ne devrait pas qualifier");
    expect(verdict.blocking.length).toBeGreaterThan(1);
  });

  it("n'a aucune source à la fois opposable et non opposable", () => {
    const nonOpposables = ANSWER_SOURCES.filter((s) => !isBindingSource(s));
    expect(nonOpposables).toEqual([
      "SALES_CALL",
      "TECHNICAL_DOCUMENTATION",
      "SANDBOX_ACCESS",
      "MARKETING_PAGE",
    ]);
  });

  it("nomme les dix-sept points sans doublon", () => {
    expect(new Set(QUALIFICATION_POINTS).size).toBe(17);
  });

  it("sépare les réseaux cartes du prestataire et de l'acquéreur", () => {
    // Trois niveaux qui décident indépendamment. Les fondre ferait qu'une
    // acceptation prestataire vaudrait acceptation Visa — l'inférence que ce
    // module existe pour interdire.
    expect(CARD_NETWORK_POINTS).toEqual([
      "VISA_ACCEPTANCE_CONFIRMED",
      "MASTERCARD_ACCEPTANCE_CONFIRMED",
    ]);
    for (const point of CARD_NETWORK_POINTS) {
      expect(ACQUIRING_POINTS, point).not.toContain(point);
    }
  });

  it("porte une case pour la sortie, pas seulement pour l'entrée", () => {
    expect(QUALIFICATION_POINTS).toContain("TERMINATION_CONDITIONS_STATED");
    expect(QUALIFICATION_POINTS).toContain("PRODUCTION_CONDITIONS_STATED");
  });

  it("couvre chaque réponse possible", () => {
    const toutes: readonly QualificationAnswer[] = [
      "YES",
      "NO",
      "YES_WITH_CONDITIONS",
      "NO_ANSWER",
      "UNKNOWN",
    ];
    for (const answer of toutes) {
      const verdict = assessQualification(dossierComplet({ answer, conditions: "écrites" }));
      // Seules deux réponses peuvent qualifier ; les trois autres bloquent.
      expect(verdict.qualified, answer).toBe(answer === "YES" || answer === "YES_WITH_CONDITIONS");
    }
  });

  it("est déterministe", () => {
    const dossier = dossierComplet({ answer: "NO_ANSWER" });
    expect(assessQualification(dossier)).toEqual(assessQualification(dossier));
  });

  it("ne connaît aucune source hors de la liste fermée", () => {
    const inventée = "PHONE_CALL_FROM_A_FRIEND" as unknown as AnswerSource;
    expect(assessQualification(dossierComplet({ source: inventée })).qualified).toBe(false);
  });
});
