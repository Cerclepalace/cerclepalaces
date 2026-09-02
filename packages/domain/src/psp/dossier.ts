/**
 * Le dossier d'un prestataire : trois choses qui ne se mélangent jamais.
 *
 *  1. **Ce qu'il sait faire** — capacités techniques et commerciales, souvent
 *     abondamment documentées.
 *  2. **Ce qu'il a accepté** — la qualification, souvent vide.
 *  3. **Ce qu'on lui a demandé** — l'historique des démarches, qui explique
 *     pourquoi la deuxième est vide.
 *
 * Les tenir dans le même objet sans les confondre est tout l'intérêt de ce
 * fichier. Le piège de ce dossier est là : un prestataire qui documente
 * marketplace, KYC, split, reversements et Merchant of Record **paraît**
 * qualifié. Il ne l'est pas. La séparation est ici structurelle, pas
 * documentaire — `assessQualification` ne reçoit jamais les capacités, donc
 * aucune d'elles ne peut faire pencher un verdict.
 */

import {
  assessQualification,
  type ProviderQualification,
  type QualificationAssessment,
  type QualificationResponse,
} from "./qualification.js";

// ---------------------------------------------------------------------------
// Capacités — documentées, jamais qualifiantes
// ---------------------------------------------------------------------------

/**
 * Fonctions qu'un prestataire annonce savoir faire.
 *
 * Vocabulaire fermé, pour qu'une capacité inventée ne se glisse pas dans un
 * dossier. Aucune de ces valeurs n'a d'effet sur un verdict : elles servent à
 * comparer des offres une fois qu'un prestataire a accepté le dossier, pas à
 * décider qu'il l'accepterait.
 */
export const TECHNICAL_CAPABILITIES = [
  "MULTI_VENDOR_MARKETPLACE",
  "SELLER_ONBOARDING_KYC",
  "SPLIT_DISBURSEMENT",
  "SELLER_SETTLEMENT",
  "MULTI_PARTY_RETURNS",
  "DISPUTE_HANDLING",
  "RECONCILIATION",
  "MERCHANT_OF_RECORD_SERVICE",
  "SANDBOX_ENVIRONMENT",
  "EU_PRESENCE",
] as const;

export type TechnicalCapability = (typeof TECHNICAL_CAPABILITIES)[number];

export interface CapabilityRecord {
  readonly capability: TechnicalCapability;
  /** D'où vient l'information : documentation, démonstration, page produit. */
  readonly documentedIn: string;
}

// ---------------------------------------------------------------------------
// Démarches — ce qu'on a demandé, et quand
// ---------------------------------------------------------------------------

export const OUTREACH_STATES = [
  /** Message rédigé, pas encore parti. */
  "PREPARED",
  "SENT",
  "ANSWERED",
  /** Fil clos par le prestataire sans décision. Ce n'est pas un refus. */
  "CLOSED_WITHOUT_DECISION",
] as const;

export type OutreachState = (typeof OUTREACH_STATES)[number];

export interface OutreachRecord {
  readonly subject: string;
  readonly state: OutreachState;
  /** Fil ou ticket, pour que la relance reste dans le même historique. */
  readonly threadReference: string | null;
  readonly preparedAt: Date | null;
  /** `null` tant que personne n'a réellement envoyé le message. */
  readonly sentAt: Date | null;
  /** Trace de l'envoi : accusé, capture, identifiant de message. */
  readonly proofOfSending: string | null;
  readonly answeredAt: Date | null;
  readonly note: string | null;
}

/**
 * Une démarche préparée n'est pas une démarche faite.
 *
 * Écrit parce que la confusion est facile et coûteuse : un message rédigé,
 * relu, prêt à partir, ressemble à un dossier en cours. Tant que `sentAt` est
 * vide, personne n'attend de réponse — et le compteur ne tourne pas.
 */
export function isActuallySent(outreach: OutreachRecord): boolean {
  return (
    outreach.sentAt !== null &&
    !Number.isNaN(outreach.sentAt.getTime()) &&
    outreach.proofOfSending !== null &&
    outreach.proofOfSending.trim() !== ""
  );
}

// ---------------------------------------------------------------------------
// Le dossier complet
// ---------------------------------------------------------------------------

export interface ProviderDossier {
  readonly providerName: string;
  /** Ce qu'il a accepté. Seule cette partie entre dans un verdict. */
  readonly qualification: ProviderQualification;
  /** Ce qu'il sait faire. N'entre jamais dans un verdict. */
  readonly capabilities: readonly CapabilityRecord[];
  /** Ce qu'on lui a demandé. */
  readonly outreach: readonly OutreachRecord[];
}

/**
 * Juge un dossier.
 *
 * Ne transmet que la qualification : les capacités et les démarches ne sont
 * même pas passées à la fonction de jugement. C'est la garantie la plus forte
 * que ce module puisse offrir — une capacité ne peut pas influencer un verdict
 * qu'elle n'atteint pas.
 */
export function assessDossier(dossier: ProviderDossier): QualificationAssessment {
  return assessQualification(dossier.qualification);
}

/**
 * Réponses favorables dont la trace n'est pas retrouvable.
 *
 * Distingue « nous savons que c'est vrai » de « nous pouvons le prouver ». Un
 * refus sans référence bloque de toute façon ; c'est une acceptation sans
 * référence qui est dangereuse, parce qu'elle ne s'oppose à personne le jour où
 * elle est contestée.
 */
export function unarchivedResponses(
  dossier: ProviderDossier,
): readonly QualificationResponse[] {
  return dossier.qualification.responses.filter(
    (response) =>
      (response.answer === "YES" || response.answer === "YES_WITH_CONDITIONS") &&
      (response.reference === null || response.reference.trim() === ""),
  );
}

/** Dossier neuf : rien n'est su, rien n'a été demandé. */
export function emptyDossier(providerName: string): ProviderDossier {
  return {
    providerName,
    qualification: { providerName, responses: [] },
    capabilities: [],
    outreach: [],
  };
}
