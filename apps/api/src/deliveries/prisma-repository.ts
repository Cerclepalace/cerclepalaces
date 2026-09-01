/**
 * Implémentation Prisma du dépôt de livraison.
 *
 * C'est **ici que l'isolation multi-tenant devient réelle**. Le `TenantScope`
 * nominal empêche d'oublier le paramètre ; il n'empêche pas d'oublier de s'en
 * servir dans la requête. Ce fichier est donc soumis à deux disciplines :
 *
 *  1. **Toute clause `where` porte `merchantId`**, sans exception. Les
 *     ressources qui n'ont pas la colonne (propositions, décisions) sont
 *     atteintes par une jointure filtrée sur la livraison.
 *  2. Un test statique (`prisma-repository.guard.test.ts`) relit ce fichier et
 *     échoue si une requête Prisma manque son filtre. Le typage ne peut pas
 *     l'attraper ; la relecture, si.
 *
 * Le verrou optimiste passe par `updateMany` et non `update` : `update` lève
 * quand rien ne correspond, `updateMany` renvoie `{ count: 0 }`. On veut la
 * seconde sémantique — un conflit de version est un cas nominal, pas une
 * erreur exceptionnelle.
 */

import type { Prisma, PrismaClient } from "@cbd/db";
import type { AdminScope, TenantScope } from "@cbd/domain";

import type {
  AssignmentRecord,
  AuditEntryInput,
  CreateAssignmentInput,
  DeliveryRepository,
  DeliverySnapshot,
  DeliveryStatusEventInput,
  DeliveryTransactionalStore,
  DispatchDecisionInput,
} from "./repository.js";

/** Client ou transaction : les méthodes acceptent les deux. */
type Db = PrismaClient | Prisma.TransactionClient;

type DeliveryRow = {
  id: string;
  merchantId: string;
  orderId: string;
  status: string;
  assignedDriverId: string | null;
  pickupZoneId: string | null;
  dropoffZoneId: string | null;
  version: number;
};

type AssignmentRow = {
  id: string;
  deliveryId: string;
  driverId: string;
  status: string;
  rank: number;
  offeredAt: Date;
  expiresAt: Date;
};

const DELIVERY_FIELDS = {
  id: true,
  merchantId: true,
  orderId: true,
  status: true,
  assignedDriverId: true,
  pickupZoneId: true,
  dropoffZoneId: true,
  version: true,
} as const;

const ASSIGNMENT_FIELDS = {
  id: true,
  deliveryId: true,
  driverId: true,
  status: true,
  rank: true,
  offeredAt: true,
  expiresAt: true,
} as const;

const toDelivery = (row: DeliveryRow): DeliverySnapshot => ({
  id: row.id,
  merchantId: row.merchantId,
  orderId: row.orderId,
  status: row.status as DeliverySnapshot["status"],
  assignedDriverId: row.assignedDriverId,
  pickupZoneId: row.pickupZoneId,
  dropoffZoneId: row.dropoffZoneId,
  version: row.version,
});

const toAssignment = (row: AssignmentRow): AssignmentRecord => ({
  id: row.id,
  deliveryId: row.deliveryId,
  driverId: row.driverId,
  status: row.status as AssignmentRecord["status"],
  rank: row.rank,
  offeredAt: row.offeredAt,
  expiresAt: row.expiresAt,
});

