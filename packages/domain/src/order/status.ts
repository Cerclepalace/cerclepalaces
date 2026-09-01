/**
 * États d'une commande.
 *
 * Le chemin nominal est linéaire ; les états d'échec sont atteignables depuis
 * plusieurs étapes. Les transitions autorisées vivent dans `transitions.ts` et
 * sont appliquées côté serveur uniquement.
 */

/** Chemin nominal, dans l'ordre. */
export const ORDER_HAPPY_PATH = [
  "CART",
  "PENDING_PAYMENT",
  "PAID",
  "ACCEPTED",
  "PREPARING",
  "READY_FOR_PICKUP",
  "DRIVER_ASSIGNED",
  "PICKED_UP",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
] as const;

/** États d'échec ou d'exception. */
export const ORDER_EXCEPTION_STATES = [
  "CANCELLED",
  "PAYMENT_FAILED",
  "MERCHANT_REJECTED",
  "DELIVERY_FAILED",
  "CUSTOMER_UNAVAILABLE",
  "INCIDENT",
] as const;

export const ORDER_STATUSES = [...ORDER_HAPPY_PATH, ...ORDER_EXCEPTION_STATES] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * États terminaux : plus aucune transition n'en sort.
 *
 * `DELIVERY_FAILED` et `CUSTOMER_UNAVAILABLE` n'en font délibérément pas partie —
 * une livraison ratée doit pouvoir être reprise ou basculée en incident, sinon
 * la commande reste bloquée sans recours pour le support.
 */
export const ORDER_TERMINAL_STATUSES: readonly OrderStatus[] = [
  "DELIVERED",
  "CANCELLED",
  "MERCHANT_REJECTED",
];

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return ORDER_TERMINAL_STATUSES.includes(status);
}

/**
 * Comment une commande passe du panier à la préparation.
 *
 * Deux chemins, mutuellement exclusifs :
 *
 *  - `PAYMENT_REQUIRED` — le chemin définitif : le client paie, la confirmation
 *    d'encaissement fait avancer la commande. **Aucun encaissement n'est
 *    implémenté à ce jour** ; `NoopPaymentProvider` refuse toute opération, donc
 *    aucune commande ne peut atteindre `PAID` aujourd'hui.
 *  - `SIMULATED` — le parcours du pilote, sans argent : la commande passe du
 *    panier directement à l'acceptation par le shop.
 *
 * Pourquoi un mode plutôt qu'un raccourci. `PENDING_PAYMENT` et `PAID` affirment
 * quelque chose sur de l'argent. Faire passer une commande non payée par ces
 * états produirait une base qui ment : des commandes marquées « paiement
 * confirmé » sans qu'un euro ait bougé, indiscernables des vraies le jour où il
 * y en aura. Le mode rend cette confusion **structurellement impossible** —
 * `PAID` n'est pas atteignable en `SIMULATED`, et l'inverse est vrai aussi.
 *
 * Ce n'est pas un contournement du blocage transactionnel, c'est sa forme
 * lisible : il n'y a toujours ni PSP, ni encaissement, ni versement.
 */
export const ORDER_FULFILMENT_MODES = ["PAYMENT_REQUIRED", "SIMULATED"] as const;

export type OrderFulfilmentMode = (typeof ORDER_FULFILMENT_MODES)[number];

/** États qui affirment quelque chose sur un paiement. Interdits en `SIMULATED`. */
export const ORDER_PAYMENT_STATES: readonly OrderStatus[] = [
  "PENDING_PAYMENT",
  "PAID",
  "PAYMENT_FAILED",
];

export function isPaymentState(status: OrderStatus): boolean {
  return ORDER_PAYMENT_STATES.includes(status);
}

/**
 * À partir de `PAID`, un encaissement a eu lieu : toute sortie du chemin nominal
 * ouvre une question de remboursement. Le traitement exact dépend du modèle de
 * vente retenu (voir docs/TO_VERIFY.md, décisions 05 et 07).
 *
 * En mode `SIMULATED`, la réponse est toujours « non » : rien n'a été encaissé,
 * il n'y a rien à rembourser. Le paramètre a pour valeur par défaut le mode le
 * plus prudent, pour qu'un appelant qui l'oublie obtienne « oui » plutôt qu'un
 * silence — une question de remboursement posée à tort se voit ; l'inverse, non.
 */
export function requiresRefundDecision(
  from: OrderStatus,
  to: OrderStatus,
  mode: OrderFulfilmentMode = "PAYMENT_REQUIRED",
): boolean {
  if (mode === "SIMULATED") return false;

  const paidStates: readonly OrderStatus[] = [
    "PAID",
    "ACCEPTED",
    "PREPARING",
    "READY_FOR_PICKUP",
    "DRIVER_ASSIGNED",
    "PICKED_UP",
    "OUT_FOR_DELIVERY",
    "CUSTOMER_UNAVAILABLE",
    "INCIDENT",
  ];
  const failureStates: readonly OrderStatus[] = [
    "CANCELLED",
    "MERCHANT_REJECTED",
    "DELIVERY_FAILED",
  ];
  return paidStates.includes(from) && failureStates.includes(to);
}

/** Libellés destinés au client. Le shop et le coursier ont leurs propres vues. */
export const ORDER_STATUS_LABEL_FR: Record<OrderStatus, string> = {
  CART: "Panier",
  PENDING_PAYMENT: "En attente de paiement",
  PAID: "Paiement confirmé",
  ACCEPTED: "Acceptée par le shop",
  PREPARING: "En préparation",
  READY_FOR_PICKUP: "Prête, en attente d'un coursier",
  DRIVER_ASSIGNED: "Coursier en route vers le shop",
  PICKED_UP: "Commande récupérée",
  OUT_FOR_DELIVERY: "En cours de livraison",
  DELIVERED: "Livrée",
  CANCELLED: "Annulée",
  PAYMENT_FAILED: "Paiement refusé",
  MERCHANT_REJECTED: "Refusée par le shop",
  DELIVERY_FAILED: "Livraison impossible",
  CUSTOMER_UNAVAILABLE: "Client injoignable",
  INCIDENT: "Incident en cours de traitement",
};
