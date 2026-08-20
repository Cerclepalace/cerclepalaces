/**
 * Client Prisma partagé.
 *
 * Une seule instance par processus. Chaque `new PrismaClient()` ouvre son
 * propre pool de connexions ; en développement, le rechargement à chaud en
 * créerait un à chaque modification jusqu'à épuiser les connexions de
 * PostgreSQL — d'où la mise en cache sur `globalThis`, qui survit au
 * rechargement des modules.
 *
 * En production, le module n'est évalué qu'une fois et la branche globale ne
 * sert pas.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    // `warn` et `error` seulement : journaliser chaque requête en production
    // inonderait les logs et ferait fuiter des données personnelles dans les
    // paramètres liés.
    log: process.env["NODE_ENV"] === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env["NODE_ENV"] !== "production") {
  globalForPrisma.prisma = prisma;
}

export type { PrismaClient };
export { Prisma } from "@prisma/client";
