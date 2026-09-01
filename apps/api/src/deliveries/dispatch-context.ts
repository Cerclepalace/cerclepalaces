/**
 * Ce qu'il faut lire en base avant de faire tourner un tour de dispatch.
 *
 * Le moteur (`nextOffer`) est une fonction pure : il reçoit un état complet et
 * rend une décision. Quelqu'un doit donc construire cet état, et c'est
 * exactement ce que fait ce module — rien de plus. Aucune règle de dispatch ne
 * doit s'y glisser : si une décision se prend ici, elle échappe aux tests purs
 * du domaine et devient invérifiable sans base.
 *
 * Trois choses seulement sont lues :
 *
 *  - **le point de retrait**, qui vient de la boutique où la commande a été
 *    passée, pas de la livraison — une livraison n'a pas de coordonnées propres ;
 *  - **la zone de retrait**, portée par la livraison si elle a été figée, sinon
 *    héritée de la boutique ;
 *  - **le nombre de tours déjà joués**, qui dit au moteur où en est le cycle.
 *
 * La lecture est scopée par tenant comme toutes les autres.
 */

import type { Prisma, PrismaClient } from "@cbd/db";
import type { GeoPoint, TenantScope } from "@cbd/domain";

type Db = PrismaClient | Prisma.TransactionClient;

export type DispatchContext =
  | {
      readonly ok: true;
      readonly pickup: GeoPoint;
      readonly pickupZoneId: string;
      /** Tours déjà joués. Le moteur numérote le suivant lui-même. */
      readonly roundsRun: number;
    }
  | {
      readonly ok: false;
      readonly reason: "DELIVERY_NOT_FOUND" | "NO_PICKUP_ZONE";
    };

export interface DispatchContextReader {
  read(scope: TenantScope, deliveryId: string): Promise<DispatchContext>;
}

export function createDispatchContextReader(db: Db): DispatchContextReader {
  return {
    async read(scope: TenantScope, deliveryId: string): Promise<DispatchContext> {
      const row = await db.delivery.findFirst({
        where: { id: deliveryId, merchantId: scope.merchantId },
        select: {
          pickupZoneId: true,
          order: { select: { location: { select: { lat: true, lng: true, zoneId: true } } } },
          _count: { select: { dispatchRounds: true } },
        },
      });

      if (!row) return { ok: false, reason: "DELIVERY_NOT_FOUND" };

      const location = row.order.location;
      // La zone figée sur la livraison prime : elle a pu être choisie au moment
      // de la commande, et la rattacher plus tard à la zone courante de la
      // boutique réécrirait l'histoire si celle-ci a changé de zone depuis.
      const zoneId = row.pickupZoneId ?? location.zoneId;
      if (zoneId === null) return { ok: false, reason: "NO_PICKUP_ZONE" };

      return {
        ok: true,
        pickup: { lat: location.lat, lng: location.lng },
        pickupZoneId: zoneId,
        roundsRun: row._count.dispatchRounds,
      };
    },
  };
}
