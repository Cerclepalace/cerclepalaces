/**
 * Les treize garanties du dossier PSP, vérifiées sur les dossiers réels.
 *
 * Ces tests ne mesurent pas la qualité d'un prestataire. Ils vérifient qu'aucun
 * chemin ne permet à une absence, une capacité ou une parole de devenir une
 * approbation — et que les dossiers enregistrés disent bien ce que les preuves
 * disent, ni plus, ni moins.
 */

import { describe, expect, it } from "vitest";

import {
  assessDossier,
  emptyDossier,
  isActuallySent,
  unarchivedResponses,
  type ProviderDossier,
} from "./dossier.js";
import {
  ACQUIRING_POINTS,
  QUALIFICATION_POINTS,
  acquiringStillUnknown,
  assessQualification,
} from "./qualification.js";
import {
  MANGOPAY,
  NUVEI,
  PROVIDER_DOSSIERS,
  ROXPAY,
  STANCER,
  STRIPE,
} from "./registre.js";

// ---------------------------------------------------------------------------
// 1 à 4 — rien ne transforme une absence en approbation
// ---------------------------------------------------------------------------

describe("aucun dossier réel n'est qualifié", () => {
  it("les neuf sont non qualifiés", () => {
    // Le jour où l'un d'eux passe, ce test tombe et force à le constater
    // explicitement plutôt qu'à le découvrir en production.
    for (const dossier of PROVIDER_DOSSIERS) {
      expect(assessDossier(dossier).qualified, dossier.providerName).toBe(false);
    }
  });

  it("aucun point n'est satisfait nulle part", () => {
    for (const dossier of PROVIDER_DOSSIERS) {
      const verdict = assessDossier(dossier);
      if (verdict.qualified) throw new Error(`${dossier.providerName} ne devrait pas qualifier`);
      expect(verdict.blocking.length, dossier.providerName).toBe(QUALIFICATION_POINTS.length);
    }
  });

  it("un dossier vide bloque sur les quatorze points", () => {
    const verdict = assessDossier(emptyDossier("Inconnu"));
    if (verdict.qualified) throw new Error("ne devrait pas qualifier");
    expect(verdict.blocking.every((b) => b.verdict === "NOT_ASKED")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5 à 7 — le prestataire n'est pas l'acquéreur, la capacité n'est pas l'accord
// ---------------------------------------------------------------------------

describe("prestataire, acquéreur et capacité restent séparés", () => {
  it("l'acquéreur reste inconnu partout", () => {
    for (const dossier of PROVIDER_DOSSIERS) {
      expect(acquiringStillUnknown(dossier.qualification), dossier.providerName).toBe(true);
    }
  });

  it("un prestataire abondamment capable n'est pas plus qualifié qu'un dossier vide", () => {
    // Nuvei documente marketplace, KYC, split, reversements, litiges,
    // réconciliation et Merchant of Record. Cela ne lui gagne aucun point.
    expect(NUVEI.capabilities.length).toBeGreaterThan(5);

    const nuvei = assessDossier(NUVEI);
    const vide = assessDossier(emptyDossier("Inconnu"));
    if (nuvei.qualified || vide.qualified) throw new Error("ne devraient pas qualifier");
    expect(nuvei.blocking.length).toBe(vide.blocking.length);
  });

  it("les capacités n'atteignent même pas la fonction de jugement", () => {
    // Garantie structurelle : retirer toutes les capacités ne change rien.
    const sansCapacités: ProviderDossier = { ...NUVEI, capabilities: [] };
    expect(assessDossier(sansCapacités)).toEqual(assessDossier(NUVEI));
  });

  it("les points acquéreur sont distincts des points prestataire", () => {
    expect(ACQUIRING_POINTS).not.toContain("PROVIDER_IDENTIFIED" as never);
    expect(ACQUIRING_POINTS).not.toContain("ACTIVITY_ACCEPTED" as never);
  });
});

// ---------------------------------------------------------------------------
// 8 et 9 — un refus reste un refus, une condition reste une condition
// ---------------------------------------------------------------------------

describe("Nuvei — refus du dossier soumis, et rien de plus", () => {
  it("porte un refus d'activité écrit", () => {
    const activité = NUVEI.qualification.responses.find((r) => r.point === "ACTIVITY_ACCEPTED");
    expect(activité).toMatchObject({ answer: "NO", source: "WRITTEN_EMAIL" });
    expect(activité?.answeredAt?.toISOString().slice(0, 10)).toBe("2026-08-26");
  });

  it("ne dit rien de l'acquéreur, du code d'activité ni des modèles", () => {
    // Renseigner ces points par déduction — « s'ils refusent l'activité, tout
    // le reste est refusé » — est exactement l'erreur que ce registre empêche.
    const renseignés = NUVEI.qualification.responses.map((r) => r.point);
    expect(renseignés).toEqual(["ACTIVITY_ACCEPTED"]);
    for (const point of ACQUIRING_POINTS) {
      expect(renseignés, point).not.toContain(point);
    }
  });

  it("son refus reste un refus dans le verdict", () => {
    const verdict = assessDossier(NUVEI);
    if (verdict.qualified) throw new Error("ne devrait pas qualifier");
    expect(
      verdict.blocking.find((b) => b.point === "ACTIVITY_ACCEPTED")?.verdict,
    ).toBe("REFUSED");
  });
});

// ---------------------------------------------------------------------------
// 10 et 11 — une preuve doit être retrouvable
// ---------------------------------------------------------------------------

describe("traçabilité des preuves", () => {
  it("ne signale aucune acceptation non archivée, puisqu'il n'y a aucune acceptation", () => {
    for (const dossier of PROVIDER_DOSSIERS) {
      expect(unarchivedResponses(dossier), dossier.providerName).toEqual([]);
    }
  });

  it("signalerait une acceptation dont la référence manque", () => {
    // La fonction doit savoir détecter, sinon son silence ne prouve rien.
    const fictif: ProviderDossier = {
      ...emptyDossier("Fictif"),
      qualification: {
        providerName: "Fictif",
        responses: [
          {
            point: "ACTIVITY_ACCEPTED",
            answer: "YES",
            source: "WRITTEN_EMAIL",
            answeredAt: new Date("2026-09-01T00:00:00Z"),
            reference: null,
            conditions: null,
          },
        ],
      },
    };
    expect(unarchivedResponses(fictif)).toHaveLength(1);
    expect(assessQualification(fictif.qualification).qualified).toBe(false);
  });

  it("RoxPay et Stancer portent un refus dont l'archive reste à consigner", () => {
    for (const dossier of [ROXPAY, STANCER]) {
      const refus = dossier.qualification.responses[0];
      expect(refus?.answer, dossier.providerName).toBe("NO");
      // Un refus bloque qu'il soit archivé ou non ; la référence manquante est
      // un problème de preuve opposable, pas de verdict.
      expect(refus?.reference, dossier.providerName).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Stripe — non qualifié, jamais refusé
// ---------------------------------------------------------------------------

describe("Stripe", () => {
  it("n'enregistre aucune réponse, donc aucun refus", () => {
    // Transcrire une clôture de ticket en NO inventerait un refus qui n'existe
    // pas ; en YES, une acceptation qui n'existe pas davantage.
    expect(STRIPE.qualification.responses).toEqual([]);
  });

  it("classe la clôture du fil comme une absence de décision", () => {
    const premier = STRIPE.outreach.find((o) => o.state === "CLOSED_WITHOUT_DECISION");
    expect(premier).toBeDefined();
    expect(premier?.answeredAt).toBeNull();
  });

  it("garde la relance à l'état préparé, pas envoyé", () => {
    // Un message rédigé ressemble à un dossier en cours. Tant que l'envoi n'est
    // pas prouvé, personne n'attend de réponse.
    const relance = STRIPE.outreach.find((o) => o.state === "PREPARED");
    expect(relance).toBeDefined();
    expect(relance?.sentAt).toBeNull();
    expect(relance?.proofOfSending).toBeNull();
    expect(isActuallySent(relance!)).toBe(false);
  });

  it("ne considérerait l'envoi fait qu'avec une date et une preuve", () => {
    const relance = STRIPE.outreach.find((o) => o.state === "PREPARED")!;
    expect(isActuallySent({ ...relance, sentAt: new Date("2026-09-03T00:00:00Z") })).toBe(false);
    expect(isActuallySent({ ...relance, proofOfSending: "msg-id-1" })).toBe(false);
    expect(
      isActuallySent({
        ...relance,
        sentAt: new Date("2026-09-03T00:00:00Z"),
        proofOfSending: "msg-id-1",
      }),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Intégrité du registre
// ---------------------------------------------------------------------------

describe("intégrité du registre", () => {
  it("contient les neuf prestataires du document, sans doublon", () => {
    const noms = PROVIDER_DOSSIERS.map((d) => d.providerName);
    expect(noms).toHaveLength(9);
    expect(new Set(noms).size).toBe(9);
    for (const attendu of ["Nuvei", "RoxPay", "Stancer", "Stripe", "Lemonway", "emerchantpay", "PayKings", "BridgePay", "MangoPay"]) {
      expect(noms, attendu).toContain(attendu);
    }
  });

  it("garde le nom du dossier et celui de sa qualification alignés", () => {
    for (const dossier of PROVIDER_DOSSIERS) {
      expect(dossier.qualification.providerName, dossier.providerName).toBe(dossier.providerName);
    }
  });

  it("ne compte pas un écart stratégique parmi les refus", () => {
    // MangoPay est écarté par choix de projet. Un écart n'est pas un refus, et
    // le compter comme tel fausserait la lecture du dossier.
    expect(MANGOPAY.qualification.responses).toEqual([]);
    const refus = PROVIDER_DOSSIERS.filter((d) =>
      d.qualification.responses.some((r) => r.answer === "NO"),
    ).map((d) => d.providerName);
    expect(refus.sort()).toEqual(["Nuvei", "RoxPay", "Stancer"]);
  });

  it("n'enregistre aucune démarche réellement envoyée", () => {
    // Constat, pas objectif : rien n'a été envoyé depuis cet environnement.
    for (const dossier of PROVIDER_DOSSIERS) {
      for (const démarche of dossier.outreach) {
        expect(isActuallySent(démarche), `${dossier.providerName} — ${démarche.subject}`).toBe(
          false,
        );
      }
    }
  });

  it("n'utilise que des sources opposables pour les réponses enregistrées", () => {
    for (const dossier of PROVIDER_DOSSIERS) {
      for (const réponse of dossier.qualification.responses) {
        expect(réponse.source, dossier.providerName).toBe("WRITTEN_EMAIL");
      }
    }
  });
});
