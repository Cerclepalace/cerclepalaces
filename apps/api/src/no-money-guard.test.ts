/**
 * Garde-fou anti-monétaire.
 *
 * Le périmètre transactionnel est gelé (O-001). Jusqu'à sa clôture, aucune
 * logique de paiement, d'encaissement, de reversement ou de comptabilité ne doit
 * entrer dans le code. Ce test le vérifie à chaque exécution, à la place des
 * `grep` manuels qui tenaient lieu de contrôle jusqu'ici — et qui ne tenaient
 * rien, puisque personne n'était obligé de les lancer.
 *
 * **Ce qu'il cherche : des identifiants, pas des mots.** Interdire « paiement »
 * dans un commentaire rendrait impossible d'expliquer *pourquoi* le paiement est
 * gelé. Le test retire donc les commentaires avant d'analyser, et ne s'intéresse
 * qu'aux noms que le code manipule : déclarations, propriétés, littéraux de
 * chaîne, imports.
 *
 * **Les exceptions sont nommées une par une, avec leur justification.** Trois
 * fichiers portent légitimement du vocabulaire monétaire : un calculateur de
 * répartition pur, un calculateur de rémunération pur, et une interface de
 * fournisseur de paiement dont l'implémentation refuse toute opération. Aucun
 * n'encaisse quoi que ce soit. Les déplacer hors de `src/` pour faire taire le
 * garde reviendrait à cacher ce qu'il est censé montrer.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const racine = join(here, "..", "..", "..");

/**
 * Racines interdites, sous forme de fragments recherchés dans un identifiant
 * normalisé (casse et séparateurs retirés). `payout` attrape ainsi `payout`,
 * `payoutCents`, `PAYOUT_RATE`, `driver_payout` et `DriverPayout`.
 */
const RACINES_INTERDITES = [
  "payment",
  "psp",
  "payout",
  "ledger",
  "wallet",
  "commission",
  "refund",
  "chargeback",
  "acquiring",
  "invoice",
  "checkout",
  "sellerbalance",
  "moneybalance",
] as const;

interface Exception {
  /** Identifiants tolérés dans ce fichier, et eux seuls. */
  readonly jetons: readonly string[];
  readonly raison: string;
}

/**
 * Exceptions accordées **jeton par jeton**, pas fichier par fichier.
 *
 * Autoriser un fichier entier laisserait entrer n'importe quel autre terme
 * monétaire au même endroit plus tard. Ici, `order/status.ts` peut nommer
 * `PENDING_PAYMENT` sans pouvoir gagner un `addPayout()` en silence.
 */
