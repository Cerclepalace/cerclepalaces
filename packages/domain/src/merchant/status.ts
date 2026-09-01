/**
 * Cycle de vie d'un shop sur la plateforme.
 *
 * Un shop n'est pas « inscrit puis actif ». Il est **validé**, et cette
 * validation est une décision de la plateforme, jamais un effet de bord de
 * l'inscription. Tant qu'elle n'a pas eu lieu, le shop existe, peut préparer son
 * catalogue, et ne vend pas.
 *
 * La machine est délibérément petite. Quatre états, sept transitions, aucune
 * n'est automatique : chacune est portée par un acteur nommé, parce que
 * suspendre un commerçant ou le rouvrir sont des actes qui doivent avoir un
 * auteur identifiable.
 *
 * **Ce module ne dit pas ce qu'un KYB doit contenir.** La liste exacte des
 * pièces dépend du PSP et de l'acquéreur, qui ne sont pas choisis
 * (docs/TO_VERIFY.md, décision 09). Ce qui est vérifié ici est la complétude
 * *structurelle* du dossier — les champs que le modèle de données prévoit sont
 * remplis — et rien d'autre. Aucune exigence réglementaire n'est codée en dur.
 */

import type { Actor } from "../roles.js";

export const MERCHANT_STATUSES = [
  "PENDING_VALIDATION",
  "ACTIVE",
  "SUSPENDED",
  "CLOSED",
] as const;

export type MerchantStatus = (typeof MERCHANT_STATUSES)[number];

/**
 * `CLOSED` est le seul état terminal.
 *
 * `SUSPENDED` n'en est pas un : une suspension est une mesure conservatoire, et
 * un shop suspendu par erreur ou après régularisation doit pouvoir revenir.
 * Sans cette sortie, la seule issue d'une suspension serait la fermeture — ce
 * qui rendrait la mesure disproportionnée et donc inutilisable en pratique.
 */
export const MERCHANT_TERMINAL_STATUSES: readonly MerchantStatus[] = ["CLOSED"];

export function isTerminalMerchantStatus(status: MerchantStatus): boolean {
  return MERCHANT_TERMINAL_STATUSES.includes(status);
}

/** Seul un shop actif peut vendre. Règle unique, testée ici, jamais dupliquée. */
export function canSell(status: MerchantStatus): boolean {
  return status === "ACTIVE";
}

const PLATFORM: readonly Actor[] = ["admin", "support_agent"];

export interface MerchantTransition {
  readonly from: MerchantStatus;
  readonly to: MerchantStatus;
  readonly actors: readonly Actor[];
  readonly reason: string;
}

export const MERCHANT_TRANSITIONS: readonly MerchantTransition[] = [
  {
    from: "PENDING_VALIDATION",
    to: "ACTIVE",
    actors: ["admin"],
    reason: "Dossier vérifié : le shop peut vendre.",
  },
  {
    from: "PENDING_VALIDATION",
    to: "CLOSED",
    actors: ["admin", "merchant_owner"],
    reason: "Candidature abandonnée ou refusée avant activation.",
  },
  {
    from: "ACTIVE",
    to: "SUSPENDED",
    actors: PLATFORM,
    reason: "Suspension : doute sur la conformité, signalement, impayé, contrôle en cours.",
  },
  {
    from: "ACTIVE",
    to: "CLOSED",
    actors: ["admin", "merchant_owner"],
    reason: "Fermeture demandée par le shop ou prononcée par la plateforme.",
  },
  {
    from: "SUSPENDED",
    to: "ACTIVE",
    actors: ["admin"],
    reason: "Levée de suspension après vérification.",
  },
  {
    from: "SUSPENDED",
    to: "CLOSED",
    actors: ["admin"],
    reason: "Suspension confirmée en fermeture définitive.",
  },
  // Volontairement réservée à un admin : rouvrir un shop fermé revient à
  // rejouer la validation, pas à annuler un clic.
  {
    from: "CLOSED",
    to: "PENDING_VALIDATION",
    actors: ["admin"],
    reason: "Réouverture : le dossier repasse par la validation complète.",
  },
];

export function findMerchantTransition(
  from: MerchantStatus,
  to: MerchantStatus,
): MerchantTransition | undefined {
  return MERCHANT_TRANSITIONS.find(
    (transition) => transition.from === from && transition.to === to,
  );
}

export function allowedNextMerchantStatuses(
  from: MerchantStatus,
  actor: Actor,
): readonly MerchantStatus[] {
  return MERCHANT_TRANSITIONS.filter(
    (transition) => transition.from === from && transition.actors.includes(actor),
  ).map((transition) => transition.to);
}

export class MerchantTransitionError extends Error {
  readonly status = 409;
  readonly from: MerchantStatus;
  readonly to: MerchantStatus;
  readonly actor: Actor;

