/**
 * Contrat HTTP du réseau de livraison.
 *
 * Ce fichier décrit **ce que l'API expose**, pas comment elle le fait. Aucune
 * règle métier ici : les schémas valident la forme des entrées, les handlers
 * (à venir) se contenteront de construire le `TenantScope`, d'appeler
 * `assertAuthorized`, puis de déléguer au service.
 *
 * Séparer le contrat de l'implémentation permet de construire l'interface
 * driver contre une cible stable avant que le serveur existe — c'était
 * l'objectif de l'étape : le design system viendra après, mais il ne devra pas
 * découvrir l'API en la construisant.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schémas d'entrée
// ---------------------------------------------------------------------------

export const availabilitySchema = z.object({
  availability: z.enum(["OFFLINE", "ONLINE", "PAUSED"]),
});

export const rejectOfferSchema = z.object({
  /** Motif libre, jamais obligatoire : refuser n'a pas à se justifier. */
  reason: z.string().max(280).optional(),
});

export const proofSchema = z.object({
  type: z.enum(["PHOTO", "SIGNATURE", "CODE"]),
  storageKey: z.string().min(1).optional(),
  /** Le code en clair ne transite jamais : l'API reçoit son empreinte. */
  codeHash: z.string().min(1).optional(),
});

export const cancelDeliverySchema = z.object({
  reason: z.string().min(1).max(280),
});

export const dispatchRoundsQuerySchema = z.object({
  deliveryId: z.string().optional(),
  merchantId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ---------------------------------------------------------------------------
// Descriptions des routes
// ---------------------------------------------------------------------------

export type HttpMethod = "GET" | "POST";

export interface RouteContract {
  readonly method: HttpMethod;
  readonly path: string;
  /** Rôles admis. Le rôle ne suffit jamais : l'appartenance est vérifiée ensuite. */
  readonly roles: readonly string[];
  /** Vrai si la route lit ou écrit des données tenantées, donc exige un TenantScope. */
  readonly tenantScoped: boolean;
  readonly summary: string;
}

/**
 * Routes driver.
 *
 * Elles ne sont pas tenantées côté identité — un driver n'appartient à aucun
 * shop — mais toute route qui touche une livraison l'est côté ressource : le
 * `TenantScope` est alors dérivé de la livraison, jamais du driver.
 */
export const DRIVER_ROUTES: readonly RouteContract[] = [
  {
    method: "GET",
    path: "/driver/me",
    roles: ["driver"],
    tenantScoped: false,
    summary: "Profil du driver connecté, vérification et disponibilité courante.",
  },
  {
    method: "POST",
    path: "/driver/availability",
    roles: ["driver"],
    tenantScoped: false,
    summary: "Passer ONLINE, PAUSED ou OFFLINE. Clôt la période précédente et en ouvre une nouvelle.",
  },
  {
    method: "GET",
    path: "/driver/deliveries/offers",
    roles: ["driver"],
    tenantScoped: false,
    summary: "Propositions en cours pour ce driver, avec leur échéance.",
  },
  {
    method: "POST",
    path: "/driver/deliveries/:id/accept",
    roles: ["driver"],
    tenantScoped: true,
    summary: "Accepter une proposition. Le verrou optimiste tranche les acceptations simultanées.",
  },
  {
    method: "POST",
    path: "/driver/deliveries/:id/reject",
    roles: ["driver"],
    tenantScoped: true,
    summary: "Refuser une proposition. Aucune pénalité, aucun effet sur les propositions futures.",
  },
];

/** Routes de livraison, partagées entre shop, driver et administration. */
export const DELIVERY_ROUTES: readonly RouteContract[] = [
  {
    method: "GET",
    path: "/deliveries/:id",
    roles: ["merchant_owner", "merchant_staff", "driver", "support_agent", "admin"],
    tenantScoped: true,
    summary: "Détail d'une livraison. Le driver n'y accède que s'il en est l'assigné.",
  },
  {
    method: "POST",
    path: "/deliveries/:id/dispatch",
    roles: ["merchant_owner", "merchant_staff", "admin"],
    tenantScoped: true,
    summary: "Déclencher un tour de dispatch.",
  },
  {
    method: "POST",
    path: "/deliveries/:id/cancel",
    roles: ["admin"],
    tenantScoped: true,
    summary: "Annuler une livraison.",
  },
  {
    method: "POST",
    path: "/deliveries/:id/pickup",
    roles: ["driver"],
    tenantScoped: true,
    summary: "Confirmer la récupération au shop.",
  },
  {
    method: "POST",
    path: "/deliveries/:id/in-transit",
    roles: ["driver"],
    tenantScoped: true,
    summary: "Signaler le départ vers le client.",
  },
  {
    method: "POST",
    path: "/deliveries/:id/delivered",
    roles: ["driver"],
    tenantScoped: true,
    summary: "Confirmer la livraison, avec sa preuve de remise éventuelle.",
  },
];

/** Routes d'observabilité du dispatch. */
export const ADMIN_ROUTES: readonly RouteContract[] = [
  {
    method: "GET",
    path: "/admin/dispatch/rounds",
    roles: ["admin", "support_agent"],
    tenantScoped: false,
    summary: "Tours de dispatch, tous shops confondus. Passe par findForAdmin.",
  },
  {
    method: "GET",
    path: "/admin/dispatch/decisions",
    roles: ["admin", "support_agent"],
    tenantScoped: false,
    summary: "Décisions individuelles avec leur motif — « pourquoi ce driver et pas celui-là ».",
  },
];

export const ALL_ROUTES: readonly RouteContract[] = [
  ...DRIVER_ROUTES,
  ...DELIVERY_ROUTES,
  ...ADMIN_ROUTES,
];

// ---------------------------------------------------------------------------
// Réponses
// ---------------------------------------------------------------------------

export interface ApiError {
  readonly code: string;
  readonly message: string;
}

/**
 * Correspondance erreur métier → statut HTTP.
 *
 * `TenantMismatchError` renvoie **404 et non 403** : répondre « interdit »
 * confirmerait que la ressource existe, ce qui permettrait d'énumérer les
 * livraisons d'un concurrent.
 */
export const ERROR_STATUS: Readonly<Record<string, number>> = {
  DeliveryNotFoundError: 404,
  OrderNotFoundError: 404,
  TenantMismatchError: 404,
  ForbiddenError: 403,
  DeliveryConflictError: 409,
  OrderConflictError: 409,
  DeliveryTransitionError: 409,
  OrderTransitionError: 409,
  InvalidTenantScopeError: 400,
  WeakPasswordError: 400,
  PaymentNotConfiguredError: 501,
  DeliveryProviderNotConfiguredError: 501,
};

export function statusForError(error: Error): number {
  return ERROR_STATUS[error.name] ?? 500;
}