const EXCEPTIONS: ReadonlyMap<string, Exception> = new Map([
  [
    "packages/domain/src/pricing/breakdown.ts",
    {
      jetons: ["*"],
      raison:
        "Calculateur de répartition pur : il décompose un montant en parts, sans encaisser, sans écrire et sans connaître aucun fournisseur. Gelé en l'état jusqu'à la clôture d'O-001.",
    },
  ],
  [
    "packages/domain/src/delivery/payout.ts",
    {
      jetons: ["*"],
      raison:
        "Calculateur de rémunération driver, pur et déterministe. Aucun versement n'est effectué et aucune table ne stocke son résultat depuis la décision 14.",
    },
  ],
  [
    "packages/domain/src/ports/payment-provider.ts",
    {
      jetons: ["*"],
      raison:
        "Interface seule. Son unique implémentation refuse explicitement toute opération plutôt que d'en simuler une : c'est ce refus qui matérialise le gel transactionnel.",
    },
  ],
  [
    "packages/domain/src/order/status.ts",
    {
      jetons: [
        "PENDING_PAYMENT",
        "PAYMENT_FAILED",
        "ORDER_PAYMENT_STATES",
        "isPaymentState",
        "requiresRefundDecision",
      ],
      raison:
        "États de commande et signal associé. `PENDING_PAYMENT` et `PAYMENT_FAILED` sont des états d'une machine déjà écrite et testée, pas un moteur de paiement ; `requiresRefundDecision` lève un drapeau que personne ne traite encore.",
    },
  ],
  [
    "packages/domain/src/order/transitions.ts",
    {
      jetons: ["PENDING_PAYMENT", "PAYMENT_FAILED", "PSP"],
      raison:
        "Transitions entre états de commande. Le mot PSP n'apparaît que dans le motif littéral d'une transition, pour dire d'où viendrait la confirmation le jour où un fournisseur existera.",
    },
  ],
  [
    "apps/api/src/orders/service.ts",
    {
      jetons: ["requiresRefundDecision", "refundDecisionRequired"],
      raison:
        "Un drapeau booléen porté par le résultat d'une transition : il signale qu'une question de remboursement se pose, et rien ne la traite. Aucun montant, aucun mouvement, aucun fournisseur.",
    },
  ],
  [
    "packages/domain/src/index.ts",
    {
      jetons: ["payout", "payment"],
      raison:
        "Réexports des deux modules déjà exceptés ci-dessus. Le fichier ne contient aucune logique propre, seulement des lignes `export * from`.",
    },
  ],
  [
    "apps/api/src/http/contract.ts",
    {
      jetons: ["PaymentNotConfiguredError"],
      raison:
        "Nom de l'erreur que lève le fournisseur factice quand on tente une opération. La citer permet de la mapper sur un code HTTP ; elle marque le refus, pas une capacité.",
    },
  ],
  [
    "packages/config/src/env.ts",
    {
      jetons: ["PAYMENT_PROVIDER", "PAYMENT_API_KEY", "PAYMENT_WEBHOOK_SECRET"],
      raison:
        "Trois variables d'environnement optionnelles, non lues par le code applicatif : aucun fournisseur n'est retenu (décision 09). Elles sont conservées pour que la règle de production interdisant un service qui encaisse sans secret de webhook reste écrite quelque part.",
    },
  ],
]);

