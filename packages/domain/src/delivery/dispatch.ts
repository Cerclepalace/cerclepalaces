/**
 * Moteur de dispatch V1.
 *
 * Contrat, non négociable : ce module **n'appelle rien**. Pas de base, pas
 * d'API, pas de `Date.now()`, pas de génération d'identifiants, pas de
 * notification. Il reçoit un `DispatchState` complet et une horloge en
 * argument, et retourne une `DispatchDecision`.
 *
 *     même state + même now = même résultat, toujours.
 *
 * C'est ce qui rend le dispatch testable au cas près et rejouable à
 * l'identique quand il faudra comprendre, six mois plus tard, pourquoi une
 * course de mardi soir n'a jamais trouvé preneur.
 *
 * V1 délibérément simple : pas d'IA, pas de scoring opaque, pas de batching.
 * Les candidats sont filtrés par des règles explicites, chacune produisant un
 * motif de rejet nommé, puis triés de façon déterministe. Optimiser sans volume
 * réel reviendrait à optimiser à l'aveugle.
 */

import { alreadyOfferedDriverIds, isPending, type Assignment } from "./assignment.js";
import {
  isDispatchable,
  type DriverAvailability,
  type DriverVerification,
} from "./availability.js";
import type { DeliveryStatus } from "./status.js";

// ---------------------------------------------------------------------------
// Géographie
// ---------------------------------------------------------------------------

