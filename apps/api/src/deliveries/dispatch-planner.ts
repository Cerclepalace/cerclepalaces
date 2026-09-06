/**
 * Assemble l'état de dispatch à partir de la base, puis lance le tour.
 *
 * C'est la couture entre le moteur pur et le monde : lire le contexte, lire les
 * candidats, poser l'horloge, appeler le service. Elle n'ajoute aucune règle —
 * tout ce qui décide quelque chose vit dans `@cbd/domain` et se teste sans base.
 *
 * Deux choix méritent d'être vus :
 *
 *  1. **Les candidats sont lus hors transaction, avant elle.** Le tour de
 *     dispatch écrit ; la liste des drivers, elle, est une photographie. La lire
 *     dans la transaction allongerait celle-ci sans rien garantir de plus : un
 *     driver peut se déconnecter entre la lecture et l'écriture de toute façon,
 *     et c'est le verrou optimiste sur la livraison, pas la fraîcheur de cette
 *     liste, qui protège l'invariant.
 *  2. **L'horloge est un paramètre.** Aucun `Date.now()` n'apparaît ici : un
 *     tour de dispatch doit pouvoir être rejoué à l'identique dans un test ou
 *     lors d'une analyse d'incident.
 */

import {
  DEFAULT_DELIVERY_CATEGORY,
  DEFAULT_DISPATCH_POLICY,
  type Assignment,
  type DispatchPolicy,
  type DispatchState,
  type DriverCandidate,
  type TenantScope,
} from "@cbd/domain";

import type { DispatchContextReader } from "./dispatch-context.js";
import type { DeliveryTransactionalStore, DriverRepository } from "./repository.js";
import type { DeliverySnapshot } from "./repository.js";
import { runDispatchRound, type RunDispatchOutcome } from "./service.js";

export interface DispatchDependencies {
  readonly store: DeliveryTransactionalStore;
  readonly drivers: DriverRepository;
  readonly context: DispatchContextReader;
  readonly policy?: DispatchPolicy;
}

export type DispatchAttempt =
  | { readonly kind: "RAN"; readonly outcome: RunDispatchOutcome }
  | {
      readonly kind: "NOT_DISPATCHABLE";
      readonly reason: "DELIVERY_NOT_FOUND" | "NO_PICKUP_ZONE";
    };

const toCandidate = (driver: {
  readonly id: string;
  readonly verification: string;
  readonly availability: string;
  readonly zoneIds: readonly string[];
  readonly position: { readonly lat: number; readonly lng: number } | null;
  readonly activeDeliveries: number;
  readonly supportedCategories: readonly string[];
}): DriverCandidate => ({
  driverId: driver.id,
  verification: driver.verification as DriverCandidate["verification"],
  availability: driver.availability as DriverCandidate["availability"],
  zoneIds: driver.zoneIds,
  position: driver.position,
  activeDeliveries: driver.activeDeliveries,
  supportedCategories: driver.supportedCategories,
});

/**
 * Fait tourner un tour de dispatch sur une livraison, en allant chercher
 * lui-même tout ce dont le moteur a besoin.
 */
export async function dispatchDelivery(
  deps: DispatchDependencies,
  scope: TenantScope,
  input: { readonly deliveryId: string; readonly now: Date },
): Promise<DispatchAttempt> {
  const context = await deps.context.read(scope, input.deliveryId);
  if (!context.ok) {
    return { kind: "NOT_DISPATCHABLE", reason: context.reason };
  }

  const candidats = await deps.drivers.listDispatchableInZone(context.pickupZoneId);
  const candidates = candidats.map(toCandidate);
  const policy = deps.policy ?? DEFAULT_DISPATCH_POLICY;

  const buildState = (
    delivery: DeliverySnapshot,
    assignments: readonly Assignment[],
  ): DispatchState => ({
    deliveryId: delivery.id,
    deliveryStatus: delivery.status,
    pickup: context.pickup,
    pickupZoneId: context.pickupZoneId,
    category: DEFAULT_DELIVERY_CATEGORY,
    roundNumber: context.roundsRun,
    candidates,
    assignments,
    policy,
  });

  const outcome = await runDispatchRound(deps.store, scope, {
    deliveryId: input.deliveryId,
    buildState,
    now: input.now,
  });

  return { kind: "RAN", outcome };
}
