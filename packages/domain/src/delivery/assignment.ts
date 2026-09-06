/**
 * Propositions de course.
 *
 * Une `DeliveryAssignment` est une **proposition faite à un driver**, pas une
 * affectation. Elle vit sa propre vie : offerte, acceptée, refusée, expirée ou
 * annulée. L'historique complet est conservé, y compris après réassignation —
 * c'est ce qui permet de répondre plus tard à « pourquoi cette course a-t-elle
 * mis vingt minutes à trouver preneur ».
 *
 * Deux règles structurent tout le module :
 *
 *   1. **Une seule proposition ACCEPTED par livraison.** Deux drivers qui
 *      acceptent au même instant : un seul gagne.
 *   2. **Aucune pénalité pour un refus.** Un driver Projet 1 n'est pas exclusif
 *      et travaille peut-être en parallèle sur une autre plateforme. Refuser ou
 *      laisser expirer est un comportement normal, pas une faute.
 *
 * Comme le reste du domaine, ce module est pur : le temps arrive en argument.
 */

export const ASSIGNMENT_STATUSES = [
  "OFFERED",
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const ASSIGNMENT_TERMINAL_STATUSES: readonly AssignmentStatus[] = [
  "ACCEPTED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
];

export function isTerminalAssignmentStatus(status: AssignmentStatus): boolean {
  return ASSIGNMENT_TERMINAL_STATUSES.includes(status);
}

export interface Assignment {
  readonly id: string;
  readonly deliveryId: string;
  readonly driverId: string;
  readonly status: AssignmentStatus;
  readonly rank: number;
  readonly offeredAt: Date;
  readonly expiresAt: Date;
}

/**
 * Une proposition n'expire pas toute seule : elle est *considérée* expirée
 * quand l'horloge dépasse `expiresAt`. La bascule en base est faite par le
 * moteur, jamais par un effet caché ici.
 */
export function isExpired(assignment: Assignment, now: Date): boolean {
  return assignment.status === "OFFERED" && now.getTime() >= assignment.expiresAt.getTime();
}

/** Une proposition encore en attente de réponse à cet instant. */
export function isPending(assignment: Assignment, now: Date): boolean {
  return assignment.status === "OFFERED" && !isExpired(assignment, now);
}

export type AssignmentResponse = "ACCEPTED" | "REJECTED";

export type AssignmentOutcome =
  | { readonly ok: true; readonly status: AssignmentResponse }
  | {
      readonly ok: false;
      readonly code:
        | "ALREADY_RESOLVED"
        | "OFFER_EXPIRED"
        | "DELIVERY_ALREADY_ASSIGNED"
        | "DELIVERY_NOT_OFFERING"
        | "WRONG_DRIVER";
      readonly message: string;
    };

/**
 * Propriété **courante** de la course — pas son historique.
 *
 * La distinction est le cœur de ce module. Une proposition `ACCEPTED` dans
 * l'historique dit « ce driver a accepté à un moment » ; elle ne dit pas « ce
 * driver détient la course maintenant ». Confondre les deux empêchait toute
 * réassignation après un désistement.
 */
export interface CurrentOwnership {
  /** Statut de la livraison. Seul `OFFERING` autorise une acceptation. */
  readonly status: string;
  /** Driver actuellement attaché, ou `null` si la course est libre. */
  readonly assignedDriverId: string | null;
}

export interface RespondInput {
  readonly assignment: Assignment;
  /** Le driver qui répond — comparé à celui de la proposition. */
  readonly respondingDriverId: string;
  readonly response: AssignmentResponse;
  /** État courant de la livraison, seule source de vérité sur la propriété. */
  readonly currentOwnership: CurrentOwnership;
  readonly now: Date;
}

/**
 * Décide de l'issue d'une réponse à une proposition.
 *
 * L'ordre des contrôles est délibéré : on vérifie d'abord l'identité, puis
 * l'état de la proposition, puis l'état de la livraison. Répondre « offre
 * expirée » à un driver dont la course vient d'être prise par un autre serait
 * exact mais trompeur — il doit savoir qu'il a perdu la course, pas qu'il a été
 * trop lent sur *sa* proposition.
 *
 * La décision reste indicative : c'est le verrou optimiste sur `Delivery` qui
 * tranche réellement en cas d'égalité parfaite. Cette fonction évite le travail
 * inutile, elle ne remplace pas la garantie transactionnelle.
 */
export function respondToOffer(input: RespondInput): AssignmentOutcome {
  const { assignment, respondingDriverId, response, currentOwnership, now } = input;

  if (assignment.driverId !== respondingDriverId) {
    return {
      ok: false,
      code: "WRONG_DRIVER",
      message: "Cette proposition a été faite à un autre driver.",
    };
  }

  if (assignment.status !== "OFFERED") {
    return {
      ok: false,
      code: "ALREADY_RESOLVED",
      message: `Cette proposition est déjà ${assignment.status}.`,
    };
  }

  // Un refus reste enregistrable après acceptation d'un tiers ou après
  // expiration : l'information « ce driver ne voulait pas de cette course » a
  // de la valeur pour comprendre le réseau, et ne coûte rien.
  if (response === "REJECTED") {
    return { ok: true, status: "REJECTED" };
  }

  // Course déjà prise : on regarde le driver attaché à la livraison, pas
  // l'historique des propositions.
  if (currentOwnership.assignedDriverId !== null) {
    return {
      ok: false,
      code: "DELIVERY_ALREADY_ASSIGNED",
      message: "Un autre driver a déjà accepté cette course.",
    };
  }

  // Une acceptation n'a de sens que sur une course en recherche. Ce contrôle
  // referme le contournement de la machine d'état : sans lui, une livraison en
  // PENDING_DISPATCH pouvait passer directement en ASSIGNED.
  if (currentOwnership.status !== "OFFERING") {
    return {
      ok: false,
      code: "DELIVERY_NOT_OFFERING",
      message: "Cette course n'est plus en recherche de driver.",
    };
  }

  if (isExpired(assignment, now)) {
    return {
      ok: false,
      code: "OFFER_EXPIRED",
      message: "Cette proposition a expiré.",
    };
  }

  return { ok: true, status: "ACCEPTED" };
}

/**
 * Invariant vérifiable sur un jeu de propositions : au plus une acceptée.
 * Utilisé par les tests et par le repository comme garde après écriture.
 */
export function hasSingleAcceptedAssignment(assignments: readonly Assignment[]): boolean {
  return assignments.filter((assignment) => assignment.status === "ACCEPTED").length <= 1;
}

export function acceptedAssignment(
  assignments: readonly Assignment[],
): Assignment | undefined {
  return assignments.find((assignment) => assignment.status === "ACCEPTED");
}

/** Drivers déjà sollicités sur cette livraison — on ne les redemande pas au tour suivant. */
export function alreadyOfferedDriverIds(
  assignments: readonly Assignment[],
): ReadonlySet<string> {
  return new Set(assignments.map((assignment) => assignment.driverId));
}
