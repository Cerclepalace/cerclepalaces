/**
 * Table des transitions de commande.
 *
 * Une transition n'existe que si elle figure ici, et n'est permise qu'aux
 * acteurs listés. `apps/api` est le seul endroit qui applique ces transitions :
 * aucune app front ne écrit un statut de commande directement.
 */

import type { Actor } from "../roles.js";
import type { OrderFulfillmentMode, OrderStatus } from "./status.js";

export interface OrderTransition {
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  /** Qui a le droit de déclencher cette transition. */
  readonly actors: readonly Actor[];
  /**
   * Modes de traitement où cette transition existe.
   *
   * Absent = les deux. Seules les transitions qui touchent au paiement, et
   * celles qui l'évitent, portent une restriction : c'est ce qui rend un
   * `PAID` inatteignable pour une commande simulée, et un raccourci
   * `CART → ACCEPTED` inatteignable pour une commande payante.
   */
  readonly modes?: readonly OrderFulfillmentMode[];
  /** Ce que la transition signifie, du point de vue opérationnel. */
  readonly reason: string;
}

const MERCHANT: readonly Actor[] = ["merchant_owner", "merchant_staff"];
const PLATFORM: readonly Actor[] = ["admin"];

/** Le flux retenu jusqu'à une confirmation venue de l'extérieur. */
const FLUX_CONFIRMÉ: readonly OrderFulfillmentMode[] = ["EXTERNAL_CONFIRMATION"];
/** Le flux qui va droit au shop. */
const FLUX_DIRECT: readonly OrderFulfillmentMode[] = ["MERCHANT_DIRECT"];