/** Retire commentaires de ligne et de bloc, pour ne juger que du code. */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** Normalise un identifiant : casse et séparateurs disparaissent. */
function normaliserIdentifiant(valeur: string): string {
  return valeur.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fichiersSource(dossier: string): string[] {
  const trouvés: string[] = [];
  for (const entrée of readdirSync(dossier)) {
    if (entrée === "node_modules" || entrée === "dist") continue;
    const chemin = join(dossier, entrée);
    if (statSync(chemin).isDirectory()) {
      trouvés.push(...fichiersSource(chemin));
    } else if (entrée.endsWith(".ts") && !entrée.endsWith(".test.ts")) {
      trouvés.push(chemin);
    }
  }
  return trouvés;
}

const RACINES_SRC = [
  join(racine, "packages", "domain", "src"),
  join(racine, "packages", "config", "src"),
  join(racine, "packages", "db", "src"),
  join(racine, "apps", "api", "src"),
];

interface Violation {
  readonly fichier: string;
  readonly ligne: number;
  readonly racine: string;
  readonly extrait: string;
}

/**
 * Analyse une source et rend les identifiants portant une racine interdite.
 *
 * Exportée sous forme de fonction pure pour être testable sur du code fabriqué :
 * un garde-fou qu'on ne peut pas faire échouer volontairement ne prouve rien.
 */
function chercherViolations(fichier: string, source: string): readonly Violation[] {
  const violations: Violation[] = [];
  const lignes = sansCommentaires(source).split("\n");

  lignes.forEach((ligne, index) => {
    // Les identifiants du code, plus le contenu des chaînes littérales : un
    // nom d'action `"order.refund"` est une intention, pas un commentaire.
    for (const jeton of ligne.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
      const normalisé = normaliserIdentifiant(jeton);
      for (const racineInterdite of RACINES_INTERDITES) {
        if (normalisé.includes(racineInterdite)) {
          violations.push({
            fichier,
            ligne: index + 1,
            racine: racineInterdite,
            extrait: jeton,
          });
        }
      }
    }
  });

  return violations;
}

describe("le garde-fou sait échouer", () => {
  it("détecte une violation en camelCase", () => {
    const trouvé = chercherViolations("faux.ts", "const sellerPayoutCents = 0;");
    expect(trouvé.map((v) => v.racine)).toContain("payout");
  });

  it("détecte une violation en snake_case", () => {
    expect(chercherViolations("faux.ts", "const seller_payout_cents = 0;")).not.toHaveLength(0);
  });

  it("détecte une violation en SCREAMING_CASE", () => {
    expect(chercherViolations("faux.ts", "const LEDGER_ENTRY = 1;")).not.toHaveLength(0);
  });

  it("détecte un nom isolé", () => {
    expect(chercherViolations("faux.ts", "import { wallet } from './x.js';")).not.toHaveLength(0);
  });

  it("détecte une intention cachée dans une chaîne", () => {
    // `action: "order.refund"` n'est pas un commentaire : c'est un comportement.
    expect(chercherViolations("faux.ts", 'const a = "order.refund";')).not.toHaveLength(0);
  });

  it("détecte un import de module monétaire", () => {
    expect(
      chercherViolations("faux.ts", 'import { x } from "./checkout/session.js";'),
    ).not.toHaveLength(0);
  });

  it("ne se déclenche pas sur un commentaire qui explique le gel", () => {
    // Sans cette propriété, documenter le gel deviendrait impossible.
    const source = [
      "// Aucun paiement n'est implémenté : voir payment-provider.ts.",
      "/* Le ledger et les payouts restent gelés (O-001). */",
      "const x = 1;",
    ].join("\n");
    expect(chercherViolations("faux.ts", source)).toHaveLength(0);
  });

  it("ne se déclenche pas sur du vocabulaire métier voisin", () => {
    // « price » et « stock » ne sont pas transactionnels : un catalogue a des
    // prix affichés sans qu'aucun euro ne bouge.
    expect(chercherViolations("faux.ts", "const priceCents = 100; const stock = 3;")).toHaveLength(
      0,
    );
  });
});

describe("aucune logique monétaire dans src/", () => {
  const violations = RACINES_SRC.flatMap((dossier) =>
    fichiersSource(dossier).flatMap((fichier) => {
      const chemin = relative(racine, fichier).split("\\").join("/");
      const exception = EXCEPTIONS.get(chemin);
      const trouvées = chercherViolations(chemin, readFileSync(fichier, "utf8"));
      if (exception === undefined) return trouvées;
      if (exception.jetons.includes("*")) return [];
      return trouvées.filter((v) => !exception.jetons.includes(v.extrait));
    }),
  );

  it("le garde lit bien quelque chose", () => {
    // Sans ce seuil, un chemin cassé rendrait le test vert en n'analysant rien.
    const total = RACINES_SRC.reduce((n, d) => n + fichiersSource(d).length, 0);
    expect(total).toBeGreaterThan(20);
  });

  it("ne trouve aucune violation non déclarée", () => {
    const détail = violations
      .map((v) => `  ${v.fichier}:${v.ligne} — « ${v.extrait} » (racine « ${v.racine} »)`)
      .join("\n");
    expect(violations, `Vocabulaire transactionnel hors périmètre :\n${détail}`).toHaveLength(0);
  });

  it("justifie chaque exception par écrit", () => {
    for (const [fichier, exception] of EXCEPTIONS) {
      expect(exception.raison.length, `${fichier} n'a pas de justification`).toBeGreaterThan(60);
    }
  });

  it("n'accorde aucune exception devenue inutile", () => {
    // Une exception qui ne correspond plus à rien couvrirait un futur fichier
    // du même nom sans qu'on y pense.
    for (const fichier of EXCEPTIONS.keys()) {
      const source = readFileSync(join(racine, fichier), "utf8");
      expect(
        chercherViolations(fichier, source).length,
        `${fichier} n'a plus besoin d'exception`,
      ).toBeGreaterThan(0);
    }
  });

  it("n'autorise qu'un jeton nommé, pas son fichier", () => {
    // Le point de la granularité : un fichier excepté pour `PENDING_PAYMENT` ne
    // doit pas gagner un `payout` en silence.
    const exception = EXCEPTIONS.get("packages/domain/src/order/status.ts");
    expect(exception?.jetons).not.toContain("*");
    const trouvées = chercherViolations("x.ts", "const sellerPayout = 1; const PENDING_PAYMENT = 2;");
    const restantes = trouvées.filter((v) => !(exception?.jetons ?? []).includes(v.extrait));
    expect(restantes.map((v) => v.extrait)).toEqual(["sellerPayout"]);
  });
});
