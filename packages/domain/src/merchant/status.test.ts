import { describe, expect, it } from "vitest";

import {
  KYB_GAPS,
  MERCHANT_STATUSES,
  MERCHANT_TRANSITIONS,
  MerchantTransitionError,
  allowedNextMerchantStatuses,
  assertMerchantTransition,
  canActivate,
  canSell,
  checkKybDossier,
  findMerchantTransition,
  isTerminalMerchantStatus,
  type KybDossier,
} from "./status.js";

const dossierComplet = (overrides: Partial<KybDossier> = {}): KybDossier => ({
  legalName: "Cercle Palace SAS",
  tradeName: "Cercle Palace",
  registrationNumber: "912 345 678 00019",
  locations: [
    { line1: "1 place de la République", postalCode: "75011", city: "Paris", country: "FR" },
  ],
  ownerCount: 1,
  ...overrides,
});

describe("machine d'état du shop", () => {
  it("ne référence que des états déclarés", () => {
    for (const transition of MERCHANT_TRANSITIONS) {
      expect(MERCHANT_STATUSES).toContain(transition.from);
      expect(MERCHANT_STATUSES).toContain(transition.to);
    }
  });

  it("n'a aucune transition en double", () => {
    const clés = MERCHANT_TRANSITIONS.map((t) => `${t.from}->${t.to}`);
    expect(new Set(clés).size).toBe(clés.length);
  });

  it("donne un motif lisible à chaque transition", () => {
    for (const transition of MERCHANT_TRANSITIONS) {
      expect(transition.reason.length, `${transition.from}->${transition.to}`).toBeGreaterThan(20);
    }
  });

  it("ne laisse jamais un shop se valider lui-même", () => {
    // La validation est une décision de la plateforme. Si un commerçant pouvait
    // la déclencher, le KYB ne servirait à rien. Il peut déposer son dossier et
    // renoncer — rien d'autre.
    expect(findMerchantTransition("KYB_REVIEW", "APPROVED")?.actors).toEqual(["admin"]);
    expect(findMerchantTransition("APPROVED", "ACTIVE")?.actors).toEqual(["admin"]);
    expect([...allowedNextMerchantStatuses("PENDING_VALIDATION", "merchant_owner")].sort()).toEqual([
      "CLOSED",
      "KYB_REVIEW",
    ]);
    expect(allowedNextMerchantStatuses("SUSPENDED", "merchant_owner")).toEqual([]);
  });

  it("n'ouvre à aucun rôle non-admin un chemin vers ACTIVE", () => {
    for (const statut of MERCHANT_STATUSES) {
      for (const acteur of ["merchant_owner", "merchant_staff", "customer", "driver", "support_agent", "system"] as const) {
        expect(
          allowedNextMerchantStatuses(statut, acteur),
          `${statut} / ${acteur}`,
        ).not.toContain("ACTIVE");
      }
    }
  });

  it("sépare la validation du dossier de l'ouverture commerciale", () => {
    // APPROVED ne vend pas. C'est la propriété qui justifie l'existence de
    // l'état : approuver un KYB ne doit pas mettre un shop en ligne.
    expect(canSell("APPROVED")).toBe(false);
    expect(allowedNextMerchantStatuses("KYB_REVIEW", "admin")).not.toContain("ACTIVE");
  });

  it("laisse une suspension se lever", () => {
    // Une suspension sans retour possible serait une fermeture déguisée, donc
    // une mesure qu'on n'oserait jamais prendre.
    expect(isTerminalMerchantStatus("SUSPENDED")).toBe(false);
    expect(allowedNextMerchantStatuses("SUSPENDED", "admin")).toContain("ACTIVE");
  });

  it("ne laisse sortir de CLOSED que vers une nouvelle constitution", () => {
    expect(allowedNextMerchantStatuses("CLOSED", "admin")).toEqual(["PENDING_VALIDATION"]);
    expect(allowedNextMerchantStatuses("CLOSED", "merchant_owner")).toEqual([]);
  });

  it("refuse une transition inexistante", () => {
    expect(() => assertMerchantTransition("PENDING_VALIDATION", "SUSPENDED", "admin", dossierComplet())).toThrow(
      MerchantTransitionError,
    );
    // Le saut par-dessus l'examen n'existe pas non plus.
    expect(() => assertMerchantTransition("PENDING_VALIDATION", "ACTIVE", "admin", dossierComplet())).toThrow(
      MerchantTransitionError,
    );
  });

  it("refuse un acteur non habilité", () => {
    expect(() => assertMerchantTransition("APPROVED", "ACTIVE", "support_agent", dossierComplet())).toThrow(
      MerchantTransitionError,
    );
    expect(() => assertMerchantTransition("APPROVED", "ACTIVE", "merchant_owner", dossierComplet())).toThrow(
      MerchantTransitionError,
    );
  });

  it("accepte le chemin nominal", () => {
    const dossier = dossierComplet();
    expect(assertMerchantTransition("PENDING_VALIDATION", "KYB_REVIEW", "merchant_owner", dossier).to).toBe("KYB_REVIEW");
    expect(assertMerchantTransition("KYB_REVIEW", "APPROVED", "admin", dossier).to).toBe("APPROVED");
    expect(assertMerchantTransition("APPROVED", "ACTIVE", "admin", dossier).to).toBe("ACTIVE");
  });
});

