/**
 * Contrôle d'accès.
 *
 * La règle centrale du projet : **le rôle seul n'autorise jamais rien**.
 *
 * « Être commerçant » ne donne pas accès aux commandes d'un autre commerçant.
 * « Être coursier » ne donne pas accès à l'adresse d'un client qu'on ne livre
 * pas. Chaque autorisation croise donc deux questions :
 *
 *   1. Ce rôle a-t-il le droit de faire ce type d'action ?
 *   2. Cette ressource précise lui appartient-elle ?
 *
 * Les failles d'accès en marketplace viennent presque toujours de la seconde,
 * oubliée parce que la première a été vérifiée. Ici, `authorize()` exige les
 * deux : il n'existe pas de chemin qui ne vérifie que le rôle.
 */

import type { Role } from "@cbd/domain";

/** Identité de l'appelant, reconstruite à partir de sa session à chaque requête. */
export interface Principal {
  readonly userId: string;
  readonly roles: readonly Role[];
  /** Merchant auquel il est rattaché, si commerçant. */
  readonly merchantId?: string;
  /** Locations qu'il peut administrer. Vide pour un merchant_owner : tout son Merchant. */
  readonly locationIds?: readonly string[];
  /** Son identifiant coursier, s'il en est un. */
  readonly courierId?: string;
}

/** Ce à quoi l'appelant veut accéder. */
export type Resource =
  | { readonly kind: "own_account"; readonly userId: string }
  | { readonly kind: "order"; readonly customerId: string; readonly locationId: string; readonly assignedCourierId?: string }
  | { readonly kind: "merchant_location"; readonly merchantId: string; readonly locationId: string }
  | { readonly kind: "courier_mission"; readonly courierId: string }
  | { readonly kind: "compliance_document" }
  | { readonly kind: "platform_settings" };

export type Action = "read" | "write" | "transition";

export type Decision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

const DENY = (reason: string): Decision => ({ allowed: false, reason });
const ALLOW: Decision = { allowed: true };

function has(principal: Principal, role: Role): boolean {
  return principal.roles.includes(role);
}

/** Un merchant_owner couvre tout son Merchant ; un merchant_staff, ses locations. */
function coversLocation(principal: Principal, merchantId: string, locationId: string): boolean {
  if (principal.merchantId !== merchantId) return false;
  if (has(principal, "merchant_owner")) return true;
  return principal.locationIds?.includes(locationId) ?? false;
}

/**
 * Décide si `principal` peut effectuer `action` sur `resource`.
 *
 * Aucune valeur par défaut permissive : tout chemin non explicitement autorisé
 * se termine par un refus.
 */
export function authorize(principal: Principal, action: Action, resource: Resource): Decision {
  // L'admin a un accès complet. Le support_agent est délibérément plus étroit :
  // il lit pour traiter des incidents, il ne modifie pas de commandes.
  if (has(principal, "admin")) return ALLOW;

  if (has(principal, "support_agent")) {
    if (action === "read" && resource.kind !== "compliance_document") return ALLOW;
    return DENY("Le support ne peut que consulter, hors documents de conformité.");
  }

  switch (resource.kind) {
    case "own_account":
      return principal.userId === resource.userId
        ? ALLOW
        : DENY("Un compte n'est accessible qu'à son propriétaire.");

    case "order": {
      if (has(principal, "customer") && principal.userId === resource.customerId) {
        // Le client suit sa commande mais n'en pilote pas le statut : les
        // transitions qui lui reviennent passent par des endpoints dédiés.
        return action === "read" ? ALLOW : DENY("Un client ne modifie pas sa commande directement.");
      }
      if (principal.merchantId && coversLocation(principal, principal.merchantId, resource.locationId)) {
        return ALLOW;
      }
      if (principal.courierId && principal.courierId === resource.assignedCourierId) {
        return ALLOW;
      }
      return DENY("Cette commande ne relève pas de cet utilisateur.");
    }

    case "merchant_location":
      if (!principal.merchantId) return DENY("Utilisateur non rattaché à un commerce.");
      if (!coversLocation(principal, resource.merchantId, resource.locationId)) {
        return DENY("Ce point de vente ne relève pas de cet utilisateur.");
      }
      // Un merchant_staff exploite la boutique ; modifier le commerce lui-même
      // (raison sociale, rattachement) reste au propriétaire.
      if (action !== "read" && !has(principal, "merchant_owner") && !has(principal, "merchant_staff")) {
        return DENY("Rôle commerçant requis.");
      }
      return ALLOW;

    case "courier_mission":
      if (!principal.courierId) return DENY("Utilisateur non coursier.");
      return principal.courierId === resource.courierId
        ? ALLOW
        : DENY("Cette mission est assignée à un autre coursier.");

    case "compliance_document":
      // Les documents de conformité ne sortent jamais du back-office plateforme.
      return DENY("Les documents de conformité sont réservés à l'administration.");

    case "platform_settings":
      return DENY("Réservé à l'administration.");
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(reason: string) {
    super(reason);
    this.name = "ForbiddenError";
  }
}

/** Variante levante, à utiliser en entrée de chaque handler. */
export function assertAuthorized(principal: Principal, action: Action, resource: Resource): void {
  const decision = authorize(principal, action, resource);
  if (!decision.allowed) throw new ForbiddenError(decision.reason);
}
