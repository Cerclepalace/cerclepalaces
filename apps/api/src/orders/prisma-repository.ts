/**
 * Implémentation Prisma du dépôt de commande.
 *
 * Mêmes disciplines que pour la livraison : toute clause `where` porte
 * `merchantId`, le verrou optimiste passe par `updateMany` pour qu'un conflit
 * de version soit un `count: 0` plutôt qu'une exception, et un test statique
 * relit ce fichier pour vérifier qu'aucune requête n'a perdu son filtre.
 */

import type { Prisma, PrismaClient } from "@cbd/db";
import type { AdminScope, TenantScope } from "@cbd/domain";

import type {
  AuditEntryInput,
  OrderRepository,
  OrderSnapshot,
  StatusEventInput,
  TransactionalStore,
} from "./service.js";

type Db = PrismaClient | Prisma.TransactionClient;

type OrderRow = {
  id: string;
  merchantId: string;
  status: string;
  fulfillmentMode: string;
  customerId: string;
  locationId: string;
  version: number;
  delivery: { assignedDriverId: string | null } | null;
};

const ORDER_FIELDS = {
  id: true,
  merchantId: true,
  status: true,
  fulfillmentMode: true,
  customerId: true,
  locationId: true,
  version: true,
  // Le driver assigné vit sur la livraison ; le guard en a besoin pour décider
  // si un driver a le droit de voir la commande.
  delivery: { select: { assignedDriverId: true } },
} as const;

function toOrder(row: OrderRow): OrderSnapshot {
  const assignedDriverId = row.delivery?.assignedDriverId;
  return {
    id: row.id,
    merchantId: row.merchantId,
    status: row.status as OrderSnapshot["status"],
    fulfillmentMode: row.fulfillmentMode as OrderSnapshot["fulfillmentMode"],
    customerId: row.customerId,
    locationId: row.locationId,
    version: row.version,
    ...(assignedDriverId ? { assignedDriverId } : {}),
  };
}

export function createOrderRepository(db: Db): OrderRepository {
  return {
    async findById(scope: TenantScope, orderId) {
      const row = await db.order.findFirst({
        where: { id: orderId, merchantId: scope.merchantId },
        select: ORDER_FIELDS,
      });
      return row ? toOrder(row) : null;
    },

    async updateStatus(scope: TenantScope, { orderId, expectedVersion, toStatus }) {
      const result = await db.order.updateMany({
        where: {
          id: orderId,
          merchantId: scope.merchantId,
          version: expectedVersion,
        },
        data: {
          status: toStatus as never,
          version: { increment: 1 },
          ...(toStatus === "DELIVERED" ? { deliveredAt: new Date() } : {}),
        },
      });
      return result.count === 1;
    },

    async appendStatusEvent(scope: TenantScope, input: StatusEventInput) {
      const owned = await db.order.findFirst({
        where: { id: input.orderId, merchantId: scope.merchantId },
        select: { id: true },
      });
      if (!owned) throw new Error("Écriture d'historique hors portée tenant.");

      await db.orderStatusEvent.create({
        data: {
          orderId: input.orderId,
          fromStatus: input.fromStatus as never,
          toStatus: input.toStatus as never,
          actorRole: input.actorRole,
          actorId: input.actorId,
          reason: input.reason,
        },
      });
    },

    async appendAuditEntry(scope: TenantScope, input: AuditEntryInput) {
      // `AuditLog` est transverse : la portée est recopiée dans `metadata`
      // plutôt que dupliquée en colonne sur une table à très fort volume.
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

    async findForAdmin(_scope: AdminScope, orderId) {
      // Seule méthode sans filtre `merchantId`, par conception.
      const row = await db.order.findUnique({
        where: { id: orderId },
        select: ORDER_FIELDS,
      });
      return row ? toOrder(row) : null;
    },
  };
}

export function createOrderStore(prisma: PrismaClient): TransactionalStore {
  return {
    async runInTransaction<T>(work: (repo: OrderRepository) => Promise<T>): Promise<T> {
      return prisma.$transaction(async (tx) => work(createOrderRepository(tx)));
    },
  };
}
