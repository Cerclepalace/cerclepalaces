/**
 * Table des transitions de commande.
 *
 * Une transition n'existe que si elle figure ici, et n'est permise qu'aux
 * acteurs listés. `apps/api` est le seul endroit qui applique ces transitions :
 * aucune app front ne écrit un statut de commande directement.
 */

import type { Actor } from "../roles.js";
import type { OrderStatus } from "./status.js";

export interface OrderTransition {
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  /** Qui a le droit de déclencher cette transition. */
  readonly actors: readonly Actor[];
  /** Ce que la transition signifie, du point de vue opérationnel. */
  readonly reason: string;
}

const MERCHANT: readonly Actor[] = ["merchant_owner", "merchant_staff"];
const PLATFORM: readonly Actor[] = ["admin"];

export const ORDER_TRANSITIONS: readonly OrderTransition[] = [
  // --- Panier et paiement ---
  { from: "CART", to: "PENDING_PAYMENT", actors: ["customer"], reason: "Le client valide son panier et part au paiement." },
  { from: "CART", to: "CANCELLED", actors: ["customer", "system"], reason: "Panier abandonné ou expiré." },
  { from: "PENDING_PAYMENT", to: "PAID", actors: ["system"], reason: "Confirmation d'encaissement reçue du PSP." },
  { from: "PENDING_PAYMENT", to: "PAYMENT_FAILED", actors: ["system"], reason: "Paiement refusé ou expiré." },
  { from: "PENDING_PAYMENT", to: "CANCELLED", actors: ["customer", ...PLATFORM], reason: "Abandon avant encaissement." },
  { from: "PAYMENT_FAILED", to: "PENDING_PAYMENT", actors: ["customer"], reason: "Le client retente le paiement." },
  { from: "PAYMENT_FAILED", to: "CANCELLED", actors: ["customer", "system", ...PLATFORM], reason: "Abandon après échec de paiement." },

  // --- Côté shop ---
  { from: "PAID", to: "ACCEPTED", actors: MERCHANT, reason: "Le shop accepte la commande." },
  { from: "PAID", to: "MERCHANT_REJECTED", actors: [...MERCHANT, "system"], reason: "Refus du shop, ou absence de réponse dans le délai imparti." },
  { from: "PAID", to: "CANCELLED", actors: ["customer", ...PLATFORM], reason: "Annulation avant acceptation." },
  { from: "ACCEPTED", to: "PREPARING", actors: MERCHANT, reason: "Le shop commence la préparation." },
  { from: "ACCEPTED", to: "CANCELLED", actors: PLATFORM, reason: "Annulation par la plateforme après acceptation." },
  { from: "ACCEPTED", to: "INCIDENT", actors: [...MERCHANT, ...PLATFORM], reason: "Problème signalé avant préparation (rupture de stock, erreur de commande)." },
  { from: "PREPARING", to: "READY_FOR_PICKUP", actors: MERCHANT, reason: "Commande prête — déclenche le dispatch." },
  { from: "PREPARING", to: "INCIDENT", actors: [...MERCHANT, ...PLATFORM], reason: "Problème pendant la préparation." },

  // --- Dispatch et livraison ---
  { from: "READY_FOR_PICKUP", to: "DRIVER_ASSIGNED", actors: ["system", ...PLATFORM], reason: "Un coursier a accepté la mission." },
  { from: "READY_FOR_PICKUP", to: "INCIDENT", actors: PLATFORM, reason: "Aucun coursier disponible dans le délai acceptable." },
  { from: "DRIVER_ASSIGNED", to: "PICKED_UP", actors: ["driver"], reason: "Le coursier a récupéré la commande au shop." },
  { from: "DRIVER_ASSIGNED", to: "READY_FOR_PICKUP", actors: ["system", ...PLATFORM], reason: "Coursier désassigné — la mission repart au dispatch." },
  { from: "DRIVER_ASSIGNED", to: "INCIDENT", actors: ["driver", ...PLATFORM], reason: "Incident avant récupération." },
  { from: "PICKED_UP", to: "OUT_FOR_DELIVERY", actors: ["driver"], reason: "Le coursier part vers le client." },
  { from: "PICKED_UP", to: "INCIDENT", actors: ["driver", ...PLATFORM], reason: "Incident après récupération, marchandise en main du coursier." },
  { from: "OUT_FOR_DELIVERY", to: "DELIVERED", actors: ["driver"], reason: "Livraison confirmée (preuve de livraison enregistrée)." },
  { from: "OUT_FOR_DELIVERY", to: "CUSTOMER_UNAVAILABLE", actors: ["driver"], reason: "Client injoignable à l'adresse." },
  { from: "OUT_FOR_DELIVERY", to: "DELIVERY_FAILED", actors: ["driver", ...PLATFORM], reason: "Livraison impossible (adresse invalide, refus, empêchement)." },
  { from: "OUT_FOR_DELIVERY", to: "INCIDENT", actors: ["driver", ...PLATFORM], reason: "Incident pendant la livraison." },

  // --- Reprises après échec ---
  { from: "CUSTOMER_UNAVAILABLE", to: "OUT_FOR_DELIVERY", actors: ["driver"], reason: "Le client rappelle, nouvelle tentative." },
  { from: "CUSTOMER_UNAVAILABLE", to: "DELIVERY_FAILED", actors: ["driver", ...PLATFORM], reason: "Abandon après tentatives infructueuses." },
  { from: "CUSTOMER_UNAVAILABLE", to: "INCIDENT", actors: PLATFORM, reason: "Escalade au support." },
  { from: "DELIVERY_FAILED", to: "INCIDENT", actors: PLATFORM, reason: "Traitement de l'échec par le support (retour shop, remboursement)." },

  // --- Sorties d'incident : le support tranche ---
  { from: "INCIDENT", to: "DELIVERED", actors: PLATFORM, reason: "Incident résolu, la commande a bien été livrée." },
  { from: "INCIDENT", to: "DELIVERY_FAILED", actors: PLATFORM, reason: "Incident clos en échec de livraison." },
  { from: "INCIDENT", to: "CANCELLED", actors: PLATFORM, reason: "Incident clos par annulation de la commande." },
  { from: "INCIDENT", to: "READY_FOR_PICKUP", actors: PLATFORM, reason: "Incident résolu, la commande repart au dispatch." },
];

