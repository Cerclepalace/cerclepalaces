/**
 * Rémunération d'une course.
 *
 * Fonction pure, décomposée poste par poste. Deux raisons de ne jamais coder
 * « 5 € par course » quelque part :
 *
 *  1. Le statut juridique du driver n'est pas arrêté (docs/TO_VERIFY.md,
 *     décision 01). Selon la réponse, la rémunération n'a pas la même nature
 *     et probablement pas la même formule.
 *  2. Un montant forfaitaire cache le vrai problème économique. Une course de
 *     500 m et une course de 4 km n'ont pas le même coût ; les confondre fait
 *     disparaître la marge sans qu'on voie où.
 *
 * `calculationVersion` est enregistrée avec chaque payout : faire évoluer la
 * formule n'invalide pas l'historique, un versement ancien reste explicable
 * avec les règles de son époque.
 *
 * **Aucun versement réel n'est effectué ici.** Ce module calcule, il ne paie pas.
 */

/**
 * Version de la formule. À incrémenter à chaque changement de règle de calcul,
 * jamais à chaque changement de tarif — les tarifs sont des entrées.
 */
export const PAYOUT_CALCULATION_VERSION = 1;

export interface PayoutRates {
  /** Part fixe par course, en centimes. */
  readonly baseFeeCents: number;
  /** Tarif au kilomètre, en centimes. */
  readonly distanceRateCentsPerKm: number;
  /** Tarif de l'attente au shop, en centimes par minute. */
  readonly waitingRateCentsPerMinute: number;
  /**
   * Plancher garanti par course, en centimes. Mis à 0 par défaut : imposer un
   * minimum est une décision économique et sociale, pas un défaut technique.
   */
  readonly minimumPayoutCents: number;
}

export interface PayoutInput {
  readonly rates: PayoutRates;
  readonly distanceMeters: number;
  readonly waitingSeconds: number;
  /** Prime ponctuelle : intempéries, heure creuse, course difficile. */
  readonly bonusCents: number;
}

export interface DriverPayout {
  readonly baseAmountCents: number;
  readonly distanceAmountCents: number;
  readonly waitingAmountCents: number;
  readonly bonusAmountCents: number;
  /** Complément versé pour atteindre le plancher, le cas échéant. */
  readonly minimumTopUpCents: number;
  readonly totalAmountCents: number;
  readonly currency: string;
  readonly calculationVersion: number;
}

/**
 * Calcule la rémunération d'une course.
 *
 * Entièrement déterministe : mêmes entrées, même résultat. Aucun accès à
 * l'horloge, aucun aléa, aucune lecture externe.
 *
 * Les entrées négatives sont ramenées à zéro plutôt que de produire un montant
 * négatif : une distance négative est un bug d'appelant, et le silence coûterait
 * moins cher à découvrir qu'un versement inversé.
 */
export function calculateDriverPayout(
  input: PayoutInput,
  currency = "EUR",
): DriverPayout {
  const distanceMeters = Math.max(0, input.distanceMeters);
  const waitingSeconds = Math.max(0, input.waitingSeconds);
  const bonusAmountCents = Math.max(0, Math.round(input.bonusCents));

  const baseAmountCents = Math.max(0, Math.round(input.rates.baseFeeCents));

  const distanceAmountCents = Math.max(
    0,
    Math.round((distanceMeters / 1000) * input.rates.distanceRateCentsPerKm),
  );

  const waitingAmountCents = Math.max(
    0,
    Math.round((waitingSeconds / 60) * input.rates.waitingRateCentsPerMinute),
  );

  const subtotal = baseAmountCents + distanceAmountCents + waitingAmountCents + bonusAmountCents;
  const minimum = Math.max(0, Math.round(input.rates.minimumPayoutCents));
  const minimumTopUpCents = Math.max(0, minimum - subtotal);

  return {
    baseAmountCents,
    distanceAmountCents,
    waitingAmountCents,
    bonusAmountCents,
    minimumTopUpCents,
    totalAmountCents: subtotal + minimumTopUpCents,
    currency,
    calculationVersion: PAYOUT_CALCULATION_VERSION,
  };
}

/**
 * Garde-fou comptable : la somme des postes égale exactement le total.
 * Un écart d'un centime est un bug, pas un arrondi acceptable.
 */
export function payoutBalances(payout: DriverPayout): boolean {
  return (
    payout.baseAmountCents +
      payout.distanceAmountCents +
      payout.waitingAmountCents +
      payout.bonusAmountCents +
      payout.minimumTopUpCents ===
    payout.totalAmountCents
  );
}
