/**
 * Garde-fou statique sur les adaptateurs Prisma.
 *
 * Le `TenantScope` nominal empêche d'**oublier le paramètre**. Il n'empêche
 * pas d'oublier de **s'en servir** dans la requête :
 *
 * ```ts
 * findById(scope, id) {
 *   return db.delivery.findFirst({ where: { id } });   // compile, et fuit.
 * }
 * ```
 *
 * Aucun type ne rattrape ça, et sans PostgreSQL on ne peut pas le voir en
 * intégration. Ce test relit donc le source des adaptateurs, extrait chaque
 * appel Prisma, et vérifie qu'il porte un filtre de tenant — directement
 * (`merchantId: scope.merchantId`) ou par relation
 * (`delivery: { merchantId: scope.merchantId }`).
 *
 * Les exceptions sont nommées une par une plus bas. Ajouter une méthode sans
 * filtre fait échouer ce test, ce qui est exactement le but : la décision
 * devient consciente au lieu de passer inaperçue en revue.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

const ADAPTERS = [
  join(here, "deliveries", "prisma-repository.ts"),
  join(here, "deliveries", "dispatch-context.ts"),
  join(here, "orders", "prisma-repository.ts"),
  // Le dépôt driver est délibérément hors portée tenant — un driver appartient
  // au réseau, pas à un shop. Il est relu ici quand même : chacune de ses
  // requêtes doit être nommée et justifiée plus bas, faute de quoi une future
  // méthode qui lirait une commande ou une livraison passerait inaperçue.
  join(here, "drivers", "prisma-repository.ts"),
  join(here, "catalog", "prisma-repository.ts"),
];

/**
 * Appels autorisés sans filtre tenant, avec leur justification.
 *
 * La clé est `<modèle>.<méthode>` accompagné de la fonction englobante, pour
 * qu'une exception accordée à `findForAdmin` ne couvre pas silencieusement une
 * autre méthode du même modèle.
 */
const ALLOWED_WITHOUT_TENANT: ReadonlyMap<string, string> = new Map([
  [
    "findForAdmin:delivery.findUnique",
    "Accès inter-tenant du back-office, typé AdminScope et inatteignable depuis un chemin tenant.",
  ],
  [
    "findForAdmin:order.findUnique",
    "Accès inter-tenant du back-office côté commande, typé AdminScope et inatteignable depuis un chemin tenant.",
  ],
  [
    "appendAuditEntry:auditLog.create",
    "AuditLog est transverse et ne porte pas merchantId : la portée est recopiée dans metadata.",
  ],
  [
    "appendStatusEvent:deliveryStatusEvent.create",
    "Écrit après vérification d'appartenance de la livraison dans la même transaction.",
  ],
  [
    "appendStatusEvent:orderStatusEvent.create",
    "Écrit après vérification d'appartenance de la commande dans la même transaction.",
  ],
  [
    "createAssignments:deliveryAssignment.create",
    "Écrit après vérification d'appartenance de la livraison dans la même transaction.",
  ],
  [
    "recordDispatchRound:dispatchRound.create",
    "Porte merchantId dans `data`, pas dans `where` : la ligne est créée dans la portée.",
  ],
  [
    "recordDispatchRound:dispatchDecision.createMany",
    "Rattachée au round qui vient d'être créé dans la portée.",
  ],
  // --- Dépôt driver : hors portée tenant par conception ---------------------
  [
    "findById:driver.findUnique",
    "Un driver appartient au réseau et non à un shop : le scoper par merchantId découperait la flotte par boutique.",
  ],
  [
    "findByUserId:driver.findUnique",
    "Lecture du driver par son compte utilisateur, pour l'authentification : aucun tenant n'intervient dans cette identité.",
  ],
  [
    "listDispatchableInZone:driver.findMany",
    "Candidats d'une zone géographique, mutualisés entre shops : c'est précisément l'intérêt d'un réseau partagé.",
  ],
  [
    "setAvailability:driverAvailabilityLog.updateMany",
    "Clôt la période de disponibilité en cours d'un driver, qui n'a pas de rattachement marchand.",
  ],
  [
    "setAvailability:driver.update",
    "Le driver met à jour sa propre disponibilité : ressource réseau, aucun merchantId ne s'y applique.",
  ],
  [
    "setAvailability:driverAvailabilityLog.create",
    "Ouvre une période de disponibilité pour un driver, ressource réseau sans rattachement marchand.",
  ],
  // --- Candidat à la mise en vente ---
  [
    "findCandidate:merchant.findFirst",
    "Le shop lui-même : sur cette table, la clé primaire est le tenant. Le filtre est `id: scope.merchantId`, que le détecteur ne peut pas reconnaître puisqu'il cherche une colonne `merchantId` — laquelle n'existe pas sur Merchant.",
  ],
  [
    "findCandidate:product.findFirst",
    "Un produit peut relever d'un catalogue partagé et n'a donc pas de merchantId propre : la portée passe par la relation inventory, filtrée sur le scope dans la même requête.",
  ],
]);

interface PrismaCall {
  readonly file: string;
  readonly enclosing: string;
  readonly model: string;
  readonly method: string;
  readonly args: string;
  readonly line: number;
}