export function createDeliveryRepository(db: Db): DeliveryRepository {
  return {
    async findById(scope: TenantScope, deliveryId) {
      const row = await db.delivery.findFirst({
        where: { id: deliveryId, merchantId: scope.merchantId },
        select: DELIVERY_FIELDS,
      });
      return row ? toDelivery(row) : null;
    },

    async listByStatus(scope: TenantScope, status) {
      const rows = await db.delivery.findMany({
        where: { merchantId: scope.merchantId, status: status as never },
        select: DELIVERY_FIELDS,
        orderBy: { createdAt: "asc" },
      });
      return rows.map(toDelivery);
    },

    async updateStatus(scope: TenantScope, { deliveryId, expectedVersion, toStatus, assignedDriverId }) {
      // Compare-and-set atomique : la condition de version fait partie du
      // `where`, donc PostgreSQL l'évalue sous verrou de ligne. Deux
      // acceptations simultanées ne peuvent pas toutes deux matcher.
      const result = await db.delivery.updateMany({
        where: {
          id: deliveryId,
          merchantId: scope.merchantId,
          version: expectedVersion,
        },
        data: {
          status: toStatus as never,
          version: { increment: 1 },
          ...(assignedDriverId !== undefined ? { assignedDriverId } : {}),
        },
      });
      return result.count === 1;
    },

    async appendStatusEvent(scope: TenantScope, input: DeliveryStatusEventInput) {
      // La livraison est revérifiée dans la portée avant d'écrire son
      // historique : un événement orphelin ou mal attribué est pire qu'absent.
      const owned = await db.delivery.findFirst({
        where: { id: input.deliveryId, merchantId: scope.merchantId },
        select: { id: true },
      });
      if (!owned) throw new Error("Écriture d'historique hors portée tenant.");

      await db.deliveryStatusEvent.create({
        data: {
          deliveryId: input.deliveryId,
          fromStatus: input.fromStatus as never,
          toStatus: input.toStatus as never,
          actorRole: input.actorRole,
          actorId: input.actorId,
          reason: input.reason,
        },
      });
    },

    async listAssignments(scope: TenantScope, deliveryId) {
      // `DeliveryAssignment` ne porte pas `merchantId` : le filtre passe par
      // la relation vers la livraison, qui elle en a un.
      const rows = await db.deliveryAssignment.findMany({
        where: {
          deliveryId,
          delivery: { merchantId: scope.merchantId },
        },
        select: ASSIGNMENT_FIELDS,
        orderBy: { offeredAt: "asc" },
      });
      return rows.map(toAssignment);
    },

    async findAssignmentById(scope: TenantScope, assignmentId) {
      const row = await db.deliveryAssignment.findFirst({
        where: {
          id: assignmentId,
          delivery: { merchantId: scope.merchantId },
        },
        select: ASSIGNMENT_FIELDS,
      });
      return row ? toAssignment(row) : null;
    },

    async createAssignments(scope: TenantScope, inputs: readonly CreateAssignmentInput[]) {
      const created: AssignmentRecord[] = [];

      for (const input of inputs) {
        const owned = await db.delivery.findFirst({
          where: { id: input.deliveryId, merchantId: scope.merchantId },
          select: { id: true },
        });
        if (!owned) throw new Error("Création de proposition hors portée tenant.");

        const row = await db.deliveryAssignment.create({
          data: {
            deliveryId: input.deliveryId,
            driverId: input.driverId,
            rank: input.rank,
            offeredAt: input.offeredAt,
            expiresAt: input.expiresAt,
          },
          select: ASSIGNMENT_FIELDS,
        });
        created.push(toAssignment(row));
      }

      return created;
    },

    async updateAssignmentStatus(scope: TenantScope, { assignmentId, toStatus, respondedAt, rejectionReason }) {
      const result = await db.deliveryAssignment.updateMany({
        where: {
          id: assignmentId,
          delivery: { merchantId: scope.merchantId },
        },
        data: {
          status: toStatus as never,
          ...(respondedAt === undefined ? {} : { respondedAt }),
          ...(toStatus === "ACCEPTED" && respondedAt !== undefined
            ? { acceptedAt: respondedAt }
            : {}),
          ...(toStatus === "REJECTED" && respondedAt !== undefined
            ? { rejectedAt: respondedAt }
            : {}),
          ...(rejectionReason ? { rejectionReason } : {}),
        },
      });
      if (result.count === 0) {
        throw new Error("Proposition introuvable dans cette portée.");
      }
    },

    async recordDispatchRound(scope: TenantScope, input) {
      const owned = await db.delivery.findFirst({
        where: { id: input.deliveryId, merchantId: scope.merchantId },
        select: { id: true },
      });
      if (!owned) throw new Error("Journal de dispatch hors portée tenant.");

      const round = await db.dispatchRound.create({
        data: {
          merchantId: scope.merchantId,
          deliveryId: input.deliveryId,
          roundNumber: input.roundNumber,
          candidateCount: input.decisions.length,
          startedAt: input.startedAt,
        },
        select: { id: true },
      });

      if (input.decisions.length > 0) {
        await db.dispatchDecision.createMany({
          data: input.decisions.map((decision: DispatchDecisionInput) => ({
            roundId: round.id,
            deliveryId: input.deliveryId,
            driverId: decision.driverId,
            decision: decision.decision,
            reason: decision.reason,
            rank: decision.rank,
            distanceMeters: decision.distanceMeters,
            estimatedPickupSeconds: decision.estimatedPickupSeconds,
          })),
        });
      }
    },

    async appendAuditEntry(scope: TenantScope, input: AuditEntryInput) {
      // `AuditLog` est transverse et ne porte pas `merchantId` : la portée est
      // recopiée dans `metadata`, pour que le journal reste filtrable par shop
      // sans dupliquer une colonne sur une table à très fort volume.
      await db.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          actorRole: input.actorRole,
          action: input.action,
          targetType: input.targetType,
          targetId: input.targetId,
          metadata: { ...input.metadata, merchantId: scope.merchantId },
        },
      });
    },

    async findForAdmin(_scope: AdminScope, deliveryId) {
      // Seule méthode de ce fichier sans filtre `merchantId`, par conception.
      // Son nom la rend visible en revue, et son type la rend inatteignable
      // depuis un chemin tenant.
      const row = await db.delivery.findUnique({
        where: { id: deliveryId },
        select: DELIVERY_FIELDS,
      });
      return row ? toDelivery(row) : null;
    },
  };
}

/**
 * Store transactionnel Prisma.
 *
 * `$transaction` garantit ce que le service suppose : statut, événement
 * d'historique et trace d'audit s'appliquent ensemble ou pas du tout.
 */
export function createDeliveryStore(prisma: PrismaClient): DeliveryTransactionalStore {
  return {
    async runInTransaction<T>(work: (repo: DeliveryRepository) => Promise<T>): Promise<T> {
      return prisma.$transaction(async (tx) => work(createDeliveryRepository(tx)));
    },
  };
}
