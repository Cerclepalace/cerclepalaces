/**
 * Filet de conservation — l'état du dossier PSP au 4 septembre 2026.
 *
 * **Ce fichier n'exprime aucune règle.** Il constate. Chaque valeur qu'il
 * contient a été relevée sur le code existant, jamais souhaitée ni déduite de
 * ce qui serait souhaitable.
 *
 * Il existe pour une seule raison : la restructuration à venir réécrit la façon
 * dont les neuf dossiers sont représentés. Une transcription qui altérerait un
 * statut au passage ne se verrait pas — un dossier reste non qualifié avant et
 * après, et c'est le *motif* qui aurait changé en silence. Ce test rend visible
 * exactement cela.
 *
 * **Les attendus sont littéraux, délibérément.** Une empreinte régénérable se
 * régénère au premier échec, et cesse alors de protéger quoi que ce soit. Ici,
 * modifier une attente est une ligne à écrire à la main, visible en revue, qui
 * demande de dire pourquoi.
 *
 * **Le mur de `NOT_ASKED` est l'information.** Cent cinquante des cent
 * cinquante-trois couples disent « personne n'a répondu ». C'est l'état exact
 * du dossier, et c'est la ligne qui tombera le jour où un point passera au vert
 * sans qu'une décision correspondante ait été prise.
 *
 * Ce test ne doit jamais être assoupli pour faire passer autre chose. S'il
 * tombe, la question n'est pas « comment le faire passer » mais « qu'est-ce qui
 * a changé, et qui l'a décidé ».
 */

import { describe, expect, it } from "vitest";

import { isActuallySent } from "./dossier.js";
import {
  ANSWER_SOURCES,
  BINDING_SOURCES,
  QUALIFICATION_POINTS,
  acquiringStillUnknown,
  assessQualification,
  cardNetworksStillUnknown,
  isBindingSource,
  type PointAssessment,
} from "./qualification.js";
import {
  BRIDGEPAY,
  EMERCHANTPAY,
  LEMONWAY,
  MANGOPAY,
  NUVEI,
  PAYKINGS,
  PROVIDER_DOSSIERS,
  ROXPAY,
  STANCER,
  STRIPE,
} from "./registre.js";

// ---------------------------------------------------------------------------
// 1 — Aucun des neuf dossiers n'est qualifié
// ---------------------------------------------------------------------------