/** Extrait le bloc d'arguments équilibré qui suit une position d'ouverture. */
function balancedSlice(source: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (char === "(" || char === "{") depth += 1;
    else if (char === ")" || char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  return source.slice(openIndex);
}

/** Nom de la méthode du dépôt qui contient cette position. */
function enclosingMethod(source: string, index: number): string {
  const before = source.slice(0, index);
  const matches = [...before.matchAll(/async\s+([A-Za-z0-9_]+)\s*\(/g)];
  return matches.at(-1)?.[1] ?? "<inconnu>";
}

function collectPrismaCalls(file: string): readonly PrismaCall[] {
  const source = readFileSync(file, "utf8");
  const calls: PrismaCall[] = [];

  // `db` comme `tx` : une requête écrite dans une transaction imbriquée doit
  // être relue comme les autres, sinon le garde-fou s'aveugle tout seul.
  const pattern = /\b(?:db|tx)\.([a-zA-Z]+)\.(findFirst|findMany|findUnique|update|updateMany|create|createMany|delete|deleteMany|upsert|count|aggregate)\s*\(/g;

  for (const match of source.matchAll(pattern)) {
    const openIndex = match.index + match[0].length - 1;
    calls.push({
      file,
      enclosing: enclosingMethod(source, match.index),
      model: match[1] as string,
      method: match[2] as string,
      args: balancedSlice(source, openIndex),
      line: source.slice(0, match.index).split("\n").length,
    });
  }

  return calls;
}

/** Vrai si les arguments contiennent un filtre de tenant, direct ou par relation. */
function hasTenantFilter(args: string): boolean {
  const normalized = args.replace(/\s+/g, " ");
  return (
    normalized.includes("merchantId: scope.merchantId") ||
    normalized.includes("merchantId: scope.merchantId,")
  );
}

const allCalls = ADAPTERS.flatMap(collectPrismaCalls);

describe("le garde-fou lit bien les adaptateurs", () => {
  it("trouve des appels Prisma dans chaque fichier", () => {
    for (const adapter of ADAPTERS) {
      expect(collectPrismaCalls(adapter).length, adapter).toBeGreaterThan(0);
    }
  });

  it("en trouve assez pour que le test ait du sens", () => {
    // Si un refactor déplaçait les requêtes ailleurs, ce test deviendrait vide
    // et passerait sans rien vérifier. Ce seuil l'empêche.
    expect(allCalls.length).toBeGreaterThanOrEqual(15);
  });

  it("identifie correctement la méthode englobante", () => {
    const findById = allCalls.filter((call) => call.enclosing === "findById");
    expect(findById.length).toBeGreaterThan(0);
  });
});

describe("chaque requête Prisma porte un filtre tenant", () => {
  it("aucune fuite non déclarée", () => {
    const fuites = allCalls
      .filter((call) => !hasTenantFilter(call.args))
      .filter((call) => !ALLOWED_WITHOUT_TENANT.has(`${call.enclosing}:${call.model}.${call.method}`));

    const détail = fuites
      .map(
        (call) =>
          `  ${call.file.split("/src/")[1]}:${call.line} — ${call.enclosing}() appelle ` +
          `${call.model}.${call.method}() sans filtre merchantId`,
      )
      .join("\n");

    expect(fuites, `Requêtes Prisma sans portée tenant :\n${détail}`).toHaveLength(0);
  });

  it("chaque exception est justifiée par écrit", () => {
    for (const [clé, justification] of ALLOWED_WITHOUT_TENANT) {
      expect(justification.length, `${clé} n'a pas de justification`).toBeGreaterThan(30);
    }
  });

  it("n'accorde aucune exception inutilisée", () => {
    // Une exception qui ne correspond plus à aucun appel est un reste de
    // refactor : elle couvrirait un futur appel du même nom sans qu'on y pense.
    const clésRéelles = new Set(
      allCalls.map((call) => `${call.enclosing}:${call.model}.${call.method}`),
    );
    const orphelines = [...ALLOWED_WITHOUT_TENANT.keys()].filter((clé) => !clésRéelles.has(clé));
    expect(orphelines, `Exceptions devenues inutiles : ${orphelines.join(", ")}`).toHaveLength(0);
  });
});

describe("le verrou optimiste passe par updateMany", () => {
  it("n'utilise jamais update() pour un changement de statut", () => {
    // `update()` lève quand rien ne correspond ; `updateMany()` renvoie
    // count: 0. Un conflit de version est un cas nominal, pas une exception.
    const updatesSimples = allCalls.filter(
      (call) => call.method === "update" && call.enclosing.startsWith("updateStatus"),
    );
    expect(updatesSimples).toHaveLength(0);
  });

  it("inclut la version attendue dans le where de chaque updateStatus", () => {
    const updates = allCalls.filter((call) => call.enclosing === "updateStatus");
    expect(updates.length).toBeGreaterThan(0);
    for (const call of updates) {
      expect(call.args.replace(/\s+/g, " "), `${call.file}:${call.line}`).toContain(
        "version: expectedVersion",
      );
    }
  });

  it("incrémente la version à chaque écriture de statut", () => {
    for (const call of allCalls.filter((c) => c.enclosing === "updateStatus")) {
      expect(call.args.replace(/\s+/g, " ")).toContain("version: { increment: 1 }");
    }
  });
});

describe("le garde-fou détecte réellement une fuite", () => {
  it("repère une requête sans filtre dans un source fabriqué", () => {
    // Vérification du vérificateur : sans ça, un bug de regex rendrait tous les
    // tests ci-dessus verts sur du code qui fuit.
    const fauxSource = `
      async findById(scope, id) {
        const row = await db.delivery.findFirst({ where: { id } });
        return row;
      }
    `;
    const openIndex = fauxSource.indexOf("({ where");
    expect(hasTenantFilter(balancedSlice(fauxSource, openIndex + 1))).toBe(false);
  });

  it("accepte une requête correctement filtrée", () => {
    const bonSource = `({ where: { id, merchantId: scope.merchantId } })`;
    expect(hasTenantFilter(bonSource)).toBe(true);
  });

  it("accepte un filtre par relation", () => {
    const parRelation = `({ where: { id, delivery: { merchantId: scope.merchantId } } })`;
    expect(hasTenantFilter(parRelation)).toBe(true);
  });
});
