/**
 * Répartition financière d'une commande.
 *
 * ⚠️ Le modèle économique n'est PAS arrêté (docs/TO_VERIFY.md, décisions 04 à 09).
 * Ce module ne choisit rien : il exprime la répartition en parts nommées et
 * accepte plusieurs configurations, pour qu'un changement de modèle soit un
 * changement de configuration et non une réécriture.
 *
 * Tous les montants sont en **centimes**, entiers. Aucun flottant ne circule :
 * `0.1 + 0.2 !== 0.3` n'est pas une abstraction quand il s'agit de reverser de
 * l'argent à un commerçant.
 */

/** Modèles de revenus envisagés. Aucun n'est retenu à ce stade. */
export const REVENUE_MODELS = [
  "commission_only",
  "delivery_fee_only",
  "commission_and_delivery",
  "subscription_only",
  "hybrid",
] as const;

export type RevenueModel = (typeof REVENUE_MODELS)[number];

export interface RevenueConfig {
  readonly model: RevenueModel;
  /** Commission plateforme sur le sous-total produits, en points de base (1 % = 100). */
  readonly commissionBps: number;
  /** Part fixe éventuelle prélevée par commande, en centimes. */
  readonly platformFixedFeeCents: number;
  /**
   * Rémunération du coursier. Le modèle exact dépend de son statut juridique,
   * non tranché — d'où une valeur configurable et non une formule figée.
   */
  readonly courierPayoutCents: number;
  /** Frais de livraison facturés au client, en centimes. */
  readonly deliveryFeeCents: number;
}

export interface PspFees {
  /** Part variable du PSP, en points de base du montant encaissé. */
  readonly variableBps: number;
  /** Part fixe du PSP par transaction, en centimes. */
  readonly fixedCents: number;
}

export interface OrderLine {
  readonly unitPriceCents: number;
  readonly quantity: number;
}

export interface OrderBreakdown {
  /** Somme des lignes produits. */
  readonly productsSubtotalCents: number;
  /** Frais de livraison facturés au client. */
  readonly deliveryFeeCents: number;
  /** Ce que le client paie réellement. */
  readonly customerTotalCents: number;
  /** Reversé au shop. */
  readonly merchantPayoutCents: number;
  /** Reversé au coursier. */
  readonly courierPayoutCents: number;
  /** Prélevé par le PSP. */
  readonly pspFeeCents: number;
  /** Ce qui reste réellement à la plateforme, une fois tout le monde payé. */
  readonly platformNetCents: number;
}

const bps = (amountCents: number, rateBps: number): number =>
  Math.round((amountCents * rateBps) / 10_000);

export function productsSubtotal(lines: readonly OrderLine[]): number {
  return lines.reduce((total, line) => total + line.unitPriceCents * line.quantity, 0);
}

/**
 * Calcule la répartition d'une commande.
 *
 * La marge plateforme est un **reste**, pas une entrée : elle se déduit une fois
 * le shop, le coursier et le PSP payés. C'est le seul calcul qui dise la vérité
 * sur la rentabilité réelle — et il peut être négatif, ce qui est précisément
 * l'information qu'on veut voir pendant le pilote plutôt que de la masquer.
 */
export function computeBreakdown(input: {
  readonly lines: readonly OrderLine[];
  readonly revenue: RevenueConfig;
  readonly psp: PspFees;
}): OrderBreakdown {
  const { lines, revenue, psp } = input;

  const productsSubtotalCents = productsSubtotal(lines);
  const deliveryFeeCents = revenue.deliveryFeeCents;
  const customerTotalCents = productsSubtotalCents + deliveryFeeCents;

  const commissionCents =
    bps(productsSubtotalCents, revenue.commissionBps) + revenue.platformFixedFeeCents;

  const merchantPayoutCents = productsSubtotalCents - commissionCents;
  const courierPayoutCents = revenue.courierPayoutCents;
  const pspFeeCents = bps(customerTotalCents, psp.variableBps) + psp.fixedCents;

  const platformNetCents =
    customerTotalCents - merchantPayoutCents - courierPayoutCents - pspFeeCents;

  return {
    productsSubtotalCents,
    deliveryFeeCents,
    customerTotalCents,
    merchantPayoutCents,
    courierPayoutCents,
    pspFeeCents,
    platformNetCents,
  };
}

/**
 * Garde-fou : la somme des parts doit égaler exactement ce que paie le client.
 * À appeler dans les tests et avant tout versement — un écart d'un centime ici
 * est un bug comptable, pas un arrondi acceptable.
 */
export function breakdownBalances(breakdown: OrderBreakdown): boolean {
  const distributed =
    breakdown.merchantPayoutCents +
    breakdown.courierPayoutCents +
    breakdown.pspFeeCents +
    breakdown.platformNetCents;
  return distributed === breakdown.customerTotalCents;
}

export function formatCents(cents: number, currency = "EUR", locale = "fr-FR"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}