export interface GeoPoint {
  readonly lat: number;
  readonly lng: number;
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

// ---------------------------------------------------------------------------
// Motifs — le vocabulaire de l'auditabilité
// ---------------------------------------------------------------------------

/**
 * Chaque décision du moteur porte un motif nommé. C'est ce qui permet de
 * répondre à « pourquoi cette course a-t-elle été proposée à ce driver et pas
 * à celui-ci ? » sans relire le code.
 */
export const DISPATCH_REASONS = [
  "DRIVER_OFFLINE",
  "DRIVER_NOT_APPROVED",
  "OUTSIDE_ZONE",
  "ALREADY_ASSIGNED",
  "ALREADY_OFFERED",
  "POSITION_UNKNOWN",
  "TOO_FAR",
  "CATEGORY_NOT_SUPPORTED",
  "AT_CAPACITY",
  "NOT_SELECTED_THIS_ROUND",
  "OFFER_CREATED",
  "OFFER_EXPIRED",
  "DRIVER_REJECTED",
  "DRIVER_ACCEPTED",
] as const;

export type DispatchReason = (typeof DISPATCH_REASONS)[number];

/** Motifs qui écartent un candidat, par opposition à ceux qui relatent un événement. */
export const EXCLUSION_REASONS: readonly DispatchReason[] = [
  "DRIVER_OFFLINE",
  "DRIVER_NOT_APPROVED",
  "OUTSIDE_ZONE",
  "ALREADY_ASSIGNED",
  "ALREADY_OFFERED",
  "POSITION_UNKNOWN",
  "TOO_FAR",
  "CATEGORY_NOT_SUPPORTED",
  "AT_CAPACITY",
];

// ---------------------------------------------------------------------------
// État d'entrée
// ---------------------------------------------------------------------------

export interface DriverCandidate {
  readonly driverId: string;
  readonly verification: DriverVerification;
  readonly availability: DriverAvailability;
  /** Un driver peut couvrir plusieurs zones — condition d'un réseau partagé. */
  readonly zoneIds: readonly string[];
  /**
   * Dernière position connue, ou `null` si le driver n'en a jamais transmis.
   *
   * Nullable à dessein : sans cela, la couche qui lit la base devrait écarter
   * elle-même les drivers non localisés, et cette exclusion disparaîtrait du
   * journal de dispatch. Un candidat non localisé est écarté ici, avec un motif
   * — `POSITION_UNKNOWN` — comme n'importe quel autre.
   */
  readonly position: GeoPoint | null;
  /** Courses déjà acceptées et non terminées. */
  readonly activeDeliveries: number;
  /** Catégories que ce driver accepte de transporter. */
  readonly supportedCategories: readonly string[];
}

export interface DispatchPolicy {
  /** Durée de validité d'une proposition. Paramètre, jamais une constante enfouie. */
  readonly offerTimeoutSeconds: number;
  /** Au-delà, on ne propose pas la course. */
  readonly maxPickupDistanceMeters: number;
  /** Courses simultanées tolérées par driver. */
  readonly maxConcurrentDeliveries: number;
  /** Propositions ouvertes en parallèle par tour. 1 = strictement séquentiel. */
  readonly parallelOffers: number;
  /** Au-delà, le moteur renonce et rend la course. */
  readonly maxRounds: number;
  /** Vitesse retenue pour estimer un temps d'arrivée, en mètres par seconde. */
  readonly assumedSpeedMps: number;
}

/**
 * Seule catégorie de course modélisée aujourd'hui.
 *
 * Le moteur sait déjà confronter la catégorie d'une course aux catégories
 * acceptées par un driver — c'est ce qui permettra plus tard de distinguer, par
 * exemple, une course nécessitant un contrôle d'âge à la remise. Le schéma ne
 * porte pas encore cette information : tant qu'elle n'existe pas, tout passe par
 * cette valeur unique, nommée plutôt que dispersée en littéraux.
 */
export const DEFAULT_DELIVERY_CATEGORY = "standard";

export const DEFAULT_DISPATCH_POLICY: DispatchPolicy = {
  offerTimeoutSeconds: 30,
  maxPickupDistanceMeters: 5_000,
  maxConcurrentDeliveries: 1,
  parallelOffers: 1,
  maxRounds: 5,
  assumedSpeedMps: 5, // ~18 km/h en ville, à recalibrer sur données réelles
};

export interface DispatchState {
  readonly deliveryId: string;
  readonly deliveryStatus: DeliveryStatus;
  readonly pickup: GeoPoint;
  readonly pickupZoneId: string;
  /** Catégorie de la livraison, confrontée aux catégories acceptées par le driver. */
  readonly category: string;
  readonly roundNumber: number;
  readonly candidates: readonly DriverCandidate[];
  /** Toutes les propositions déjà faites sur cette livraison, tous tours confondus. */
  readonly assignments: readonly Assignment[];
  readonly policy: DispatchPolicy;
}

// ---------------------------------------------------------------------------
// Sélection des candidats
// ---------------------------------------------------------------------------

/**
 * Union discriminée plutôt qu'un booléen : un candidat retenu a forcément une
 * distance, un candidat écarté peut ne pas en avoir. Le typage porte la
 * différence, ce qui évite au reste du moteur de la revérifier.
 */
export type CandidateEvaluation =
  | {
      readonly driverId: string;
      readonly eligible: true;
      readonly reason: null;
      readonly distanceMeters: number;
      readonly estimatedPickupSeconds: number;
    }
  | {
      readonly driverId: string;
      readonly eligible: false;
      readonly reason: DispatchReason;
      /** `null` quand le driver n'est pas localisé : la distance n'existe pas. */
      readonly distanceMeters: number | null;
      readonly estimatedPickupSeconds: number | null;
    };

export interface RankedCandidate {
  readonly driverId: string;
  readonly rank: number;
  readonly distanceMeters: number;
  readonly estimatedPickupSeconds: number;
}

function estimatePickupSeconds(distance: number, policy: DispatchPolicy): number {
  if (policy.assumedSpeedMps <= 0) return 0;
  return Math.round(distance / policy.assumedSpeedMps);
}

/**
 * Évalue **tous** les candidats, retenus comme écartés.
 *
 * Les exclusions sont retournées avec leur motif plutôt que filtrées
 * silencieusement : c'est la matière première du journal de dispatch. L'ordre
 * des tests est significatif — le premier motif qui s'applique est celui qui
 * est enregistré, donc il va du plus structurel (non approuvé) au plus
 * circonstanciel (trop loin).
 */
export function evaluateCandidates(state: DispatchState): readonly CandidateEvaluation[] {
  const alreadyOffered = alreadyOfferedDriverIds(state.assignments);

  return state.candidates.map((candidate): CandidateEvaluation => {
    const position = candidate.position;
    const distance = position === null ? null : distanceMeters(position, state.pickup);
    const estimated = distance === null ? null : estimatePickupSeconds(distance, state.policy);

    const exclude = (reason: DispatchReason): CandidateEvaluation => ({
      driverId: candidate.driverId,
      eligible: false,
      reason,
      distanceMeters: distance,
      estimatedPickupSeconds: estimated,
    });

    if (candidate.verification !== "APPROVED") return exclude("DRIVER_NOT_APPROVED");
    if (!isDispatchable(candidate)) return exclude("DRIVER_OFFLINE");
    if (!candidate.zoneIds.includes(state.pickupZoneId)) return exclude("OUTSIDE_ZONE");
    if (!candidate.supportedCategories.includes(state.category)) {
      return exclude("CATEGORY_NOT_SUPPORTED");
    }
    if (candidate.activeDeliveries >= state.policy.maxConcurrentDeliveries) {
      return exclude("AT_CAPACITY");
    }
    // Un driver déjà sollicité sur cette course ne l'est pas deux fois : sans
    // cette règle, le moteur boucle sur le plus proche indéfiniment.
    if (alreadyOffered.has(candidate.driverId)) return exclude("ALREADY_OFFERED");
    // On ne propose pas une course à quelqu'un dont on ignore où il est : le
    // classement se fait à la distance, et une distance inconnue le fausserait.
    if (distance === null || estimated === null) return exclude("POSITION_UNKNOWN");
    if (distance > state.policy.maxPickupDistanceMeters) return exclude("TOO_FAR");

    return {
      driverId: candidate.driverId,
      eligible: true,
      reason: null,
      distanceMeters: distance,
      estimatedPickupSeconds: estimated,
    };
  });
}

/**
 * Candidats éligibles, ordonnés.
 *
 * Tri : distance, puis charge, puis identifiant. Le dernier critère n'a aucun
 * sens métier — il est là pour que l'ordre soit **total**, donc reproductible.
 * Deux exécutions sur le même état doivent produire exactement la même liste.
 */
export function selectCandidates(state: DispatchState): readonly RankedCandidate[] {
  const byDriverId = new Map(state.candidates.map((candidate) => [candidate.driverId, candidate]));

  return evaluateCandidates(state)
    .filter((evaluation) => evaluation.eligible)
    .sort(
      (a, b) =>
        a.distanceMeters - b.distanceMeters ||
        (byDriverId.get(a.driverId)?.activeDeliveries ?? 0) -
          (byDriverId.get(b.driverId)?.activeDeliveries ?? 0) ||
        a.driverId.localeCompare(b.driverId),
    )
    .map((evaluation, index) => ({
      driverId: evaluation.driverId,
      rank: index + 1,
      distanceMeters: evaluation.distanceMeters,
      estimatedPickupSeconds: evaluation.estimatedPickupSeconds,
    }));
}

// ---------------------------------------------------------------------------
// Décision
// ---------------------------------------------------------------------------

export interface PlannedOffer {
  readonly driverId: string;
  readonly rank: number;
  readonly distanceMeters: number;
  readonly estimatedPickupSeconds: number;
  readonly offeredAt: Date;
  readonly expiresAt: Date;
}

export interface DecisionRecord {
  readonly driverId: string;
  readonly decision: "OFFERED" | "SKIPPED";
  readonly reason: DispatchReason;
  readonly rank: number | null;
  readonly distanceMeters: number | null;
  readonly estimatedPickupSeconds: number | null;
}

export type DispatchDecision =
  /** Des offres sont à créer. */
  | {
      readonly kind: "OFFER";
      readonly deliveryId: string;
      readonly roundNumber: number;
      readonly offers: readonly PlannedOffer[];
      readonly records: readonly DecisionRecord[];
    }
  /** Des offres sont encore valides : ne rien faire, attendre. */
  | { readonly kind: "WAIT"; readonly deliveryId: string; readonly until: Date }
  /** Des offres ont expiré : les acter avant de repasser. */
  | {
      readonly kind: "EXPIRE";
      readonly deliveryId: string;
      readonly assignmentIds: readonly string[];
    }
  /** Plus aucun candidat, ou trop de tours : la course est rendue. */
  | {
      readonly kind: "EXHAUSTED";
      readonly deliveryId: string;
      readonly roundNumber: number;
      readonly records: readonly DecisionRecord[];
    }
  /** La livraison n'est pas dans un état qui appelle du dispatch. */
  | { readonly kind: "IDLE"; readonly deliveryId: string; readonly reason: string };

const DISPATCHABLE_STATUSES: readonly DeliveryStatus[] = [
  "PENDING_DISPATCH",
  "OFFERING",
  "UNASSIGNED",
];

function recordsFor(
  state: DispatchState,
  offered: readonly PlannedOffer[],
): readonly DecisionRecord[] {
  const offeredByDriver = new Map(offered.map((offer) => [offer.driverId, offer]));

  return evaluateCandidates(state).map((evaluation) => {
    const offer = offeredByDriver.get(evaluation.driverId);
    if (offer) {
      return {
        driverId: evaluation.driverId,
        decision: "OFFERED" as const,
        reason: "OFFER_CREATED" as const,
        rank: offer.rank,
        distanceMeters: evaluation.distanceMeters,
        estimatedPickupSeconds: evaluation.estimatedPickupSeconds,
      };
    }
    return {
      driverId: evaluation.driverId,
      decision: "SKIPPED" as const,
      // Un candidat éligible non retenu ce tour-ci l'a été par rang, pas par
      // exclusion : il reste disponible pour le tour suivant.
      reason: evaluation.reason ?? ("NOT_SELECTED_THIS_ROUND" as const),
      rank: null,
      distanceMeters: evaluation.distanceMeters,
      estimatedPickupSeconds: evaluation.estimatedPickupSeconds,
    };
  });
}

/**
 * Construit les propositions du tour courant, sans décider s'il faut les
 * émettre. Exposé séparément pour que l'API puisse prévisualiser un tour.
 */
export function planOffers(state: DispatchState, now: Date): readonly PlannedOffer[] {
  const expiresAt = new Date(now.getTime() + state.policy.offerTimeoutSeconds * 1000);

  return selectCandidates(state)
    .slice(0, Math.max(1, state.policy.parallelOffers))
    .map((candidate) => ({
      driverId: candidate.driverId,
      rank: candidate.rank,
      distanceMeters: candidate.distanceMeters,
      estimatedPickupSeconds: candidate.estimatedPickupSeconds,
      offeredAt: now,
      expiresAt,
    }));
}

/**
 * La décision du moteur pour cet état, à cet instant.
 *
 * Ordre de priorité délibéré : on ne propose jamais une course dont une
 * proposition est encore vivante. Les offres expirées sont d'abord actées,
 * ensuite seulement un nouveau tour s'ouvre.
 */
export function nextOffer(state: DispatchState, now: Date): DispatchDecision {
  if (!DISPATCHABLE_STATUSES.includes(state.deliveryStatus)) {
    return {
      kind: "IDLE",
      deliveryId: state.deliveryId,
      reason: `La livraison est en ${state.deliveryStatus} : rien à dispatcher.`,
    };
  }

  const pending = state.assignments.filter((assignment) => isPending(assignment, now));
  if (pending.length > 0) {
    const until = pending.reduce<Date>(
      (earliest, assignment) =>
        assignment.expiresAt.getTime() < earliest.getTime() ? assignment.expiresAt : earliest,
      pending[0]!.expiresAt,
    );
    return { kind: "WAIT", deliveryId: state.deliveryId, until };
  }

  const newlyExpired = state.assignments.filter(
    (assignment) =>
      assignment.status === "OFFERED" && now.getTime() >= assignment.expiresAt.getTime(),
  );
  if (newlyExpired.length > 0) {
    return {
      kind: "EXPIRE",
      deliveryId: state.deliveryId,
      assignmentIds: newlyExpired.map((assignment) => assignment.id),
    };
  }

  if (state.roundNumber >= state.policy.maxRounds) {
    return {
      kind: "EXHAUSTED",
      deliveryId: state.deliveryId,
      roundNumber: state.roundNumber,
      records: recordsFor(state, []),
    };
  }

  const offers = planOffers(state, now);
  if (offers.length === 0) {
    return {
      kind: "EXHAUSTED",
      deliveryId: state.deliveryId,
      roundNumber: state.roundNumber,
      records: recordsFor(state, []),
    };
  }

  return {
    kind: "OFFER",
    deliveryId: state.deliveryId,
    roundNumber: state.roundNumber + 1,
    offers,
    records: recordsFor(state, offers),
  };
}

/**
 * Vrai quand la course doit repartir en recherche : elle a été rendue et il
 * reste des candidats. Le service s'en sert pour décider d'une transition
 * `UNASSIGNED → OFFERING`.
 */
export function shouldReassign(state: DispatchState, now: Date): boolean {
  if (state.deliveryStatus !== "UNASSIGNED") return false;
  if (state.roundNumber >= state.policy.maxRounds) return false;
  return planOffers(state, now).length > 0;
}
