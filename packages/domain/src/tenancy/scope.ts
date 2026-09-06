/**
 * Portée tenant.
 *
 * La frontière de multi-tenancy V1 est le **repository**, pas la base : pas de
 * Row-Level Security, pas de rôle PostgreSQL par tenant, pas de variable de
 * session. Cette décision suppose donc que l'oubli du scope soit rendu
 * difficile — sinon « repository scopé » n'est qu'une convention documentaire,
 * et une convention documentaire finit toujours par être oubliée un vendredi
 * soir.
 *
 * D'où trois choix délibérés :
 *
 *  1. `TenantScope` est un type **nominal**, pas un simple `{ merchantId }`. On
 *     ne peut pas le fabriquer en passant un objet littéral au hasard : il faut
 *     appeler `tenantScope()`. Une chaîne d'identifiant ne peut donc pas se
 *     glisser à la place d'un scope.
 *
 *  2. Le scope est toujours le **premier paramètre**, jamais optionnel, jamais
 *     avec valeur par défaut. `findById(scope, id)` et non `findById(id, scope?)`.
 *
 *  3. L'accès inter-tenant existe mais porte un nom qui se voit en revue de
 *     code : `AdminScope`, obtenu par `adminScope()`. Aucun rôle ne contourne
 *     implicitement le scope — un admin doit demander explicitement une méthode
 *     `findForAdmin*`.
 */

declare const tenantBrand: unique symbol;

export interface TenantScope {
  readonly merchantId: string;
  /** Marqueur de type. N'existe qu'à la compilation, jamais à l'exécution. */
  readonly [tenantBrand]: true;
}

export class InvalidTenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTenantScopeError";
  }
}

/**
 * Seule fabrique d'un `TenantScope`.
 *
 * Le `merchantId` vient de la session authentifiée, jamais d'un paramètre de
 * requête : laisser un client choisir son tenant reviendrait à ne pas en avoir.
 */
export function tenantScope(merchantId: string): TenantScope {
  if (typeof merchantId !== "string" || merchantId.trim().length === 0) {
    throw new InvalidTenantScopeError("Un TenantScope exige un merchantId non vide.");
  }
  return { merchantId } as TenantScope;
}

declare const adminBrand: unique symbol;

/**
 * Portée inter-tenant, réservée au back-office plateforme.
 *
 * Elle n'est acceptée que par des méthodes explicitement nommées
 * (`findForAdmin`, `listAllForAdmin`…). Aucune méthode tenantée ne l'accepte en
 * remplacement d'un `TenantScope` : le typage l'interdit, et c'est voulu — un
 * bypass implicite serait indétectable en revue.
 */
export interface AdminScope {
  readonly actorUserId: string;
  readonly [adminBrand]: true;
}

export function adminScope(actorUserId: string): AdminScope {
  if (typeof actorUserId !== "string" || actorUserId.trim().length === 0) {
    throw new InvalidTenantScopeError("Un AdminScope exige l'identifiant de l'administrateur.");
  }
  return { actorUserId } as AdminScope;
}

/**
 * Vérifie qu'une ressource lue appartient bien au tenant demandé.
 *
 * Ceinture et bretelles : le `where` du repository filtre déjà. Cette garde
 * attrape le cas où quelqu'un ajoute une méthode sans filtre — la ressource
 * remonte, mais l'appelant reçoit une erreur plutôt que les données d'un autre
 * shop.
 */
export class TenantMismatchError extends Error {
  readonly status = 404;
  constructor(
    readonly expectedMerchantId: string,
    readonly actualMerchantId: string,
  ) {
    // Message volontairement muet sur le tenant réel : révéler « cette
    // ressource appartient au merchant X » est déjà une fuite.
    super("Ressource introuvable dans cette portée.");
    this.name = "TenantMismatchError";
  }
}

export function assertBelongsToTenant(
  scope: TenantScope,
  resource: { readonly merchantId: string },
): void {
  if (resource.merchantId !== scope.merchantId) {
    throw new TenantMismatchError(scope.merchantId, resource.merchantId);
  }
}

/**
 * Filtre à injecter dans une requête Prisma. Rend le scope inévitable même
 * quand on construit un `where` à la main.
 */
export function tenantFilter(scope: TenantScope): { readonly merchantId: string } {
  return { merchantId: scope.merchantId };
}
