/**
 * Une seule porte de preuve dans tout le dépôt.
 *
 * Le catalogue possède un mécanisme complet — `LegalEvidence`, ses trois
 * statuts, et `supportsAuthorisation` qui décide si une preuve soutient une
 * autorisation. Ce mécanisme est **fail-closed par construction** : le statut
 * est lu à un seul endroit, contre une liste d'autorisation, si bien qu'une
 * valeur nouvelle bloque sans qu'aucune ligne ne change.
 *
 * Le risque n'est donc pas qu'il soit mal écrit. Le risque est qu'un second
 * mécanisme apparaisse à côté — un `isVerified` ailleurs, une deuxième liste de
 * statuts, une porte qui accepterait ce que celle-ci refuse. Deux définitions
 * d'une même notion divergent toujours, et la plus permissive gagne, parce que
 * c'est elle qu'on appelle quand la stricte refuse.
 *
 * ---
 *
 * **CE QUE CETTE GARDE NE FAIT PAS, ET IL FAUT LE LIRE AVANT DE S'Y FIER.**
 *
 * Elle détecte une **copie** des symboles surveillés : une seconde liste de
 * statuts, un second `supportsAuthorisation`, un export au nom évocateur. Elle
 * ne prétend **pas** détecter une **réinvention** sous un nom inattendu.
 * Quelqu'un qui écrirait, dans un autre module, une fonction nommée
 * `peutOuvrir()` reproduisant la même logique passerait sans bruit.
 *
 * Aucun test ne détecte une équivalence sémantique. Cette garde réduit la
 * surface d'erreur ; elle ne la ferme pas. La fermer reste un travail de revue
 * humaine.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ici = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ici, "..", "..", "..");

/** Le seul fichier qui a le droit de définir la porte de preuve. */
const PORTE_LEGITIME = "packages/domain/src/catalog/policy.ts";

interface Source {
  readonly chemin: string;
  readonly texte: string;
  readonly estTest: boolean;
}

function sources(): readonly Source[] {
  const racines = ["packages/domain/src", "packages/config/src", "packages/db/src", "apps/api/src"];
  const trouves: Source[] = [];

  const parcourir = (dossier: string, prefixe: string): void => {
    for (const entree of readdirSync(dossier)) {
      if (entree === "node_modules") continue;
      const complet = join(dossier, entree);
      if (statSync(complet).isDirectory()) {
        parcourir(complet, prefixe);
        continue;
      }
      if (!entree.endsWith(".ts")) continue;
      trouves.push({
        chemin: `${prefixe}/${relative(join(RACINE, prefixe), complet).split(/[\\/]/).join("/")}`,
        texte: readFileSync(complet, "utf8"),
        estTest: entree.endsWith(".test.ts"),
      });
    }
  };

  for (const r of racines) parcourir(join(RACINE, r), r);
  return trouves.sort((a, b) => a.chemin.localeCompare(b.chemin));
}

const SOURCES = sources();
const CODE = SOURCES.filter((s) => !s.estTest);

/**
 * Retire les commentaires avant analyse.
 *
 * Sans cela, expliquer *pourquoi* une seconde porte est interdite deviendrait
 * impossible : le commentaire qui l'explique déclencherait la garde. Même
 * raisonnement que la garde anti-monétaire.
 */