export const ORDER_TRANSITIONS: readonly OrderTransition[] = [
  // --- Panier et paiement ---
  { from: "CART", to: "PENDING_PAYMENT", actors: ["customer"], modes: FLUX_CONFIRMÉ, reason: "Le client valide son panier et part au paiement." },

  // Flux direct : la commande arrive au shop sans passer par aucun état qui
  // affirmerait quoi que ce soit sur un paiement. Le shop décide, exactement
  // comme il décide après une confirmation extérieure.
  { from: "CART", to: "ACCEPTED", actors: MERCHANT, modes: FLUX_DIRECT, reason: "Le shop accepte une commande qui lui est transmise directement." },
  { from: "CART", to: "MERCHANT_REJECTED", actors: [...MERCHANT, "system"], modes: FLUX_DIRECT, reason: "Refus du shop sur une commande transmise directement, ou absence de réponse dans le délai imparti." },
  { from: "CART", to: "CANCELLED", actors: ["customer", "system"], reason: "Panier abandonné ou expiré." },
  { from: "PENDING_PAYMENT", to: "PAID", actors: ["system"], modes: FLUX_CONFIRMÉ, reason: "Confirmation d'encaissement reçue du PSP." },
  { from: "PENDING_PAYMENT", to: "PAYMENT_FAILED", actors: ["system"], modes: FLUX_CONFIRMÉ, reason: "Paiement refusé ou expiré." },
  { from: "PENDING_PAYMENT", to: "CANCELLED", actors: ["customer", ...PLATFORM], modes: FLUX_CONFIRMÉ, reason: "Abandon avant encaissement." },
  { from: "PAYMENT_FAILED", to: "PENDING_PAYMENT", actors: ["customer"], modes: FLUX_CONFIRMÉ, reason: "Le client retente le paiement." },
  { from: "PAYMENT_FAILED", to: "CANCELLED", actors: ["customer", "system", ...PLATFORM], modes: FLUX_CONFIRMÉ, reason: "Abandon après échec de paiement." },

  // --- Côté shop ---
  { from: "PAID", to: "ACCEPTED", actors: MERCHANT, modes: FLUX_CONFIRMÉ, reason: "Le shop accepte la commande." },
  { from: "PAID", to: "MERCHANT_REJECTED", actors: [...MERCHANT, "system"], modes: FLUX_CONFIRMÉ, reason: "Refus du shop, ou absence de réponse dans le délai imparti." },
  { from: "PAID", to: "CANCELLED", actors: ["customer", ...PLATFORM], modes: FLUX_CONFIRMÉ, reason: "Annulation avant acceptation." },
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

/**
 * Mode retenu quand l'appelant n'en donne pas.
 *
 * `EXTERNAL_CONFIRMATION` délibérément, et pas « tous les modes » : un appelant
 * qui oublie le mode se verra refuser le passage direct `CART → ACCEPTED` — un
 * échec visible — plutôt que d'ouvrir sans le savoir un chemin qui contourne la
 * confirmation attendue.
 */
const MODE_PAR_DÉFAUT: OrderFulfillmentMode = "EXTERNAL_CONFIRMATION";

function existsInMode(transition: OrderTransition, mode: OrderFulfillmentMode): boolean {
  return transition.modes === undefined || transition.modes.includes(mode);
}

export function outgoingTransitions(
  from: OrderStatus,
  mode: OrderFulfillmentMode = MODE_PAR_DÉFAUT,
): readonly OrderTransition[] {
  return (BY_FROM.get(from) ?? []).filter((transition) => existsInMode(transition, mode));
}

export function findTransition(
  from: OrderStatus,
  to: OrderStatus,
  mode: OrderFulfillmentMode = MODE_PAR_DÉFAUT,
): OrderTransition | undefined {
  return outgoingTransitions(from, mode).find((transition) => transition.to === to);
}

/** Les cibles qu'un acteur donné peut réellement atteindre depuis l'état courant. */
export function allowedNextStatuses(
  from: OrderStatus,
  actor: Actor,
  mode: OrderFulfillmentMode = MODE_PAR_DÉFAUT,
): readonly OrderStatus[] {
  return outgoingTransitions(from, mode)
    .filter((transition) => transition.actors.includes(actor))
    .map((transition) => transition.to);
}

export type TransitionCheck =
  | { readonly ok: true; readonly transition: OrderTransition }
  | {
      readonly ok: false;
      readonly code: "UNKNOWN_TRANSITION" | "ACTOR_NOT_ALLOWED" | "MODE_NOT_ALLOWED";
      readonly message: string;
    };

export function checkTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: Actor,
  mode: OrderFulfillmentMode = MODE_PAR_DÉFAUT,
): TransitionCheck {
  const transition = findTransition(from, to, mode);

  if (!transition) {
    // Distinguer « n'existe pas » de « n'existe pas dans ce mode » : le second
    // est une erreur de parcours, pas une erreur de saisie, et le message doit
    // le dire — sinon on cherche une transition manquante qui existe.
    const dansUnAutreMode = (BY_FROM.get(from) ?? []).some((candidat) => candidat.to === to);
    if (dansUnAutreMode) {
      return {
        ok: false,
        code: "MODE_NOT_ALLOWED",
        message:
          mode === "MERCHANT_DIRECT"
            ? `Transition ${from} → ${to} indisponible en flux direct : elle suppose une confirmation extérieure.`
            : `Transition ${from} → ${to} réservée au flux direct vers le shop.`,
      };
    }
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
    readonly code: "UNKNOWN_TRANSITION" | "ACTOR_NOT_ALLOWED" | "MODE_NOT_ALLOWED",
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
export function assertTransition(
  from: OrderStatus,
  to: OrderStatus,
  actor: Actor,
  mode: OrderFulfillmentMode = MODE_PAR_DÉFAUT,
): OrderTransition {
  const result = checkTransition(from, to, actor, mode);
  if (!result.ok) throw new OrderTransitionError(result.code, result.message);
  return result.transition;
}

/**
 * Le parcours d'une commande en flux direct, dans l'ordre, tel que la table
 * l'autorise.
 *
 * Calculé depuis `ORDER_TRANSITIONS` plutôt qu'écrit à la main : une liste
 * recopiée diverge de la table dès la première modification, et c'est alors la
 * documentation qui a l'air fausse.
 */
export const MERCHANT_DIRECT_HAPPY_PATH: readonly OrderStatus[] = (() => {
  const chemin: OrderStatus[] = ["CART"];
  const cibles: readonly OrderStatus[] = [
    "ACCEPTED",
    "PREPARING",
    "READY_FOR_PICKUP",
    "DRIVER_ASSIGNED",
    "PICKED_UP",
    "OUT_FOR_DELIVERY",
    "DELIVERED",
  ];
  for (const cible of cibles) {
    const depuis = chemin[chemin.length - 1];
    if (depuis === undefined) break;
    if (findTransition(depuis, cible, "MERCHANT_DIRECT") === undefined) break;
    chemin.push(cible);
  }
  return chemin;
})();