  constructor(message: string, from: MerchantStatus, to: MerchantStatus, actor: Actor) {
    super(message);
    this.name = "MerchantTransitionError";
    this.from = from;
    this.to = to;
    this.actor = actor;
  }
}

export function assertMerchantTransition(
  from: MerchantStatus,
  to: MerchantStatus,
  actor: Actor,
): MerchantTransition {
  const transition = findMerchantTransition(from, to);

  if (!transition) {
    throw new MerchantTransitionError(
      `Transition ${from} → ${to} inexistante pour un shop.`,
      from,
      to,
      actor,
    );
  }

  if (!transition.actors.includes(actor)) {
    throw new MerchantTransitionError(
      `Un ${actor} ne peut pas faire passer un shop de ${from} à ${to}.`,
      from,
      to,
      actor,
    );
  }

  return transition;
}

// ---------------------------------------------------------------------------
// Complétude du dossier
// ---------------------------------------------------------------------------

/**
 * Pièces manquantes possibles.
 *
 * Ce sont des **manques structurels**, pas des exigences réglementaires : « le
 * champ prévu par le modèle est vide ». Le jour où la liste officielle du PSP
 * sera connue (décision 09), elle s'ajoutera par-dessus, elle ne remplacera pas
 * celle-ci.
 */
export const KYB_GAPS = [
  "MISSING_LEGAL_NAME",
  "MISSING_TRADE_NAME",
  "MISSING_REGISTRATION_NUMBER",
  "MISSING_LOCATION",
  "INCOMPLETE_LOCATION_ADDRESS",
  "MISSING_OWNER",
] as const;

export type KybGap = (typeof KYB_GAPS)[number];

export const KYB_GAP_LABEL_FR: Record<KybGap, string> = {
  MISSING_LEGAL_NAME: "Raison sociale absente",
  MISSING_TRADE_NAME: "Nom commercial absent",
  MISSING_REGISTRATION_NUMBER: "Numéro d'immatriculation absent",
  MISSING_LOCATION: "Aucune boutique déclarée",
  INCOMPLETE_LOCATION_ADDRESS: "Adresse de boutique incomplète",
  MISSING_OWNER: "Aucun responsable rattaché au shop",
};

export interface KybLocationInput {
  readonly line1: string | null;
  readonly postalCode: string | null;
  readonly city: string | null;
  readonly country: string | null;
}

export interface KybDossier {
  readonly legalName: string | null;
  readonly tradeName: string | null;
  readonly registrationNumber: string | null;
  readonly locations: readonly KybLocationInput[];
  readonly ownerCount: number;
}

export interface KybReadiness {
  readonly complete: boolean;
  readonly gaps: readonly KybGap[];
}

const blank = (value: string | null): boolean => value === null || value.trim() === "";

/**
 * Liste ce qui manque, sans juger.
 *
 * Rend **tous** les manques d'un coup plutôt que le premier : un commerçant qui
 * corrige son dossier pièce par pièce, avec un aller-retour à chaque fois,
 * abandonne. Deux appels successifs sur le même dossier rendent la même liste,
 * dans le même ordre — c'est une fonction pure, et l'ordre suit celui de
 * `KYB_GAPS`.
 */
export function checkKybDossier(dossier: KybDossier): KybReadiness {
  const gaps: KybGap[] = [];

  if (blank(dossier.legalName)) gaps.push("MISSING_LEGAL_NAME");
  if (blank(dossier.tradeName)) gaps.push("MISSING_TRADE_NAME");
  if (blank(dossier.registrationNumber)) gaps.push("MISSING_REGISTRATION_NUMBER");

  if (dossier.locations.length === 0) {
    gaps.push("MISSING_LOCATION");
  } else if (
    dossier.locations.some(
      (location) =>
        blank(location.line1) ||
        blank(location.postalCode) ||
        blank(location.city) ||
        blank(location.country),
    )
  ) {
    gaps.push("INCOMPLETE_LOCATION_ADDRESS");
  }

  if (dossier.ownerCount < 1) gaps.push("MISSING_OWNER");

  return { complete: gaps.length === 0, gaps };
}

/**
 * Un shop ne peut être activé que sur un dossier structurellement complet.
 *
 * C'est une garde, pas la validation elle-même : la décision reste humaine. Elle
 * empêche seulement d'activer un shop dont on sait déjà qu'il lui manque des
 * pièces — ce qui arrive quand la validation se fait à la chaîne.
 */
export function canActivate(
  dossier: KybDossier,
): { readonly ok: true } | { readonly ok: false; readonly gaps: readonly KybGap[] } {
  const readiness = checkKybDossier(dossier);
  if (!readiness.complete) return { ok: false, gaps: readiness.gaps };
  return { ok: true };
}

export const MERCHANT_STATUS_LABEL_FR: Record<MerchantStatus, string> = {
  PENDING_VALIDATION: "En cours de validation",
  ACTIVE: "Actif",
  SUSPENDED: "Suspendu",
  CLOSED: "Fermé",
};
