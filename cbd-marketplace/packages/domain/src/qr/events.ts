/**
 * Acquisition par QR code.
 *
 * Un QR appartient à une `MerchantLocation` et pointe vers l'URL publique du
 * shop. Chaque étape du parcours écrit un événement rattaché à la session
 * d'acquisition, ce qui permet de mesurer le tunnel scan → commande, aussi bien
 * pour le commerçant (ses propres chiffres) que pour l'admin (toutes zones).
 */

export const QR_STATUSES = ["ACTIVE", "DISABLED"] as const;
export type QrStatus = (typeof QR_STATUSES)[number];

/** Le tunnel, dans l'ordre. L'index sert à calculer les taux de conversion. */
export const ACQUISITION_EVENTS = [
  "qr_scan",
  "shop_view",
  "product_view",
  "add_to_cart",
  "checkout_started",
  "order_completed",
] as const;

export type AcquisitionEvent = (typeof ACQUISITION_EVENTS)[number];

export function funnelStep(event: AcquisitionEvent): number {
  return ACQUISITION_EVENTS.indexOf(event);
}

/**
 * URL publique d'un shop. Le slug est stable et lisible : il est imprimé sur un
 * support physique, donc il ne doit jamais changer une fois le QR distribué.
 */
export function shopUrl(baseUrl: string, slug: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/shop/${slug}`;
}

/**
 * Slug à partir du nom commercial. Le résultat est une proposition : l'admin
 * peut le corriger avant génération du QR, et il devient immuable ensuite.
 */
export function suggestSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export interface FunnelCounts {
  readonly qr_scan: number;
  readonly shop_view: number;
  readonly product_view: number;
  readonly add_to_cart: number;
  readonly checkout_started: number;
  readonly order_completed: number;
}

export interface FunnelRates {
  /** Commandes / scans — le chiffre qui décide si le QR mérite un support physique. */
  readonly scanToOrder: number;
  readonly scanToCart: number;
  readonly cartToOrder: number;
  readonly checkoutToOrder: number;
}

const ratio = (numerator: number, denominator: number): number =>
  denominator > 0 ? numerator / denominator : 0;

export function funnelRates(counts: FunnelCounts): FunnelRates {
  return {
    scanToOrder: ratio(counts.order_completed, counts.qr_scan),
    scanToCart: ratio(counts.add_to_cart, counts.qr_scan),
    cartToOrder: ratio(counts.order_completed, counts.add_to_cart),
    checkoutToOrder: ratio(counts.order_completed, counts.checkout_started),
  };
}
