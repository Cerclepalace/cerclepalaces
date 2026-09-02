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

/**
 * Six états, et trois d'entre eux sont souvent confondus.
 *
 *  - `PENDING_VALIDATION` — le shop constitue son dossier. Rien n'est soumis.
 *  - `KYB_REVIEW` — le dossier est déposé et attend un examen. Le shop ne peut
 *    plus le modifier sans relancer le cycle.
 *  - `APPROVED` — le dossier est validé. **Et le shop ne vend toujours pas.**
 *    Valider un dossier et ouvrir un commerce sont deux décisions distinctes,
 *    prises à des moments différents et parfois par des personnes différentes ;
 *    les fondre en une seule ferait qu'approuver un KYB mettrait un shop en
 *    ligne, ce que personne ne veut au moment où il signe l'approbation.
 *  - `ACTIVE` — le seul état où le shop vend.
 *  - `SUSPENDED`, `CLOSED` — mesure conservatoire et fin de parcours.
 */
export const MERCHANT_STATUSES = [
  "PENDING_VALIDATION",
  "KYB_REVIEW",
  "APPROVED",
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
    to: "KYB_REVIEW",
    actors: ["merchant_owner", "admin"],
    reason: "Le shop dépose son dossier et demande son examen.",
  },
  {
    from: "PENDING_VALIDATION",
    to: "CLOSED",
    actors: ["admin", "merchant_owner"],
    reason: "Candidature abandonnée ou refusée avant examen du dossier.",
  },
  {
    from: "KYB_REVIEW",
    to: "APPROVED",
    actors: ["admin"],
    reason: "Dossier vérifié. Le shop est validé, mais ne vend pas encore.",
  },
  {
    from: "KYB_REVIEW",
    to: "PENDING_VALIDATION",
    actors: ["admin"],
    reason: "Dossier renvoyé au shop pour complément.",
  },
  {
    from: "KYB_REVIEW",
    to: "CLOSED",
    actors: ["admin", "merchant_owner"],
    reason: "Candidature retirée ou refusée à l'examen.",
  },
  {
    from: "APPROVED",
    to: "ACTIVE",
    actors: ["admin"],
    reason: "Ouverture commerciale : le shop peut vendre.",
  },
  {
    from: "APPROVED",
    to: "KYB_REVIEW",
    actors: ["admin", "system"],
    reason: "Changement critique du dossier : l'examen doit être refait.",
  },
  {
    from: "APPROVED",
    to: "CLOSED",
    actors: ["admin", "merchant_owner"],
    reason: "Fermeture avant ouverture commerciale.",
  },
  {
    from: "ACTIVE",
    to: "KYB_REVIEW",
    actors: ["admin", "system"],
    reason: "Changement critique du dossier : la vente s'arrête et l'examen reprend.",
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
    to: "KYB_REVIEW",
    actors: ["admin", "system"],
    reason: "Changement critique pendant une suspension : l'examen reprend.",
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
    reason: "Réouverture : le dossier repasse par la constitution complète.",
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

/**
 * Applique une transition de shop.
 *
 * Le dossier est **obligatoire**, y compris pour les transitions qui ne le
 * regardent pas. `canActivate` existait sans être appelée par cette garde : un
 * admin pouvait activer un shop au dossier vide, et seule la mise en vente le
 * rattrapait plus tard. Une garde disponible mais non câblée n'est pas une
 * garde ; la rendre inévitable coûte un paramètre.
 */
export function assertMerchantTransition(
  from: MerchantStatus,
  to: MerchantStatus,
  actor: Actor,
  dossier: KybDossier,
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

  if (to === "ACTIVE") {
    const activation = canActivate(dossier);
    if (!activation.ok) {
      throw new MerchantTransitionError(
        `Activation impossible, dossier incomplet : ${activation.gaps.join(", ")}.`,
        from,
        to,
        actor,
      );
    }
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
  PENDING_VALIDATION: "Dossier en cours de constitution",
  KYB_REVIEW: "Dossier en cours d'examen",
  APPROVED: "Dossier validé, pas encore ouvert",
  ACTIVE: "Actif",
  SUSPENDED: "Suspendu",
  CLOSED: "Fermé",
};

// ---------------------------------------------------------------------------
// Changements critiques
// ---------------------------------------------------------------------------

/**
 * Éléments du dossier dont la modification invalide l'examen déjà fait.
 *
 * Ce ne sont pas « les champs importants » : ce sont ceux sur lesquels
 * l'approbation portait. Changer un numéro d'immatriculation ou un bénéficiaire
 * effectif, c'est présenter une entité que personne n'a examinée sous une
 * validation obtenue pour une autre.
 *
 * `checkKybDossier` ne peut pas les voir : elle détecte le **vide**, pas le
 * **changement**. Il faut deux photographies du dossier, pas une.
 */
export const CRITICAL_KYB_FIELDS = [
  "BENEFICIAL_OWNER",
  "BANK_ACCOUNT",
  "LEGAL_FORM",
  "REGISTRATION_NUMBER",
  "LEGAL_NAME",
] as const;

export type CriticalKybField = (typeof CRITICAL_KYB_FIELDS)[number];

export const CRITICAL_KYB_FIELD_LABEL_FR: Record<CriticalKybField, string> = {
  BENEFICIAL_OWNER: "Bénéficiaire effectif",
  BANK_ACCOUNT: "Compte bancaire",
  LEGAL_FORM: "Forme juridique",
  REGISTRATION_NUMBER: "Numéro d'immatriculation",
  LEGAL_NAME: "Raison sociale",
};

/**
 * Empreinte du dossier sur les seuls champs critiques.
 *
 * Séparée de `KybDossier` : celui-ci sert à juger la complétude, celle-là à
 * détecter un changement. Les confondre ferait qu'ajouter une boutique
 * relancerait un examen KYB, ce qui n'a pas de sens.
 *
 * Le compte bancaire n'est pas stocké ici en clair : seule une empreinte non
 * réversible est comparée. Détecter un changement n'exige pas de connaître la
 * valeur.
 */
export interface CriticalKybSnapshot {
  readonly beneficialOwnerRef: string | null;
  readonly bankAccountRef: string | null;
  readonly legalForm: string | null;
  readonly registrationNumber: string | null;
  readonly legalName: string | null;
}

const CHAMP_PAR_CLÉ: readonly (readonly [keyof CriticalKybSnapshot, CriticalKybField])[] = [
  ["beneficialOwnerRef", "BENEFICIAL_OWNER"],
  ["bankAccountRef", "BANK_ACCOUNT"],
  ["legalForm", "LEGAL_FORM"],
  ["registrationNumber", "REGISTRATION_NUMBER"],
  ["legalName", "LEGAL_NAME"],
];

/**
 * Compare deux photographies du dossier et rend les champs critiques modifiés.
 *
 * La comparaison ignore la casse et les espaces superflus : « SAS Cercle
 * Palace » et « sas cercle palace  » désignent la même raison sociale, et
 * relancer un examen KYB sur une correction de frappe userait la procédure au
 * point qu'on cesserait de la respecter.
 *
 * Passer d'une valeur renseignée à `null` **est** un changement : l'information
 * sur laquelle l'approbation reposait a disparu.
 */
export function detectCriticalChanges(
  avant: CriticalKybSnapshot,
  après: CriticalKybSnapshot,
): readonly CriticalKybField[] {
  const normalise = (valeur: string | null): string | null =>
    valeur === null ? null : valeur.trim().toLowerCase().replace(/\s+/g, " ");

  return CHAMP_PAR_CLÉ.filter(([clé]) => normalise(avant[clé]) !== normalise(après[clé])).map(
    ([, champ]) => champ,
  );
}

/**
 * États depuis lesquels un changement critique renvoie à l'examen.
 *
 * Un shop encore en constitution ou déjà fermé n'a rien à réexaminer : son
 * dossier n'a pas été approuvé, ou ne l'est plus.
 */
const RÉEXAMINABLES: readonly MerchantStatus[] = ["APPROVED", "ACTIVE", "SUSPENDED"];

export type CriticalChangeOutcome =
  | { readonly applies: false; readonly reason: "NO_CRITICAL_CHANGE" | "NOT_REVIEWABLE" }
  | {
      readonly applies: true;
      readonly toStatus: "KYB_REVIEW";
      readonly changed: readonly CriticalKybField[];
    };

/**
 * Décide si un changement de dossier doit interrompre la vente.
 *
 * Pure : elle constate et propose, elle n'écrit rien. C'est l'appelant qui
 * applique la transition — et `assertMerchantTransition` la validera comme
 * n'importe quelle autre, sans passe-droit.
 */
export function applyCriticalChange(input: {
  readonly status: MerchantStatus;
  readonly before: CriticalKybSnapshot;
  readonly after: CriticalKybSnapshot;
}): CriticalChangeOutcome {
  const changed = detectCriticalChanges(input.before, input.after);
  if (changed.length === 0) return { applies: false, reason: "NO_CRITICAL_CHANGE" };
  if (!RÉEXAMINABLES.includes(input.status)) {
    return { applies: false, reason: "NOT_REVIEWABLE" };
  }
  return { applies: true, toStatus: "KYB_REVIEW", changed };
}
