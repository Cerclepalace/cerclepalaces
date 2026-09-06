/**
 * Les frontières entre domaines, vérifiées au lieu d'être documentées.
 *
 * `ARCHITECTURE.md` décrit depuis longtemps qui a le droit de dépendre de quoi.
 * Rien ne le vérifiait : la première dépendance interdite serait passée en revue
 * sans que personne ne la voie, et une frontière franchie une fois cesse d'être
 * une frontière.
 *
 * **Les règles ci-dessous sont toutes vraies au moment où ce fichier est
 * écrit.** Aucune n'exprime une intention ni une cible : chacune constate une
 * propriété que le code possède déjà, et la gèle. C'est la différence entre une
 * garde et un projet — une garde ne demande jamais de travail pour devenir
 * verte.
 *
 * Ce test complète les deux autres gardes statiques sans les recouper :
 * `no-money-guard` surveille le **vocabulaire** transactionnel, `tenancy-guard`
 * l'isolation des locataires, celui-ci le **graphe des dépendances**.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ici = dirname(fileURLToPath(import.meta.url));
const RACINE = join(ici, "..", "..", "..");

// ---------------------------------------------------------------------------
// Lecture du graphe
// ---------------------------------------------------------------------------

interface Fichier {
  /** Chemin depuis la racine du dépôt, séparateurs POSIX. */
  readonly chemin: string;
  /** Dossier du module, relatif à la racine du package. */
  readonly module: string;
  readonly estTest: boolean;
  /** Spécificateurs importés, tels qu'écrits. */
  readonly imports: readonly string[];
}

function fichiersTypeScript(racinePackage: string): readonly Fichier[] {
  const base = join(RACINE, racinePackage);
  const trouves: Fichier[] = [];

  const parcourir = (dossier: string): void => {
    for (const entree of readdirSync(dossier)) {
      if (entree === "node_modules") continue;
      const complet = join(dossier, entree);
      if (statSync(complet).isDirectory()) {
        parcourir(complet);
        continue;
      }
      if (!entree.endsWith(".ts")) continue;

      const source = readFileSync(complet, "utf8");
      const imports = [...source.matchAll(/(?:from|import)\s+"([^"]+)"/g)].map((m) => m[1] ?? "");
      const relatifAuPackage = relative(base, complet).split(/[\\/]/).join("/");
      const dossierModule = posix.dirname(relatifAuPackage);

      trouves.push({
        chemin: `${racinePackage}/${relatifAuPackage}`,
        module: dossierModule === "." ? "" : dossierModule,
        estTest: entree.endsWith(".test.ts"),
        imports,
      });
    }
  };

  parcourir(base);
  return trouves.sort((a, b) => a.chemin.localeCompare(b.chemin));
}

const DOMAINE = fichiersTypeScript("packages/domain/src");
const API = fichiersTypeScript("apps/api/src");

/** Un import est relatif s'il commence par un point. Tout le reste est externe. */
const estRelatif = (specificateur: string): boolean => specificateur.startsWith(".");

/**
 * Module visé par un import relatif, exprimé comme dossier du package.
 *
 * `../compliance/status.js` depuis `catalog/` donne `compliance`. Une chaîne
 * vide désigne la racine du package — là où vivent `index.ts` et `roles.ts`.
 */
function moduleVise(depuis: string, specificateur: string): string {
  const resolu = posix.normalize(posix.join(depuis, specificateur));
  const dossier = posix.dirname(resolu);
  return dossier === "." ? "" : dossier;
}

// ---------------------------------------------------------------------------
// Le domaine ne connaît rien du dehors
// ---------------------------------------------------------------------------

/**
 * Tests du domaine autorisés à lire le système de fichiers, et pourquoi.
 *
 * La règle de pureté porte sur le **code livré** : c'est lui qui doit rester
 * exécutable sans base, sans réseau et sans horloge. Un test qui lit un
 * document ne l'affaiblit pas.
 *
 * Mais il crée un couplage réel — le package atteint `docs/` — et le cacher
 * derrière un assouplissement général de la règle reviendrait à rendre la garde
 * muette sur tout un pan. L'exception est donc nommée fichier par fichier, avec
 * sa raison, comme le fait déjà la garde anti-monétaire.
 */
const EXCEPTIONS_DE_TEST: Readonly<Record<string, { readonly modules: readonly string[]; readonly raison: string }>> = {
  "packages/domain/src/psp/documents.test.ts": {
    modules: ["node:fs"],
    raison:
      "Vérifie que les demandes écrites aux prestataires couvrent bien les dix-sept points de qualification. " +
      "Son objet est le contenu des documents : il lui faut donc les lire. Un questionnaire dérive plus vite " +
      "qu'un modèle, et ce test est le seul lien mécanique entre docs/ et le code.",
  },
};