describe("droit de vendre", () => {
  it("n'est ouvert qu'à un shop actif", () => {
    expect(canSell("ACTIVE")).toBe(true);
    for (const statut of ["PENDING_VALIDATION", "KYB_REVIEW", "APPROVED", "SUSPENDED", "CLOSED"] as const) {
      expect(canSell(statut), statut).toBe(false);
    }
  });
});

describe("complétude du dossier KYB", () => {
  it("accepte un dossier complet", () => {
    expect(checkKybDossier(dossierComplet())).toEqual({ complete: true, gaps: [] });
  });

  it("signale tous les manques d'un coup, pas le premier", () => {
    // Un commerçant qui corrige pièce par pièce, avec un aller-retour à chaque
    // fois, abandonne.
    const résultat = checkKybDossier({
      legalName: null,
      tradeName: "  ",
      registrationNumber: null,
      locations: [],
      ownerCount: 0,
    });
    expect(résultat.complete).toBe(false);
    expect(résultat.gaps).toEqual([
      "MISSING_LEGAL_NAME",
      "MISSING_TRADE_NAME",
      "MISSING_REGISTRATION_NUMBER",
      "MISSING_LOCATION",
      "MISSING_OWNER",
    ]);
  });

  it("traite une chaîne d'espaces comme une absence", () => {
    expect(checkKybDossier(dossierComplet({ legalName: "   " })).gaps).toEqual([
      "MISSING_LEGAL_NAME",
    ]);
  });

  it("détecte une adresse de boutique incomplète", () => {
    const résultat = checkKybDossier(
      dossierComplet({
        locations: [{ line1: "1 place de la République", postalCode: null, city: "Paris", country: "FR" }],
      }),
    );
    expect(résultat.gaps).toEqual(["INCOMPLETE_LOCATION_ADDRESS"]);
  });

  it("suffit d'une seule boutique incomplète pour signaler", () => {
    const résultat = checkKybDossier(
      dossierComplet({
        locations: [
          { line1: "1 place de la République", postalCode: "75011", city: "Paris", country: "FR" },
          { line1: null, postalCode: "75012", city: "Paris", country: "FR" },
        ],
      }),
    );
    expect(résultat.gaps).toEqual(["INCOMPLETE_LOCATION_ADDRESS"]);
  });

  it("est déterministe", () => {
    const dossier = dossierComplet({ legalName: null, ownerCount: 0 });
    expect(checkKybDossier(dossier)).toEqual(checkKybDossier(dossier));
  });

  it("n'invente aucun manque hors de la liste déclarée", () => {
    const résultat = checkKybDossier({
      legalName: null,
      tradeName: null,
      registrationNumber: null,
      locations: [],
      ownerCount: 0,
    });
    for (const gap of résultat.gaps) expect(KYB_GAPS).toContain(gap);
  });
});

describe("garde d'activation", () => {
  it("laisse passer un dossier complet", () => {
    expect(canActivate(dossierComplet())).toEqual({ ok: true });
  });

  it("bloque un dossier incomplet et dit quoi", () => {
    const résultat = canActivate(dossierComplet({ registrationNumber: null }));
    expect(résultat).toEqual({ ok: false, gaps: ["MISSING_REGISTRATION_NUMBER"] });
  });
});
