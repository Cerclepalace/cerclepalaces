/**
 * Les demandes écrites couvrent-elles réellement ce qu'elles prétendent couvrir ?
 *
 * Un questionnaire dérive plus vite qu'un modèle : on ajoute un point de
 * qualification dans le code, et le message parti la semaine suivante ne le
 * demande pas. Le trou ne se voit alors qu'à la réception d'une réponse
 * incomplète, des semaines plus tard.
 *
 * Ces tests lisent les documents réels et vérifient qu'aucun point n'y manque.
 * Ils ne jugent pas la qualité de la rédaction — ils vérifient la couverture,
 * qui est la seule propriété qu'un test peut honnêtement établir ici.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PRODUCT_CATEGORIES } from "../catalog/policy.js";
import { QUALIFICATION_POINTS } from "./qualification.js";

const lire = (nom: string): string =>
  readFileSync(new URL(`../../../../docs/${nom}`, import.meta.url), "utf8");

const DEMANDE_TYPE = lire("PSP-DEMANDE-TYPE.md");
const STRIPE_DOSSIER = lire("PSP-STRIPE-DOSSIER.md");
const STRIPE_RELANCE = lire("PSP-STRIPE-RELANCE.md");

/**
 * Aplatit les retours à la ligne pour chercher une phrase.
 *
 * Un Markdown replié à 80 colonnes coupe les phrases n'importe où. Chercher
 * une formulation exacte sans aplatir reviendrait à tester la largeur de la
 * colonne plutôt que le contenu — et le test tomberait au premier reflow.
 */
const aplati = (document: string): string => document.replace(/\s+/g, " ");

describe("les demandes couvrent les dix-sept points", () => {
  it("la demande type nomme chaque point dans sa table de correspondance", () => {
    for (const point of QUALIFICATION_POINTS) {
      expect(DEMANDE_TYPE, point).toContain(point);
    }
  });

  it("le dossier Stripe nomme chaque point dans sa table de correspondance", () => {
    for (const point of QUALIFICATION_POINTS) {
      expect(STRIPE_DOSSIER, point).toContain(point);
    }
  });
});

describe("le dossier Stripe présente la taxonomie entière", () => {
  it("nomme les dix catégories, y compris celles qui peuvent être refusées", () => {
    // Restreindre le périmètre soi-même, c'est décider à la place du
    // prestataire ce qu'il refuserait. Un refus catégorie par catégorie est une
    // information ; un périmètre auto-restreint n'en est pas une.
    for (const categorie of PRODUCT_CATEGORIES) {
      expect(STRIPE_DOSSIER, categorie).toContain(categorie);
      expect(STRIPE_RELANCE, categorie).toContain(categorie);
    }
  });

  it("présente la catégorie fermée comme exclue, pas comme à qualifier", () => {
    expect(STRIPE_DOSSIER).toContain("excluded, no answer required");
  });
});

describe("aucune demande ne présuppose une réponse", () => {
  it("ne choisit pas entre le modèle A et le modèle B", () => {
    expect(STRIPE_DOSSIER).toContain("deliberately **not** chosen");
    expect(STRIPE_RELANCE).toContain("deliberately not chosen");
  });

  it("ne présente aucun seuil THC comme une preuve juridique", () => {
    // La valeur 0,3 n'existe que dans des fixtures de test. L'écrire dans un
    // document adressé à un tiers la transformerait en affirmation juridique.
    const phrase =
      "The technical test threshold currently used by the project is not " +
      "presented as final legal evidence.";
    expect(aplati(STRIPE_DOSSIER)).toContain(phrase);
    expect(aplati(STRIPE_RELANCE)).toContain(
      phrase.replace("The technical", "the technical"),
    );
    for (const document of [STRIPE_DOSSIER, STRIPE_RELANCE]) {
      expect(document).not.toMatch(/French law (allows|authorises|permits)/i);
      expect(document).not.toMatch(/0[.,]3\s*%/);
    }
  });

  it("n'annonce nulle part que la demande a été envoyée", () => {
    // Tant qu'aucune date ni preuve d'envoi n'existe, l'écrire serait faux — et
    // ferait attendre une réponse que personne n'a demandée.
    for (const document of [STRIPE_DOSSIER, STRIPE_RELANCE]) {
      // « Sent on » n'est admis que suivi du placeholder : toute autre suite
      // serait une date, donc une affirmation d'envoi.
      // Les `*` sautés sont ceux de la mise en gras Markdown.
      for (const occurrence of aplati(document).matchAll(/sent on:?[\s*]*(\S+)/gi)) {
        expect(occurrence[1], occurrence[0]).toBe("`[DATE");
      }
    }
    expect(STRIPE_RELANCE).toContain("L'envoi est une **action humaine**");
  });

  it("demande les restrictions géographiques au lieu de les supposer", () => {
    // « Un compte marchand français, donc France seulement » et « donc aucune
    // restriction » sont deux suppositions opposées, aussi peu fondées l'une
    // que l'autre. La question est posée.
    for (const document of [STRIPE_DOSSIER, STRIPE_RELANCE]) {
      expect(document).toMatch(/countries are included, and which excluded/);
      expect(document).toMatch(/cardholder location as distinct from merchant location/);
    }
    expect(DEMANDE_TYPE).toMatch(/countries are included and which excluded/);
  });

  it("laisse les trois traces d'envoi en placeholders explicites", () => {
    // Une date plausible ferait attendre une réponse que personne n'a demandée.
    for (const marqueur of [
      "[STRIPE THREAD REFERENCE]",
      "[DATE OF ACTUAL SENDING]",
      "[PROOF OF SENDING]",
    ]) {
      const present =
        STRIPE_DOSSIER.includes(marqueur) || STRIPE_RELANCE.includes(marqueur);
      expect(present, marqueur).toBe(true);
    }
  });

  it("ne fabrique aucune coordonnée", () => {
    // Un document destiné à sortir n'est pas l'endroit où inventer, ni où
    // recopier, une adresse ou un numéro.
    for (const document of [STRIPE_DOSSIER, STRIPE_RELANCE]) {
      expect(document).toContain("[Email]");
      expect(document).toContain("[Telephone]");
      expect(document).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
      expect(document).not.toMatch(/\+\d[\d ().-]{7,}/);
    }
  });

  it("rappelle les trois inférences interdites plutôt que de les commettre", () => {
    expect(STRIPE_RELANCE).toContain("« Stripe accepte, donc Visa accepte. »");
    expect(STRIPE_RELANCE).toContain("« Stripe accepte, donc Mastercard accepte. »");
  });
});