const TESTS_LISANT_DES_FICHIERS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  Object.entries(EXCEPTIONS_DE_TEST).map(([chemin, { modules }]) => [chemin, modules]),
);

describe("le domaine ne connaît rien du dehors", () => {
  it("n'importe aucun paquet externe hors de ses tests", () => {
    // Une seule dépendance suffirait à faire dépendre une règle métier d'un
    // framework, d'une base ou d'une horloge. Le package se présente comme des
    // fonctions pures ; c'est ici que cette promesse tient ou tombe.
    const fautifs = DOMAINE.filter((f) => !f.estTest)
      .flatMap((f) => f.imports.filter((i) => !estRelatif(i)).map((i) => `${f.chemin} → ${i}`));
    expect(fautifs).toEqual([]);
  });

  it("ne tolère que vitest dans ses tests, à une exception nommée près", () => {
    const fautifs = DOMAINE.filter((f) => f.estTest).flatMap((f) =>
      f.imports
        .filter((i) => !estRelatif(i) && i !== "vitest" && !(TESTS_LISANT_DES_FICHIERS[f.chemin] ?? []).includes(i))
        .map((i) => `${f.chemin} → ${i}`),
    );
    expect(fautifs).toEqual([]);
  });

  it("chaque exception porte une justification écrite", () => {
    for (const [chemin, { raison }] of Object.entries(EXCEPTIONS_DE_TEST)) {
      expect(raison.length, chemin).toBeGreaterThan(60);
    }
  });

  it("n'importe jamais depuis une application", () => {
    const fautifs = DOMAINE.flatMap((f) =>
      f.imports.filter((i) => i.includes("apps/") || i.startsWith("@cbd/api")).map((i) => `${f.chemin} → ${i}`),
    );
    expect(fautifs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Les frontières internes du domaine
// ---------------------------------------------------------------------------

/**
 * Le noyau : ce que tout module a le droit d'importer.
 *
 * **Un seul fichier y figure aujourd'hui, et c'est un constat, pas un choix de
 * conception.** `roles.ts` est déjà importé par `compliance/`, `delivery/`,
 * `merchant/` et `order/`, et n'importe rien lui-même. Le noyau ne crée donc
 * aucune structure : il nomme un patron que le code possède depuis longtemps.
 *
 * Deux règles le tiennent fermé :
 *
 *  1. **Le noyau n'importe aucun module du domaine.** Un noyau qui dépendrait
 *     d'un domaine métier créerait un chemin entre tous les modules, par lui.
 *  2. **Un module n'y entre que par une décision écrite.** Cette liste est
 *     littérale : l'élargir est une ligne à ajouter ici, visible en revue.
 *
 * **Pourquoi cette liste est courte, et doit le rester.** Le noyau est la seule
 * porte de sortie des frontières `#5` et `#6` : tout ce qu'on y dépose devient
 * universellement importable. Un noyau qui grossit redevient le `shared/`
 * fourre-tout que ces frontières existent pour empêcher. Le jour où un module
 * y entre « parce que c'est plus pratique », la garde a cessé de servir.
 *
 * `evidence/` y entrera lorsqu'il existera — pas avant. Une règle qui nomme un
 * module absent ne se vérifie pas, elle se croit.
 */
const NOYAU = ["roles"] as const;

/** Le noyau vit à la racine du package : ses modules ont un dossier vide. */
const APPARTIENT_AU_NOYAU = (module: string, specificateur: string): boolean =>
  module === "" &&
  NOYAU.some((n) => specificateur === `./${n}.js` || specificateur.endsWith(`/${n}.js`));

describe("le noyau reste fermé et minimal", () => {
  it("ne contient que roles.ts", () => {
    expect(NOYAU).toEqual(["roles"]);
  });

  it("n'importe aucun module du domaine", () => {
    // Un noyau qui dépendrait d'un domaine métier ouvrirait un chemin entre
    // tous les modules, par lui.
    const fautifs = DOMAINE.filter(
      (f) => !f.estTest && NOYAU.some((n) => f.chemin === `packages/domain/src/${n}.ts`),
    ).flatMap((f) => f.imports.filter(estRelatif).map((i) => `${f.chemin} → ${i}`));
    expect(fautifs).toEqual([]);
  });
});

/**
 * Modules du domaine dont personne ne dépend, et qui doivent le rester.
 *
 * `psp/` porte l'état d'un dossier commercial — des faits datés, pas des
 * règles. `ports/` porte les contrats de fournisseurs externes. Qu'une règle
 * métier vienne dépendre de l'un ou de l'autre serait le premier pas vers une
 * décision de catalogue conditionnée par un prestataire de paiement. Aujourd'hui
 * seul `index.ts` les atteint, pour les réexporter.
 */
const MODULES_ISOLES = ["psp", "ports"] as const;

describe("les frontières internes du domaine", () => {
  for (const isole of MODULES_ISOLES) {
    it(`aucune règle métier ne dépend de ${isole}/`, () => {
      const fautifs = DOMAINE.filter((f) => !f.estTest && f.module !== isole && f.module !== "")
        .flatMap((f) =>
          f.imports
            .filter((i) => estRelatif(i) && moduleVise(f.module, i) === isole)
            .map((i) => `${f.chemin} → ${i}`),
        );
      expect(fautifs).toEqual([]);
    });
  }

  it("psp/ ne dépend d'aucun module hors noyau", () => {
    // La qualification d'un prestataire ne doit rien pouvoir emprunter au
    // catalogue, aux commandes ou aux livraisons : ce sont des décisions
    // externes, pas des règles de la plateforme.
    const fautifs = DOMAINE.filter((f) => !f.estTest && f.module === "psp").flatMap((f) =>
      f.imports
        .filter(
          (i) =>
            estRelatif(i) &&
            moduleVise(f.module, i) !== "psp" &&
            !APPARTIENT_AU_NOYAU(moduleVise(f.module, i), i),
        )
        .map((i) => `${f.chemin} → ${i}`),
    );
    expect(fautifs).toEqual([]);
  });

  it("catalog/ ne connaît que compliance/, merchant/ et le noyau", () => {
    // Le portail de mise en vente a besoin de l'état de conformité du produit et
    // de l'état du vendeur. Il n'a besoin de rien d'autre, et surtout pas d'une
    // commande, d'une livraison ni d'un prix.
    // La racine du package n'est plus autorisée en bloc : seul le noyau l'est.
    // Un fichier racine hors noyau redeviendrait importable par tout le monde.
    const autorises = new Set(["catalog", "compliance", "merchant"]);
    const fautifs = DOMAINE.filter((f) => !f.estTest && f.module === "catalog").flatMap((f) =>
      f.imports
        .filter(
          (i) =>
            estRelatif(i) &&
            !autorises.has(moduleVise(f.module, i)) &&
            !APPARTIENT_AU_NOYAU(moduleVise(f.module, i), i),
        )
        .map((i) => `${f.chemin} → ${i}`),
    );
    expect(fautifs).toEqual([]);
  });

  it("ne contient aucun cycle", () => {
    const arcs = new Map<string, Set<string>>();
    for (const f of DOMAINE) {
      if (f.estTest) continue;
      const source = f.chemin.replace(/\.ts$/, "");
      const cibles = arcs.get(source) ?? new Set<string>();
      for (const i of f.imports) {
        if (!estRelatif(i)) continue;
        const base = "packages/domain/src";
        cibles.add(posix.normalize(posix.join(`${base}/${f.module}`, i)).replace(/\.js$/, ""));
      }
      arcs.set(source, cibles);
    }
    const vus = new Set<string>();
    const pile: string[] = [];
    const cycles: string[] = [];
    const descendre = (n: string): void => {
      if (pile.includes(n)) {
        cycles.push([...pile.slice(pile.indexOf(n)), n].join(" → "));
        return;
      }
      if (vus.has(n)) return;
      vus.add(n);
      pile.push(n);
      for (const c of arcs.get(n) ?? []) descendre(c);
      pile.pop();
    };
    for (const n of arcs.keys()) descendre(n);
    expect(cycles).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// La surface publique du domaine
// ---------------------------------------------------------------------------

/**
 * Les modules que `@cbd/domain` expose, et eux seuls.
 *
 * Écrits en toutes lettres : `index.ts` procède par `export *`, si bien
 * qu'ajouter un module au barillet élargit la surface publique du package sans
 * qu'aucun autre fichier ne change. Cette liste rend l'élargissement visible en
 * revue.
 *
 * **Le pointage s'arrête aux modules, pas aux symboles.** Figer les deux cent
 * quatre-vingt-dix symboles publics taxerait chaque commit produit — cette
 * surface a vocation à croître, contrairement aux faits que fige le filet de
 * conservation. Le pointage par module attrape ce qui compte ici : l'apparition
 * d'un domaine entier dans l'API publique.
 */
const MODULES_PUBLICS = [
  "./catalog/listing-gate.js",
  "./catalog/policy.js",
  "./catalog/publication.js",
  "./compliance/status.js",
  "./delivery/assignment.js",
  "./delivery/availability.js",
  "./delivery/dispatch.js",
  "./delivery/payout.js",
  "./delivery/proof.js",
  "./delivery/replay.js",
  "./delivery/status.js",
  "./merchant/status.js",
  "./order/status.js",
  "./order/transitions.js",
  "./ports/delivery-provider.js",
  "./ports/payment-provider.js",
  "./pricing/breakdown.js",
  "./psp/dossier.js",
  "./psp/qualification.js",
  "./psp/registre.js",
  "./qr/events.js",
  "./roles.js",
  "./tenancy/scope.js",
] as const;

describe("la surface publique du domaine", () => {
  it("expose exactement les modules déclarés", () => {
    const index = readFileSync(join(RACINE, "packages/domain/src/index.ts"), "utf8");
    const exposes = [...index.matchAll(/export \* from "([^"]+)"/g)].map((m) => m[1] ?? "").sort();
    expect(exposes).toEqual([...MODULES_PUBLICS].sort());
  });

  it("n'expose aucun module par un export par défaut", () => {
    // Un export par défaut se renomme à l'import : la même règle porterait deux
    // noms selon l'appelant, et aucune recherche ne les rapprocherait.
    const fautifs = [...DOMAINE, ...API]
      .filter((f) => !f.estTest && /^export default\b/m.test(readFileSync(join(RACINE, f.chemin), "utf8")))
      .map((f) => f.chemin);
    expect(fautifs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// L'application : qui a le droit de connaître la base
// ---------------------------------------------------------------------------

/**
 * Fichiers autorisés à importer `@cbd/db`, et la raison de chacun.
 *
 * Partout ailleurs, services et moteurs dépendent d'interfaces — c'est ce qui
 * permet de tester les règles sans base. Élargir cette liste doit être un acte
 * délibéré, pas un import ajouté au fil d'une correction.
 */
const CONNAISSENT_LA_BASE: Readonly<Record<string, string>> = {
  "apps/api/src/composition.ts": "Racine de composition : le seul assembleur, il n'arbitre rien.",
  "apps/api/src/catalog/prisma-repository.ts": "Adaptateur : traduit les lignes en objets du domaine.",
  "apps/api/src/deliveries/prisma-repository.ts":
    "Adaptateur : porte le verrouillage optimiste des livraisons et l'index partiel d'affectation.",
  "apps/api/src/orders/prisma-repository.ts":
    "Adaptateur : traduit les transitions de commande en écritures versionnées.",
  "apps/api/src/drivers/prisma-repository.ts":
    "Adaptateur : lit les coursiers candidats, sans jamais décider d'une affectation.",
  "apps/api/src/deliveries/dispatch-context.ts": "Lecture hors transaction préparant une décision de dispatch.",
  "apps/api/src/catalog/postgres.integration.test.ts": "Test d'intégration : sa raison d'être est la base réelle.",
  "apps/api/src/deliveries/postgres.integration.test.ts":
    "Test d'intégration : prouve le verrouillage et l'index partiel contre un vrai PostgreSQL.",
};

describe("l'application garde la base à sa place", () => {
  it("seuls la racine de composition, les adaptateurs et les tests d'intégration importent @cbd/db", () => {
    const importateurs = API.filter((f) => f.imports.some((i) => i === "@cbd/db")).map((f) => f.chemin);
    expect(importateurs.sort()).toEqual(Object.keys(CONNAISSENT_LA_BASE).sort());
  });

  it("chaque autorisation porte une justification écrite", () => {
    for (const [chemin, raison] of Object.entries(CONNAISSENT_LA_BASE)) {
      expect(raison.length, chemin).toBeGreaterThan(20);
    }
  });

  it("n'importe jamais une autre application", () => {
    const fautifs = API.flatMap((f) =>
      f.imports.filter((i) => /^@cbd\/(admin|client|shop|ui)$/.test(i)).map((i) => `${f.chemin} → ${i}`),
    );
    expect(fautifs).toEqual([]);
  });

  it("n'utilise aucun import profond dans un package", () => {
    // `@cbd/domain/src/catalog/policy.js` contournerait la surface publique et
    // rendrait chaque réorganisation interne cassante pour les consommateurs.
    const fautifs = [...DOMAINE, ...API].flatMap((f) =>
      f.imports.filter((i) => /^@cbd\/[a-z-]+\//.test(i)).map((i) => `${f.chemin} → ${i}`),
    );
    expect(fautifs).toEqual([]);
  });
});
