/**
 * États d'une livraison.
 *
 * Distincte de la machine `OrderStatus` : la commande décrit ce que voit le
 * client, la livraison décrit le travail logistique. Le dispatch a des états
 * que la commande n'a pas besoin de connaître — `OFFERING` et `UNASSIGNED` en
 * particulier, qui n'ont de sens que pour le moteur.
 *
 * Cette fonction est **pure** : aucune horloge, aucune base, aucun effet. Elle
 * répond à une seule question — cette transition est-elle permise à cet acteur.
 * Le « quand » (expiration d'une offre) appartient au moteur de dispatch, le
 * « comment » (écriture) au service.
 */

import type { Actor } from "../roles.js";

export const DELIVERY_STATUSES = [
  "PENDING_DISPATCH",
  "OFFERING",
  "ASSIGNED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
  "FAILED",
  "CANCELLED",
  "UNASSIGNED",
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * États terminaux. `UNASSIGNED` n'en fait pas partie : une course rendue doit
 * pouvoir repartir au dispatch, sinon un désistement de driver condamne la
 * commande.
 */
export const DELIVERY_TERMINAL_STATUSES: readonly DeliveryStatus[] = [
  "DELIVERED",
  "FAILED",
  "CANCELLED",
];

export function isTerminalDeliveryStatus(status: DeliveryStatus): boolean {
  return DELIVERY_TERMINAL_STATUSES.includes(status);
}

export interface DeliveryTransition {
  readonly from: DeliveryStatus;
  readonly to: DeliveryStatus;
  readonly actors: readonly Actor[];
  readonly reason: string;
}

const PLATFORM: readonly Actor[] = ["admin"];

export const DELIVERY_TRANSITIONS: readonly DeliveryTransition[] = [
  // --- Mise au dispatch ---
  { from: "PENDING_DISPATCH", to: "OFFERING", actors: ["system", ...PLATFORM], reason: "La commande est prête : le moteur commence à proposer la course." },
  // Ajout hors spécification initiale, justifié : sans lui, une commande annulée
  // avant le premier tour de dispatch laisserait une livraison bloquée à vie.
  { from: "PENDING_DISPATCH", to: "CANCELLED", actors: ["system", ...PLATFORM], reason: "Commande annulée avant le premier tour de dispatch." },

  // --- Recherche d'un driver ---
  { from: "OFFERING", to: "ASSIGNED", actors: ["driver", "system"], reason: "Un driver a accepté la proposition." },
  { from: "OFFERING", to: "UNASSIGNED", actors: ["system", ...PLATFORM], reason: "Tous les candidats ont refusé ou laissé expirer : plus personne à qui proposer." },
  { from: "OFFERING", to: "CANCELLED", actors: ["system", ...PLATFORM], reason: "Course annulée pendant la recherche." },

  // --- Driver assigné ---
  { from: "ASSIGNED", to: "PICKED_UP", actors: ["driver"], reason: "Le driver a récupéré la commande au shop." },
  // Ajout hors spécification initiale, justifié : un driver peut se désister
  // après avoir accepté (panne, imprévu). Sans cette sortie, la course reste
  // assignée à quelqu'un qui ne viendra pas.
  { from: "ASSIGNED", to: "UNASSIGNED", actors: ["driver", "system", ...PLATFORM], reason: "Le driver rend la course : elle repart au dispatch." },
  { from: "ASSIGNED", to: "CANCELLED", actors: ["system", ...PLATFORM], reason: "Course annulée avant récupération." },
  { from: "ASSIGNED", to: "FAILED", actors: PLATFORM, reason: "Échec constaté avant récupération." },

  // --- En cours ---
  { from: "PICKED_UP", to: "IN_TRANSIT", actors: ["driver"], reason: "Le driver part vers le client." },
  { from: "PICKED_UP", to: "FAILED", actors: ["driver", ...PLATFORM], reason: "Échec après récupération, marchandise en main du driver." },

  { from: "IN_TRANSIT", to: "DELIVERED", actors: ["driver"], reason: "Livraison confirmée." },
  { from: "IN_TRANSIT", to: "FAILED", actors: ["driver", ...PLATFORM], reason: "Livraison impossible." },

  // --- Course rendue ---
  { from: "UNASSIGNED", to: "OFFERING", actors: ["system", ...PLATFORM], reason: "Nouveau tour de dispatch." },
  { from: "UNASSIGNED", to: "CANCELLED", actors: ["system", ...PLATFORM], reason: "Abandon : aucun driver trouvé." },
];

const BY_FROM: ReadonlyMap<DeliveryStatus, readonly DeliveryTransition[]> = (() => {
  const map = new Map<DeliveryStatus, DeliveryTransition[]>();
  for (const transition of DELIVERY_TRANSITIONS) {
    const list = map.get(transition.from);
    if (list) list.push(transition);
    else map.set(transition.from, [transition]);
  }
  return map;
})();

export function outgoingDeliveryTransitions(from: DeliveryStatus): readonly DeliveryTransition[] {
  return BY_FROM.get(from) ?? [];
}

export function findDeliveryTransition(
  from: DeliveryStatus,
  to: DeliveryStatus,
): DeliveryTransition | undefined {
  return outgoingDeliveryTransitions(from).find((transition) => transition.to === to);
}

export function allowedNextDeliveryStatuses(
  from: DeliveryStatus,
  actor: Actor,
): readonly DeliveryStatus[] {
  return outgoingDeliveryTransitions(from)
    .filter((transition) => transition.actors.includes(actor))
    .map((transition) => transition.to);
}

export type DeliveryTransitionCheck =
  | { readonly ok: true; readonly transition: DeliveryTransition }
  | {
      readonly ok: false;
      readonly code: "UNKNOWN_TRANSITION" | "ACTOR_NOT_ALLOWED";
      readonly message: string;
    };

export function checkDeliveryTransition(
  from: DeliveryStatus,
  to: DeliveryStatus,
  actor: Actor,
): DeliveryTransitionCheck {
  const transition = findDeliveryTransition(from, to);
  if (!transition) {
    return {
      ok: false,
      code: "UNKNOWN_TRANSITION",
      message: `Transition de livraison ${from} → ${to} inexistante.`,
    };
  }
  if (!transition.actors.includes(actor)) {
    return {
      ok: false,
      code: "ACTOR_NOT_ALLOWED",
      message: `Le rôle « ${actor} » ne peut pas passer une livraison de ${from} à ${to}.`,
    };
  }
  return { ok: true, transition };
}

export class DeliveryTransitionError extends Error {
  constructor(
    readonly code: "UNKNOWN_TRANSITION" | "ACTOR_NOT_ALLOWED",
    message: string,
  ) {
    super(message);
    this.name = "DeliveryTransitionError";
  }
}

export function assertDeliveryTransition(
  from: DeliveryStatus,
  to: DeliveryStatus,
  actor: Actor,
): DeliveryTransition {
  const result = checkDeliveryTransition(from, to, actor);
  if (!result.ok) throw new DeliveryTransitionError(result.code, result.message);
  return result.transition;
}

/** Libellés destinés au driver. Le client voit les libellés `OrderStatus`. */
export const DELIVERY_STATUS_LABEL_FR: Record<DeliveryStatus, string> = {
  PENDING_DISPATCH: "En attente de dispatch",
  OFFERING: "Recherche d'un coursier",
  ASSIGNED: "Coursier en route vers le shop",
  PICKED_UP: "Commande récupérée",
  IN_TRANSIT: "En cours de livraison",
  DELIVERED: "Livrée",
  FAILED: "Échec de livraison",
  CANCELLED: "Annulée",
  UNASSIGNED: "Sans coursier, à réattribuer",
};