describe("aucun dossier n'est qualifié", () => {
  it("les neuf rendent qualified: false", () => {
    // Le jour où l'un passe, ce test tombe et force à le constater
    // explicitement plutôt qu'à le découvrir en production.
    for (const dossier of PROVIDER_DOSSIERS) {
      expect(
        assessQualification(dossier.qualification).qualified,
        dossier.providerName,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 2 — Les cent cinquante-trois couples (point, verdict)
// ---------------------------------------------------------------------------

/**
 * Les dix-sept points d'un dossier auquel personne n'a répondu.
 *
 * Écrits en toutes lettres, dans l'ordre du modèle. Ce n'est pas une
 * commodité : c'est ce qui rend un changement d'ordre ou une disparition de
 * point visibles, ce qu'une boucle sur `QUALIFICATION_POINTS` masquerait en se
 * contentant de suivre le code qu'elle est censée surveiller.
 */
const AUCUNE_DEMANDE: readonly PointAssessment[] = [
  { point: "PROVIDER_IDENTIFIED", verdict: "NOT_ASKED" },
  { point: "ACQUIRING_ENTITY_IDENTIFIED", verdict: "NOT_ASKED" },
  { point: "ACQUIRING_COUNTRY_IDENTIFIED", verdict: "NOT_ASKED" },
  { point: "MERCHANT_CATEGORY_CODE_CONFIRMED", verdict: "NOT_ASKED" },
  { point: "ACTIVITY_ACCEPTED", verdict: "NOT_ASKED" },
  { point: "PRODUCT_CATEGORIES_ACCEPTED", verdict: "NOT_ASKED" },
  { point: "VISA_ACCEPTANCE_CONFIRMED", verdict: "NOT_ASKED" },
  { point: "MASTERCARD_ACCEPTANCE_CONFIRMED", verdict: "NOT_ASKED" },
  { point: "MODEL_A_ACCEPTED", verdict: "NOT_ASKED" },
  { point: "MODEL_B_ACCEPTED", verdict: "NOT_ASKED" },
  { point: "COMPLIANCE_CONDITIONS_STATED", verdict: "NOT_ASKED" },
  { point: "RESERVE_CONDITIONS_STATED", verdict: "NOT_ASKED" },
  { point: "CHARGEBACK_RULES_STATED", verdict: "NOT_ASKED" },
  { point: "REFUND_RULES_STATED", verdict: "NOT_ASKED" },
  { point: "SETTLEMENT_RULES_STATED", verdict: "NOT_ASKED" },
  { point: "PRODUCTION_CONDITIONS_STATED", verdict: "NOT_ASKED" },
  { point: "TERMINATION_CONDITIONS_STATED", verdict: "NOT_ASKED" },
];

/**
 * Les dix-sept points d'un dossier dont l'activité a été refusée par écrit.
 *
 * Un seul couple diffère du précédent, et c'est tout le dossier : le refus
 * porte sur l'activité présentée, et sur rien d'autre. Les seize `NOT_ASKED`
 * qui l'entourent sont la garantie qu'aucun refus d'acquéreur, de réseau, de
 * MCC ni de modèle n'a été déduit de celui-là.
 */
const REFUS_D_ACTIVITE: readonly PointAssessment[] = [
  { point: "PROVIDER_IDENTIFIED", verdict: "NOT_ASKED" },
  { point: "ACQUIRING_ENTITY_IDENTIFIED", verdict: "NOT_ASKED" },
  { point: "ACQUIRING_COUNTRY_IDENTIFIED", verdict: "NOT_ASKED" },
  { point: "MERCHANT_CATEGORY_CODE_CONFIRMED", verdict: "NOT_ASKED" },
  { point: "ACTIVITY_ACCEPTED", verdict: "REFUSED" },
  { point: "PRODUCT_CATEGORIES_ACCEPTED", verdict: "NOT_ASKED" },
  { point: "VISA_ACCEPTANCE_CONFIRMED", verdict: "NOT_ASKED" },
  { point: "MASTERCARD_ACCEPTANCE_CONFIRMED", verdict: "NOT_ASKED" },
  { point: "MODEL_A_ACCEPTED", verdict: "NOT_ASKED" },
  { point: "MODEL_B_ACCEPTED", verdict: "NOT_ASKED" },
  { point: "COMPLIANCE_CONDITIONS_STATED", verdict: "NOT_ASKED" },
  { point: "RESERVE_CONDITIONS_STATED", verdict: "NOT_ASKED" },
  { point: "CHARGEBACK_RULES_STATED", verdict: "NOT_ASKED" },
  { point: "REFUND_RULES_STATED", verdict: "NOT_ASKED" },
  { point: "SETTLEMENT_RULES_STATED", verdict: "NOT_ASKED" },
  { point: "PRODUCTION_CONDITIONS_STATED", verdict: "NOT_ASKED" },
  { point: "TERMINATION_CONDITIONS_STATED", verdict: "NOT_ASKED" },
];

function blocages(qualification: Parameters<typeof assessQualification>[0]) {
  const verdict = assessQualification(qualification);
  if (verdict.qualified) throw new Error("Dossier qualifié : voir la famille 1.");
  return verdict.blocking;
}

describe("les cent cinquante-trois couples (point, verdict)", () => {
  it("Nuvei — refus d'activité du 26/08/2026, et rien d'autre", () => {
    expect(blocages(NUVEI.qualification)).toEqual(REFUS_D_ACTIVITE);
  });

  it("RoxPay — refus d'activité du 21/08/2026, et rien d'autre", () => {
    expect(blocages(ROXPAY.qualification)).toEqual(REFUS_D_ACTIVITE);
  });

  it("Stancer — refus d'activité du 21/08/2026, et rien d'autre", () => {
    expect(blocages(STANCER.qualification)).toEqual(REFUS_D_ACTIVITE);
  });

  it("Stripe — aucune décision, dix-sept points sans demande", () => {
    // Une clôture administrative de ticket n'est pas un refus. La transcrire
    // en REFUSED inventerait une décision que Stripe n'a pas rendue.
    expect(blocages(STRIPE.qualification)).toEqual(AUCUNE_DEMANDE);
  });

  it("Lemonway — dix-sept points sans demande", () => {
    expect(blocages(LEMONWAY.qualification)).toEqual(AUCUNE_DEMANDE);
  });

  it("emerchantpay — dix-sept points sans demande", () => {
    expect(blocages(EMERCHANTPAY.qualification)).toEqual(AUCUNE_DEMANDE);
  });

  it("PayKings — dix-sept points sans demande", () => {
    expect(blocages(PAYKINGS.qualification)).toEqual(AUCUNE_DEMANDE);
  });

  it("BridgePay — dix-sept points sans demande", () => {
    expect(blocages(BRIDGEPAY.qualification)).toEqual(AUCUNE_DEMANDE);
  });

  it("MangoPay — dix-sept points sans demande, écart projet et non refus", () => {
    // Écarté par choix de projet. Le compter parmi les refus fausserait la
    // lecture du dossier, et son verdict ne doit donc pas ressembler à celui
    // de Nuvei, RoxPay ou Stancer.
    expect(blocages(MANGOPAY.qualification)).toEqual(AUCUNE_DEMANDE);
  });

  it("cent cinquante-trois couples, dont trois seulement portent un refus", () => {
    const tous = PROVIDER_DOSSIERS.flatMap((d) => blocages(d.qualification));
    expect(tous).toHaveLength(153);
    expect(tous.filter((c) => c.verdict === "REFUSED")).toHaveLength(3);
    expect(tous.filter((c) => c.verdict === "NOT_ASKED")).toHaveLength(150);
  });
});

// ---------------------------------------------------------------------------
// 3 — Les faits protégés
// ---------------------------------------------------------------------------

describe("les faits protégés", () => {
  it("les quatre dates historiques", () => {
    const date = (dossier: typeof NUVEI): string | null => {
      const reponse = dossier.qualification.responses[0];
      return reponse?.answeredAt?.toISOString() ?? null;
    };
    expect(date(NUVEI)).toBe("2026-08-26T00:00:00.000Z");
    expect(date(ROXPAY)).toBe("2026-08-21T00:00:00.000Z");
    expect(date(STANCER)).toBe("2026-08-21T00:00:00.000Z");
    // Stripe n'a rendu aucune décision : il n'y a donc aucune date à porter.
    expect(STRIPE.qualification.responses).toEqual([]);
  });

  it("les neuf noms, dans l'ordre du document, sans doublon", () => {
    expect(PROVIDER_DOSSIERS.map((d) => d.providerName)).toEqual([
      "Nuvei",
      "RoxPay",
      "Stancer",
      "Stripe",
      "Lemonway",
      "emerchantpay",
      "PayKings",
      "BridgePay",
      "MangoPay",
    ]);
  });

  it("l'acquéreur reste inconnu sur les neuf dossiers", () => {
    // « Ils ont répondu, personne ne sait qui souscrit » : la phrase la plus
    // fréquente de ce dossier, et celle qu'un statut unique rendrait indicible.
    for (const dossier of PROVIDER_DOSSIERS) {
      expect(acquiringStillUnknown(dossier.qualification), dossier.providerName).toBe(true);
    }
  });

  it("les réseaux cartes restent inconnus sur les neuf dossiers", () => {
    // Un refus qui invoque Visa ou Mastercard ne les renseigne pas : citer un
    // tiers ne l'engage pas.
    for (const dossier of PROVIDER_DOSSIERS) {
      expect(cardNetworksStillUnknown(dossier.qualification), dossier.providerName).toBe(true);
    }
  });

  it("aucune démarche n'est enregistrée comme envoyée", () => {
    // Rien n'a été expédié depuis cet environnement. Une démarche rédigée
    // ressemble à un dossier en cours ; tant que la date d'envoi et sa preuve
    // manquent, personne n'attend de réponse.
    for (const dossier of PROVIDER_DOSSIERS) {
      for (const demarche of dossier.outreach) {
        expect(isActuallySent(demarche), `${dossier.providerName} — ${demarche.subject}`).toBe(
          false,
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4 — La forme du modèle
// ---------------------------------------------------------------------------

describe("la forme du modèle", () => {
  it("dix-sept points, sans doublon", () => {
    expect(QUALIFICATION_POINTS).toHaveLength(17);
    expect(new Set(QUALIFICATION_POINTS).size).toBe(17);
  });

  it("huit sources, dont quatre opposables", () => {
    expect(ANSWER_SOURCES).toHaveLength(8);
    expect(BINDING_SOURCES).toHaveLength(4);
    expect(ANSWER_SOURCES.filter(isBindingSource)).toHaveLength(4);
  });

  it("neuf dossiers au registre", () => {
    expect(PROVIDER_DOSSIERS).toHaveLength(9);
  });
});
