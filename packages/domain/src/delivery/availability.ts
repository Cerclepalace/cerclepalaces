/**
 * Disponibilité d'un driver.
 *
 * `ONLINE` signifie exactement une chose :
 *
 *     « ce driver accepte de **recevoir** des propositions. »
 *
 * Jamais « ce driver doit accepter une course ». La distinction n'est pas
 * cosmétique : un driver Projet 1 n'est pas exclusif, il travaille peut-être
 * en parallèle sur d'autres plateformes, et une course acceptée ailleurs est un
 * refus parfaitement légitime chez nous.
 *
 * Conséquence directe, tenue dans tout le module : **aucune pénalité
 * automatique**. Pas de score de refus, pas de mise à l'écart après N
 * non-réponses. Le moteur n'a pas de mémoire punitive.
 */

export const DRIVER_AVAILABILITIES = ["OFFLINE", "ONLINE", "PAUSED"] as const;
export type DriverAvailability = (typeof DRIVER_AVAILABILITIES)[number];

export const DRIVER_VERIFICATIONS = [
  "APPLICATION_SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
] as const;
export type DriverVerification = (typeof DRIVER_VERIFICATIONS)[number];

/**
 * Seul `ONLINE` rend un driver joignable par le dispatch.
 *
 * `PAUSED` est volontairement distinct de `OFFLINE` : le driver reste en
 * service — il finit une course, il déjeune — mais ne veut pas de nouvelle
 * proposition dans l'immédiat. Les deux se comportent pareil vis-à-vis du
 * moteur ; ils se distinguent dans les statistiques d'offre réelle.
 */
export function canReceiveOffers(availability: DriverAvailability): boolean {
  return availability === "ONLINE";
}

/** Un driver non approuvé n'est jamais joignable, quel que soit son état déclaré. */
export function isDispatchable(input: {
  readonly verification: DriverVerification;
  readonly availability: DriverAvailability;
}): boolean {
  return input.verification === "APPROVED" && canReceiveOffers(input.availability);
}

/**
 * Toutes les bascules sont permises, y compris `ONLINE → ONLINE` (sans effet).
 * Le driver est maître de sa disponibilité ; la seule contrainte est qu'un
 * changement d'état ferme la période précédente et en ouvre une nouvelle.
 */
export interface AvailabilityPeriod {
  readonly status: DriverAvailability;
  readonly startedAt: Date;
  readonly endedAt?: Date;
}

export interface AvailabilityChange {
  /** Période à clore, si une était ouverte. */
  readonly closing?: { readonly startedAt: Date; readonly endedAt: Date };
  /** Période à ouvrir. */
  readonly opening: { readonly status: DriverAvailability; readonly startedAt: Date };
  /** Faux quand l'état ne change pas : l'appelant peut alors ne rien écrire. */
  readonly changed: boolean;
}

/**
 * Calcule l'écriture d'historique correspondant à un changement d'état.
 *
 * Séparer l'état courant (`Driver.availability`) de l'historique
 * (`DriverAvailabilityLog`) n'est pas de la redondance : l'état courant sert au
 * dispatch, l'historique sert à mesurer l'offre réelle par zone et par créneau.
 * C'est cette mesure qui dira si le réseau tient — bien avant qu'un algorithme
 * de dispatch sophistiqué ne serve à quoi que ce soit.
 */
export function changeAvailability(input: {
  readonly current: AvailabilityPeriod | null;
  readonly next: DriverAvailability;
  readonly now: Date;
}): AvailabilityChange {
  const { current, next, now } = input;

  if (current && current.status === next && current.endedAt === undefined) {
    return {
      opening: { status: next, startedAt: current.startedAt },
      changed: false,
    };
  }

  return {
    ...(current && current.endedAt === undefined
      ? { closing: { startedAt: current.startedAt, endedAt: now } }
      : {}),
    opening: { status: next, startedAt: now },
    changed: true,
  };
}

/**
 * Temps cumulé passé dans un état sur une fenêtre donnée, en secondes.
 *
 * Les périodes encore ouvertes sont comptées jusqu'à `until`. Sert à répondre à
 * « combien d'heures de driver disponibles ai-je eu sur cette zone mardi soir ».
 */
export function totalSecondsIn(
  periods: readonly AvailabilityPeriod[],
  status: DriverAvailability,
  window: { readonly from: Date; readonly until: Date },
): number {
  const windowStart = window.from.getTime();
  const windowEnd = window.until.getTime();

  return periods
    .filter((period) => period.status === status)
    .reduce((total, period) => {
      const start = Math.max(period.startedAt.getTime(), windowStart);
      const end = Math.min((period.endedAt ?? window.until).getTime(), windowEnd);
      return total + Math.max(0, end - start);
    }, 0) / 1000;
}
