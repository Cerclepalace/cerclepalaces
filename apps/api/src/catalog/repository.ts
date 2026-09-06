/**
 * Lecture d'un candidat à la mise en vente.
 *
 * Le portail `evaluateListing` est une fonction pure : il reçoit un état complet
 * et rend un verdict. Quelqu'un doit assembler cet état depuis la base, et
 * c'est le seul rôle de ce contrat.
 *
 * Ce chaînon manquait. La taxonomie fermée existait dans le domaine et dans
 * PostgreSQL, sans qu'aucun code ne relie les deux : un audit a montré que
 * `ProductCategory`, `delta9ThcPercent`, `legalForm` et les autres champs
 * n'étaient lus par aucun adaptateur. Une migration réussie ne prouve rien tant
 * que personne ne traverse le pont.
 *
 * La lecture est **scopée par tenant**, comme toutes les autres : un shop ne
 * peut pas évaluer le produit d'un autre.
 */

import type { ListingCandidate, TenantScope } from "@cbd/domain";

export interface ListingCandidateKey {
  /** Le produit évalué. */
  readonly productId: string;
  /** La boutique où il serait vendu — le stock et le prix en dépendent. */
  readonly locationId: string;
}

export type ListingCandidateLookup =
  | { readonly found: true; readonly candidate: ListingCandidate }
  | {
      readonly found: false;
      readonly reason:
        /** Produit inconnu, ou relevant d'un autre tenant. */
        | "PRODUCT_NOT_FOUND"
        /** Le shop n'a jamais référencé ce produit dans cette boutique. */
        | "NOT_IN_INVENTORY"
        /** Aucun dossier de conformité n'a été ouvert. */
        | "NO_COMPLIANCE_RECORD";
    };

export interface ListingCandidateRepository {
  /**
   * Assemble l'état d'un produit chez un shop.
   *
   * Rend un motif d'absence plutôt qu'un `null` : « produit inconnu »,
   * « jamais référencé » et « aucun dossier » se corrigent différemment, et un
   * `null` unique obligerait l'appelant à redemander pour savoir lequel.
   */
  findCandidate(
    scope: TenantScope,
    key: ListingCandidateKey,
  ): Promise<ListingCandidateLookup>;
}
