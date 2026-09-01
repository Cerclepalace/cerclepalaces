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
 * Comment une commande est libérée vers la préparation.
 *
 * Ce mode décrit **la forme du flux**, pas son moyen de paiement. Il répond à
 * une seule question, lisible dans la table des transitions : *qui débloque la
 * commande pour que le shop puisse la préparer ?*
 *
 *  - `EXTERNAL_CONFIRMATION` — la commande est **retenue** jusqu'à ce qu'une
 *    confirmation émise hors plateforme arrive. Elle est portée par l'acteur
 *    `system`, jamais par une requête entrante, et peut être livrée plusieurs
 *    fois — c'est pour ce workflow qu'existe la garde d'idempotence du service.
 *    Le shop ne peut rien faire avant.
 *  - `MERCHANT_DIRECT` — la commande arrive **directement au shop**, qui
 *    l'accepte ou la refuse. Personne hors de la plateforme n'est consulté.
 *
 * Pourquoi ces noms, et pas « payant » et « simulé ». Deux raisons, et elles
 * comptent :
 *
 *   1. Nommer un mode d'après le paiement trancherait ce que ce projet refuse
 *      justement de trancher — qui encaisse, qui est vendeur légal
 *      (docs/TO_VERIFY.md, décisions 05 et 09). Le mode dit qu'une confirmation
 *      extérieure est attendue ; il ne dit pas de qui, ni de quoi. Les états
 *      `PENDING_PAYMENT` et `PAID`, eux, portent cette sémantique, et c'est leur
 *      rôle — pas celui du mode.
 *   2. « Simulé » serait faux. Une commande `MERCHANT_DIRECT` est réelle : le
 *      shop prépare vraiment, un driver livre vraiment, un client reçoit
 *      vraiment. Seule la jambe monétaire est absente. Étiqueter ces lignes
 *      « simulation » en base mentirait sur des données d'exploitation
 *      authentiques, et ce mensonge survivrait à la V1.
 *
 * État réel aujourd'hui : `EXTERNAL_CONFIRMATION` est **déclaré mais
 * inatteignable**. `NoopPaymentProvider` refuse toute opération, donc aucune
 * confirmation ne peut arriver et aucune commande ne peut franchir `PAID`. Le
 * mode existe parce que la machine à états le connaît déjà, pas parce qu'un flux
 * l'emprunte.
 */
export const ORDER_FULFILLMENT_MODES = ["EXTERNAL_CONFIRMATION", "MERCHANT_DIRECT"] as const;

export type OrderFulfillmentMode = (typeof ORDER_FULFILLMENT_MODES)[number];

export const ORDER_FULFILLMENT_MODE_LABEL_FR: Record<OrderFulfillmentMode, string> = {
  EXTERNAL_CONFIRMATION: "En attente d'une confirmation extérieure",
  MERCHANT_DIRECT: "Transmise directement au shop",
};

/** États qui affirment quelque chose sur un paiement. Hors du flux `MERCHANT_DIRECT`. */
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
 * En `MERCHANT_DIRECT`, la réponse est toujours « non » : le flux ne traverse
 * aucun état de paiement, donc rien n'a pu être encaissé. Le paramètre a pour
 * valeur par défaut le mode le plus prudent, pour qu'un appelant qui l'oublie
 * obtienne « oui » plutôt qu'un silence — une question de remboursement posée à
 * tort se voit ; l'inverse, non.
 */
export function requiresRefundDecision(
  from: OrderStatus,
  to: OrderStatus,
  mode: OrderFulfillmentMode = "EXTERNAL_CONFIRMATION",
): boolean {
  if (mode === "MERCHANT_DIRECT") return false;

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
