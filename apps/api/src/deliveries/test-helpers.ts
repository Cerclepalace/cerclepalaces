/**
 * Fabriques partagées par les suites de test de livraison.
 *
 * Extraites pour que les tests de régression, de concurrence et de service
 * décrivent tous la même situation de départ — sinon deux suites divergent
 * lentement et l'une finit par tester autre chose que ce qu'elle annonce.
 */

import {
  DEFAULT_DISPATCH_POLICY,
  type Assignment,
  type DispatchState,
  type DriverCandidate,
} from "@cbd/domain";

import type { DeliverySnapshot } from "./repository.js";

export const T0 = new Date("2026-06-01T18:00:00Z");
export const plus = (seconds: number): Date => new Date(T0.getTime() + seconds * 1000);

/** Le shop de référence du pilote : place de la République, Paris. */
export const PICKUP = { lat: 48.8674, lng: 2.3636 } as const;

export function driver(overrides: Partial<DriverCandidate> = {}): DriverCandidate {
  return {
    driverId: "drv_1",
    verification: "APPROVED",
    availability: "ONLINE",
    zoneIds: ["paris-centre"],
    position: { lat: 48.8687, lng: 2.3653 }, // ~200 m du shop
    activeDeliveries: 0,
    supportedCategories: ["standard"],
    ...overrides,
  };
}

/**
 * Construit l'état de dispatch à partir de la livraison lue et des propositions
 * existantes. Le `roundNumber` est fourni par le test : c'est l'appelant qui
 * sait où en est le cycle, le moteur ne le déduit pas.
 */
export function buildTestState(candidates: readonly DriverCandidate[], roundNumber = 0) {
  return (delivery: DeliverySnapshot, assignments: readonly Assignment[]): DispatchState => ({
    deliveryId: delivery.id,
    deliveryStatus: delivery.status,
    pickup: PICKUP,
    pickupZoneId: delivery.pickupZoneId ?? "paris-centre",
    category: "standard",
    roundNumber,
    candidates,
    assignments,
    policy: DEFAULT_DISPATCH_POLICY,
  });
}