/** Index `from` → transitions sortantes, construit une fois au chargement. */
const BY_FROM: ReadonlyMap<OrderStatus, readonly OrderTransition[]> = (() => {
  const map = new Map<OrderStatus, OrderTransition[]>();
  for (const transition of ORDER_TRANSITIONS) {
    const list = map.get(transition.from);
    if (list) list.push(transition);
    else map.set(transition.from, [transition]);
  }
  return map;
})();

export function outgoingTransitions(from: OrderStatus): readonly OrderTransition[] {
  return BY_FROM.get(from) ?? [];
}

export function findTransition(from: OrderStatus, to: OrderStatus): OrderTransition | undefined {
  return outgoingTransitions(from).find((transition) => transition.to === to);
}

/** Les cibles qu'un acteur donné peut réellement atteindre depuis l'état courant. */
export function allowedNextStatuses(from: OrderStatus, actor: Actor): readonly OrderStatus[] {
  return outgoingTransitions(from)
    .filter((transition) => transition.actors.includes(actor))
    .map((transition) => transition.to);
}

export type TransitionCheck =
  | { readonly ok: true; readonly transition: OrderTransition }
  | { readonly ok: false; readonly code: "UNKNOWN_TRANSITION" | "ACTOR_NOT_ALLOWED"; readonly message: string };

export function checkTransition(from: OrderStatus, to: OrderStatus, actor: Actor): TransitionCheck {
  const transition = findTransition(from, to);
  if (!transition) {
    return {
      ok: false,
      code: "UNKNOWN_TRANSITION",
      message: `Transition ${from} → ${to} inexistante.`,
    };
  }
  if (!transition.actors.includes(actor)) {
    return {
      ok: false,
      code: "ACTOR_NOT_ALLOWED",
      message: `Le rôle « ${actor} » ne peut pas passer une commande de ${from} à ${to}.`,
    };
  }
  return { ok: true, transition };
}

export class OrderTransitionError extends Error {
  constructor(
    readonly code: "UNKNOWN_TRANSITION" | "ACTOR_NOT_ALLOWED",
    message: string,
  ) {
    super(message);
    this.name = "OrderTransitionError";
  }
}

/**
 * Variante levant une erreur, à utiliser au point d'écriture dans `apps/api`.
 * Le message est destiné aux logs et au back-office, pas au client final.
 */
export function assertTransition(from: OrderStatus, to: OrderStatus, actor: Actor): OrderTransition {
  const result = checkTransition(from, to, actor);
  if (!result.ok) throw new OrderTransitionError(result.code, result.message);
  return result.transition;
}
