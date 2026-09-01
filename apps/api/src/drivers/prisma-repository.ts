/**
 * Implémentation Prisma du dépôt driver.
 *
 * **Ce fichier n'est volontairement pas tenanté, et c'est la seule zone du code
 * qui a le droit de ne pas l'être.** Un driver n'appartient pas à un shop : il
 * appartient au réseau. Filtrer ses lectures par `merchantId` reviendrait à
 * découper la flotte par boutique, c'est-à-dire à détruire l'intérêt même d'un
 * réseau mutualisé — chaque shop retomberait sur ses propres coursiers.
 *
 * L'étanchéité n'est pas perdue pour autant, elle est déplacée : un driver
 * n'atteint jamais une livraison par ce dépôt. Toute lecture de course passe par
 * `DeliveryRepository`, qui est scopé, et par le guard qui vérifie qu'il est
 * bien le driver assigné. Ce fichier ne rend que des candidats — un identifiant,
 * une position, une charge — jamais de donnée commerciale.
 *
 * Le test statique `tenancy-guard.test.ts` relit ce fichier comme les autres :
 * chaque requête sans filtre tenant doit y être nommée et justifiée. Ajouter ici
 * une méthode qui lirait une commande ou une livraison fera échouer ce test.
 */

import type { Prisma, PrismaClient } from "@cbd/db";
import { DEFAULT_DELIVERY_CATEGORY, DRIVER_OCCUPYING_STATUSES } from "@cbd/domain";

import type {
  DriverAvailabilityValue,
  DriverRecord,
  DriverRepository,
} from "../deliveries/repository.js";

type Db = PrismaClient | Prisma.TransactionClient;

type DriverRow = {
  id: string;
  userId: string;
  verification: string;
  availability: string;
  lastLat: number | null;
  lastLng: number | null;
  zones: { zoneId: string }[];
  _count: { deliveries: number };
};

const DRIVER_SELECT = {
  id: true,
  userId: true,
  verification: true,
  availability: true,
  lastLat: true,
  lastLng: true,
  zones: { select: { zoneId: true } },
  _count: {
    select: {
      // La charge est comptée en base, pas en mémoire : ramener les courses
      // d'un driver pour les compter côté Node coûterait une requête par
      // candidat à chaque tour de dispatch.
      deliveries: { where: { status: { in: DRIVER_OCCUPYING_STATUSES as never } } },
    },
  },
} as const;

function toDriver(row: DriverRow): DriverRecord {
  return {
    id: row.id,
    userId: row.userId,
    verification: row.verification as DriverRecord["verification"],
    availability: row.availability as DriverAvailabilityValue,
    zoneIds: row.zones.map((zone) => zone.zoneId),
    // Une position n'est complète que si les deux coordonnées le sont : un
    // driver à moitié localisé n'est pas localisé.
    position:
      row.lastLat !== null && row.lastLng !== null
        ? { lat: row.lastLat, lng: row.lastLng }
        : null,
    activeDeliveries: row._count.deliveries,
    // Les catégories de course ne sont pas encore modélisées en base : tous les
    // drivers acceptent l'unique catégorie existante. Voir
    // `DEFAULT_DELIVERY_CATEGORY`.
    supportedCategories: [DEFAULT_DELIVERY_CATEGORY],
  };
}

/**
 * Exécute un groupe d'écritures de façon atomique.
 *
 * Le dépôt accepte aussi bien un client qu'une transaction déjà ouverte. Dans
 * le second cas, ouvrir une transaction imbriquée n'a pas de sens : l'atomicité
 * est celle de l'appelant, et Prisma n'expose de toute façon pas `$transaction`
 * sur un client transactionnel.
 */
async function atomically(db: Db, work: (tx: Db) => Promise<void>): Promise<void> {
  if ("$transaction" in db) {
    await db.$transaction(async (tx) => {
      await work(tx);
    });
    return;
  }
  await work(db);
}

export function createDriverRepository(db: Db): DriverRepository {
  return {
    async findById(driverId) {
      const row = await db.driver.findUnique({
        where: { id: driverId },
        select: DRIVER_SELECT,
      });
      return row ? toDriver(row) : null;
    },

    async findByUserId(userId) {
      const row = await db.driver.findUnique({
        where: { userId },
        select: DRIVER_SELECT,
      });
      return row ? toDriver(row) : null;
    },

    async listDispatchableInZone(zoneId) {
      // Le filtrage fin — distance, charge, catégorie — appartient au moteur,
      // qui est pur et testable. La base ne fait que ce qu'elle fait mieux :
      // écarter d'emblée les drivers hors zone, non vérifiés ou hors ligne.
      const rows = await db.driver.findMany({
        where: {
          verification: "APPROVED",
          availability: "ONLINE",
          zones: { some: { zoneId } },
        },
        select: DRIVER_SELECT,
        // Ordre stable : deux tours de dispatch identiques doivent produire le
        // même classement. Le moteur retrie, mais il ne doit pas hériter d'un
        // ordre arbitraire.
        orderBy: { id: "asc" },
      });
      return rows.map(toDriver);
    },

    async setAvailability({ driverId, availability, now }) {
      // Deux écritures indissociables : l'état courant et la période de
      // disponibilité qui se termine. Séparées, un incident laisserait une
      // période ouverte pour toujours et fausserait tout calcul d'activité.
      await atomically(db, async (tx) => {
        await tx.driverAvailabilityLog.updateMany({
          where: { driverId, endedAt: null },
          data: { endedAt: now },
        });

        await tx.driver.update({
          where: { id: driverId },
          data: { availability: availability as never, lastSeenAt: now },
        });

        // Hors ligne n'est pas un état à mesurer : on n'ouvre de période que
        // pour une présence effective.
        if (availability !== "OFFLINE") {
          await tx.driverAvailabilityLog.create({
            data: { driverId, status: availability as never, startedAt: now },
          });
        }
      });
    },
  };
}