function sansCommentaires(texte: string): string {
  return texte.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/**
 * Axes consultatifs autorisés à employer le vocabulaire des niveaux de preuve.
 *
 * **Une exception nommée, pas un assouplissement.** L'interdiction existe pour
 * empêcher un second mécanisme de décider ce que le premier décide. Un axe
 * consultatif ne décide rien : il décrit. La différence n'est pas une nuance de
 * vocabulaire, elle est vérifiée plus bas — un tel axe ne doit être atteignable
 * par aucun chemin de décision.
 *
 * Élargir cette liste demande donc deux choses : une justification écrite ici,
 * et la démonstration que le nouvel axe reste hors de tout chemin de décision.
 */
const AXES_CONSULTATIFS: Readonly<Record<string, { readonly raison: string }>> = {
  "packages/domain/src/psp/evidence-level.ts": {
    raison:
      "Axe consultatif du dossier PSP : dit avec quelle force une réponse est établie, jamais si elle " +
      "qualifie. Emploie VERIFIED, CONVERGENT et UNVERIFIED tels que docs/PSP-REGISTRE.md les définit " +
      "depuis l'origine, plutôt que d'inventer un quatrième vocabulaire à tenir accordé. Ne décide rien, " +
      "et le graphe du domaine interdit qu'une décision l'atteigne.",
  },
};

/** Modules dont le rôle est de décider. Aucun ne doit connaître un axe consultatif. */
const MODULES_DE_DECISION = [
  "packages/domain/src/psp/qualification.ts",
  "packages/domain/src/psp/dossier.ts",
  "packages/domain/src/catalog/policy.ts",
  "packages/domain/src/catalog/listing-gate.ts",
] as const;

// ---------------------------------------------------------------------------
// 1 — Une seule liste de statuts de preuve
// ---------------------------------------------------------------------------

describe("une seule liste de statuts de preuve", () => {
  it("LEGAL_EVIDENCE_STATUSES n'est déclarée qu'une fois, dans le catalogue", () => {
    const declarations = CODE.filter((s) =>
      /(?:const|type|enum)\s+LEGAL_EVIDENCE_STATUSES\b/.test(sansCommentaires(s.texte)),
    ).map((s) => s.chemin);
    expect(declarations).toEqual([PORTE_LEGITIME]);
  });

  it("les trois littéraux de statut ne vivent que dans le catalogue, à une exception nommée près", () => {
    // UNVERIFIED, VERIFIED, SUPERSEDED écrits ailleurs signaleraient un second
    // vocabulaire de preuve — celui-là même que l'arbitrage sur CONVERGENT a
    // refusé de créer côté juridique.
    const ailleurs = CODE.filter(
      (s) =>
        s.chemin !== PORTE_LEGITIME &&
        !(s.chemin in AXES_CONSULTATIFS) &&
        /"(?:UNVERIFIED|VERIFIED|SUPERSEDED)"/.test(sansCommentaires(s.texte)),
    ).map((s) => s.chemin);
    expect(ailleurs).toEqual([]);
  });

  it("aucun axe consultatif n'emploie SUPERSEDED", () => {
    // SUPERSEDED décrit le cycle de vie d'une source juridique remplacée. Il
    // n'a aucun sens hors du catalogue, et son apparition ailleurs signalerait
    // une copie du modèle plutôt qu'un axe distinct.
    for (const chemin of Object.keys(AXES_CONSULTATIFS)) {
      const fichier = CODE.find((s) => s.chemin === chemin);
      expect(sansCommentaires(fichier?.texte ?? ""), chemin).not.toContain('"SUPERSEDED"');
    }
  });

  it("chaque axe consultatif porte une justification écrite", () => {
    for (const [chemin, { raison }] of Object.entries(AXES_CONSULTATIFS)) {
      expect(raison.length, chemin).toBeGreaterThan(80);
    }
  });

  it("le catalogue en compte exactement trois, dans cet ordre", () => {
    // Le pointage est littéral : ajouter un statut devient une ligne à écrire
    // ici, visible en revue, qui demande de dire pourquoi.
    const porte = CODE.find((s) => s.chemin === PORTE_LEGITIME);
    expect(porte).toBeDefined();
    const ligne = /LEGAL_EVIDENCE_STATUSES\s*=\s*\[([^\]]+)\]/.exec(porte?.texte ?? "");
    const valeurs = (ligne?.[1] ?? "").match(/"[A-Z_]+"/g) ?? [];
    expect(valeurs).toEqual(['"UNVERIFIED"', '"VERIFIED"', '"SUPERSEDED"']);
  });
});

// ---------------------------------------------------------------------------
// 2 — Une seule porte
// ---------------------------------------------------------------------------

describe("une seule porte de preuve", () => {
  it("supportsAuthorisation n'est défini qu'une fois", () => {
    const definitions = CODE.filter((s) =>
      /function\s+supportsAuthorisation\b|const\s+supportsAuthorisation\s*[:=]/.test(
        sansCommentaires(s.texte),
      ),
    ).map((s) => s.chemin);
    expect(definitions).toEqual([PORTE_LEGITIME]);
  });

  it("le statut d'une preuve n'est comparé qu'à un seul endroit", () => {
    // `.status` sert à bien d'autres machines — livraisons, commandes,
    // affectations. Seule sa comparaison à un littéral de statut de preuve est
    // surveillée ici.
    const lecteurs = CODE.filter((s) =>
      /\.status\s*[!=]==\s*"(?:UNVERIFIED|VERIFIED|SUPERSEDED)"/.test(sansCommentaires(s.texte)),
    ).map((s) => s.chemin);
    expect(lecteurs).toEqual([PORTE_LEGITIME]);
  });
});

// ---------------------------------------------------------------------------
// 3 — Aucun export au nom équivalent
// ---------------------------------------------------------------------------

/**
 * Noms qui désigneraient une seconde porte.
 *
 * Liste fermée et volontairement courte : elle attrape les noms qu'un
 * développeur pressé choisirait naturellement. Elle n'attrape pas ceux qu'il
 * n'aurait pas choisis — voir la limite déclarée en tête de fichier.
 */
const NOMS_CONCURRENTS = [
  "isVerified",
  "isVerifiedEvidence",
  "assertVerified",
  "assertEvidenceVerified",
  "checkEvidence",
  "evidenceSupports",
  "supportsAuthorization",
  "hasVerifiedEvidence",
  "isEvidenceValid",
] as const;

