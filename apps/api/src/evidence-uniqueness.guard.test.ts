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

  it("les trois littéraux de statut ne vivent que dans le catalogue", () => {
    // UNVERIFIED, VERIFIED, SUPERSEDED écrits ailleurs signaleraient un second
    // vocabulaire de preuve — celui-là même que l'arbitrage sur CONVERGENT a
    // refusé de créer.
    const ailleurs = CODE.filter(
      (s) =>
        s.chemin !== PORTE_LEGITIME &&
        /"(?:UNVERIFIED|VERIFIED|SUPERSEDED)"/.test(sansCommentaires(s.texte)),
    ).map((s) => s.chemin);
    expect(ailleurs).toEqual([]);
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
// 4 — La limite est écrite
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
