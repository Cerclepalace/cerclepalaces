/**
 * Rôles et acteurs de la plateforme.
 *
 * Un `Role` est ce que porte un compte utilisateur (persisté en base).
 * Un `Actor` est ce qui déclenche une transition d'état : les rôles applicatifs
 * plus `system`, réservé aux transitions automatiques (webhook de paiement,
 * dispatch, expiration d'un délai). Aucune requête entrante ne peut se présenter
 * comme `system` — cet acteur n'existe que côté serveur.
 */

export const ROLES = [
  "customer",
  "merchant_owner",
  "merchant_staff",
  "courier",
  "support_agent",
  "admin",
] as const;

export type Role = (typeof ROLES)[number];

export const ACTORS = [...ROLES, "system"] as const;

export type Actor = (typeof ACTORS)[number];

/** Les deux rôles commerçant, regroupés là où la distinction n'importe pas. */
export const MERCHANT_ROLES: readonly Role[] = ["merchant_owner", "merchant_staff"];

/** Les deux rôles plateforme. `support_agent` est un `admin` volontairement bridé. */
export const PLATFORM_ROLES: readonly Role[] = ["admin", "support_agent"];

export function isMerchantRole(role: Role): boolean {
  return MERCHANT_ROLES.includes(role);
}

export function isPlatformRole(role: Role): boolean {
  return PLATFORM_ROLES.includes(role);
}

/**
 * Portée d'un rôle : au-delà du rôle lui-même, presque chaque endpoint doit
 * aussi vérifier l'appartenance de la ressource (un `merchant_staff` n'agit que
 * sur la `MerchantLocation` à laquelle il est rattaché, un `courier` que sur ses
 * propres missions). Le rôle seul n'autorise jamais rien.
 */
export const ROLE_SCOPE: Record<Role, string> = {
  customer: "Ses propres paniers, commandes, adresses et tickets de support.",
  merchant_owner: "Toutes les MerchantLocation de son Merchant, son staff, son catalogue et ses statistiques.",
  merchant_staff: "La ou les MerchantLocation auxquelles il est rattaché : commandes, préparation, stock.",
  courier: "Ses missions assignées, sa disponibilité, ses gains.",
  support_agent: "Lecture large sur commandes/livraisons, actions limitées aux incidents et tickets.",
  admin: "Accès complet au back-office plateforme.",
};