describe("aucun export ne double la porte", () => {
  for (const nom of NOMS_CONCURRENTS) {
    it(`aucun export nommé ${nom}`, () => {
      const fautifs = CODE.filter((s) =>
        new RegExp(`export\\s+(?:async\\s+)?(?:function|const|class)\\s+${nom}\\b`).test(
          sansCommentaires(s.texte),
        ),
      ).map((s) => s.chemin);
      expect(fautifs).toEqual([]);
    });
  }

  it("verifiedEvidence reste privé au catalogue", () => {
    // Il n'est pas exporté aujourd'hui, et c'est délibéré : l'exposer
    // permettrait d'écrire ailleurs une décision d'ouverture qui n'aurait
    // traversé aucun des trois sites de décision du catalogue.
    const exports = CODE.filter((s) =>
      /export\s+(?:function|const)\s+verifiedEvidence\b/.test(sansCommentaires(s.texte)),
    ).map((s) => s.chemin);
    expect(exports).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4 — Un axe consultatif n'entre dans aucune décision
// ---------------------------------------------------------------------------

/**
 * La distinction que ces tests défendent, en une phrase.
 *
 * **Donnée consultative** : elle décrit un état — avec quelle force un fait est
 * établi. La lire ne change aucune sortie ; l'ignorer non plus.
 *
 * **Décision métier** : elle produit un verdict, une qualification ou un
 * blocage. Ce qu'elle rend gouverne ce que le reste du système fait.
 *
 * Un axe consultatif qui deviendrait une entrée de décision cesserait d'être
 * consultatif — sans qu'aucune ligne ne le dise, et sans que personne ne l'ait
 * décidé. C'est le mode de dérive que cette section rend impossible.
 */
describe("un axe consultatif n'entre dans aucune décision", () => {
  for (const axe of Object.keys(AXES_CONSULTATIFS)) {
    const nom = axe.split("/").pop() ?? axe;

    it(`aucun module de décision n'importe ${nom}`, () => {
      const base = nom.replace(/\.ts$/, "");
      const fautifs = MODULES_DE_DECISION.filter((chemin) => {
        const fichier = CODE.find((s) => s.chemin === chemin);
        return new RegExp(`from\\s+"[^"]*${base}\\.js"`).test(sansCommentaires(fichier?.texte ?? ""));
      });
      expect(fautifs).toEqual([]);
    });

    it(`aucun module de décision ne nomme les symboles de ${nom}`, () => {
      // Un import est le chemin le plus court, pas le seul : une réexportation
      // ou une copie de la liste porterait les mêmes noms.
      const symboles = ["PROVIDER_EVIDENCE_LEVELS", "responseEvidenceLevel", "qualificationEvidenceLevel"];
      const fautifs = MODULES_DE_DECISION.flatMap((chemin) => {
        const fichier = CODE.find((s) => s.chemin === chemin);
        const texte = sansCommentaires(fichier?.texte ?? "");
        return symboles.filter((sym) => texte.includes(sym)).map((sym) => `${chemin} → ${sym}`);
      });
      expect(fautifs).toEqual([]);
    });

    it(`${nom} ne dépend d'aucun module hors psp/`, () => {
      // Il lit les types de la qualification, et rien d'autre. Cette direction
      // d'import est ce qui rend le retour impossible : le graphe du domaine
      // interdit les cycles, et cette règle est vérifiée à chaque exécution.
      const fichier = CODE.find((s) => s.chemin === axe);
      const externes = [...(fichier?.texte ?? "").matchAll(/from\s+"([^"]+)"/g)]
        .map((m) => m[1] ?? "")
        .filter((i) => !i.startsWith("./"));
      expect(externes).toEqual([]);
    });
  }

  it("aucun axe consultatif ne rend un verdict de qualification", () => {
    // POINT_VERDICTS appartient à la décision. Qu'un axe consultatif en
    // produise une valeur signifierait qu'il a cessé de décrire pour trancher.
    const verdicts = ["SATISFIED", "REFUSED", "NOT_BINDING", "CONDITIONS_MISSING", "AWAITING_ANSWER", "NOT_ASKED"];
    for (const axe of Object.keys(AXES_CONSULTATIFS)) {
      const texte = sansCommentaires(CODE.find((s) => s.chemin === axe)?.texte ?? "");
      const trouves = verdicts.filter((v) => texte.includes(`"${v}"`));
      expect(trouves, axe).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 5 — La limite est écrite
// ---------------------------------------------------------------------------

describe("la garde déclare sa propre limite", () => {
  it("dit qu'elle détecte une copie et non une réinvention", () => {
    // Une garde dont on ignore la portée inspire une confiance qu'elle ne
    // mérite pas. Ce test échoue si l'avertissement disparaît du fichier.
    const moi = readFileSync(join(RACINE, "apps/api/src/evidence-uniqueness.guard.test.ts"), "utf8");
    expect(moi).toContain("copie");
    expect(moi).toContain("réinvention");
    expect(moi).toContain("Elle réduit la");
  });
});
