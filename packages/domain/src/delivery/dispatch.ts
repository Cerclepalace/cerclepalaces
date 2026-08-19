/**
 * Dispatch v1 — volontairement simple et lisible.
 *
 * À `READY_FOR_PICKUP`, la mission est proposée aux coursiers disponibles de la
 * zone, classés par distance au shop puis par charge courante ; le premier qui
 * accepte est assigné. Pas d'optimisation multi-commandes au lancement.
 *
 * L'architecture (zone, disponibilité, charge, temps estimé) laisse la place à
 * un algorithme plus fin plus tard sans refondre le modèle de données — mais
 * construire cet algorithme maintenant, sans volume réel, reviendrait à
 * optimiser à l'aveugle.
 */

export const COURIER_AVAILABILITY = ["OFFLINE", "AVAILABLE", "ON_MISSION"] as const;
export type CourierAvailability = (typeof COURIER_AVAILABILITY)[number];

export const COURIER_VERIFICATION = [
  "APPLICATION_SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
] as const;
export type CourierVerification = (typeof COURIER_VERIFICATION)[number];

export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
}

export interface DispatchCandidate {
  readonly courierId: string;
  readonly verification: CourierVerification;
  readonly availability: CourierAvailability;
  readonly zoneId: string;
  readonly position: GeoPoint;
  /** Missions déjà en cours pour ce coursier. */
  readonly activeMissions: number;
}

export interface DispatchRequest {
  readonly pickup: GeoPoint;
  readonly zoneId: string;
  /** Au-delà, on ne propose pas la mission (en mètres). */
  readonly maxPickupDistanceMeters: number;
  /** Nombre maximum de missions simultanées par coursier. */
  readonly maxConcurrentMissions: number;
}

export interface RankedCandidate {
  readonly courierId: string;
  readonly distanceMeters: number;
  readonly activeMissions: number;
}

const EARTH_RADIUS_METERS = 6_371_000;
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Distance à vol d'oiseau (haversine). Suffisant pour classer des candidats sur
 * une zone urbaine restreinte ; à remplacer par une distance routière si le
 * classement s'avère trompeur en conditions réelles.
 */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return Math.round(2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h)));
}

/** Un coursier non approuvé n'est jamais éligible, quelle que soit sa position. */
export function isEligible(candidate: DispatchCandidate, request: DispatchRequest): boolean {
  if (candidate.verification !== "APPROVED") return false;
  if (candidate.availability !== "AVAILABLE") return false;
  if (candidate.zoneId !== request.zoneId) return false;
  if (candidate.activeMissions >= request.maxConcurrentMissions) return false;
  return distanceMeters(candidate.position, request.pickup) <= request.maxPickupDistanceMeters;
}

/**
 * Ordonne les coursiers à qui proposer la mission : plus proche d'abord, puis
 * le moins chargé. L'appelant propose la mission dans cet ordre ; le premier à
 * accepter déclenche `READY_FOR_PICKUP → COURIER_ASSIGNED`.
 */
export function rankCandidates(
  candidates: readonly DispatchCandidate[],
  request: DispatchRequest,
): readonly RankedCandidate[] {
  return candidates
    .filter((candidate) => isEligible(candidate, request))
    .map((candidate) => ({
      courierId: candidate.courierId,
      distanceMeters: distanceMeters(candidate.position, request.pickup),
      activeMissions: candidate.activeMissions,
    }))
    .sort(
      (a, b) =>
        a.distanceMeters - b.distanceMeters ||
        a.activeMissions - b.activeMissions ||
        a.courierId.localeCompare(b.courierId),
    );
}
