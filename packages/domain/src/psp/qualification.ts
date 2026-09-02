/**
 * Qualification d'un prestataire de paiement et de son acquéreur.
 *
 * Ce module ne fait transiter aucun euro. Il modélise une **décision externe**
 * que le code ne prend pas : celle d'un prestataire, et surtout celle de
 * l'établissement qui souscrit le risque des transactions cartes.
 *
 * Il existe parce que le reste du code ne savait pas exprimer l'état réel du
 * dossier. Sans lui, « acquéreur inconnu » et « acquéreur approuvé » se
 * ressemblent : ce sont deux absences de `false`. Les dix-sept points ci-dessous
 * rendent la différence explicite, et le verdict par défaut est le refus.
 *
 * **Trois principes.**
 *
 * 1. **Un prestataire n'est pas un acquéreur.** Ce sont deux points distincts,
 *    et l'approbation de l'un ne renseigne pas l'autre.
 * 2. **Une capacité n'est pas une acceptation.** Une API marketplace
 *    documentée, un module KYC, un accès bac à sable : ce sont des fonctions
 *    vendues, pas un risque souscrit. Aucune ne peut répondre à un point.
 * 3. **Le silence ne vaut pas oui.** `NO_ANSWER` et `UNKNOWN` sont des réponses
 *    distinctes — l'une signifie « nous avons demandé, rien n'est venu »,
 *    l'autre « nous n'avons pas demandé » — et ni l'une ni l'autre ne qualifie.
 */

// ---------------------------------------------------------------------------
// Réponses
// ---------------------------------------------------------------------------

export const QUALIFICATION_ANSWERS = [
  "YES",
  "NO",
  "YES_WITH_CONDITIONS",
  /** Demandé, resté sans réponse. */
  "NO_ANSWER",
  /** Jamais demandé, ou réponse non exploitable. */
  "UNKNOWN",
] as const;

export type QualificationAnswer = (typeof QUALIFICATION_ANSWERS)[number];

export const QUALIFICATION_ANSWER_LABEL_FR: Record<QualificationAnswer, string> = {
  YES: "Oui",
  NO: "Non",
  YES_WITH_CONDITIONS: "Oui sous conditions",
  NO_ANSWER: "Demandé, sans réponse",
  UNKNOWN: "Non renseigné",
};

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/**
 * D'où vient une réponse.
 *
 * La liste est fermée, et la frontière est tracée à un seul endroit : ce qui
 * est **écrit et opposable** d'un côté, tout le reste de l'autre. Un échange
 * téléphonique favorable, une page de documentation, un accès bac à sable qui
 * fonctionne : rien de tout cela n'engage l'établissement qui portera le risque.
 */
export const ANSWER_SOURCES = [
  "WRITTEN_EMAIL",
  "SIGNED_CONTRACT",
  "OFFICIAL_LETTER",
  "MERCHANT_PORTAL_DECISION",
  // --- Ci-dessous : ne qualifient jamais ---
  "SALES_CALL",
  "TECHNICAL_DOCUMENTATION",
  "SANDBOX_ACCESS",
  "MARKETING_PAGE",
] as const;

export type AnswerSource = (typeof ANSWER_SOURCES)[number];

/**
 * Sources qui engagent. Les autres documentent, elles ne décident pas.
 *
 * Un bac à sable qui fonctionne prouve qu'une intégration est possible ; il ne
 * prouve pas qu'elle sera autorisée. Confondre les deux est l'erreur la plus
 * coûteuse de ce dossier, parce qu'elle se découvre après la mise en ligne.
 */
export const BINDING_SOURCES: readonly AnswerSource[] = [
  "WRITTEN_EMAIL",
  "SIGNED_CONTRACT",
  "OFFICIAL_LETTER",
  "MERCHANT_PORTAL_DECISION",
];

export function isBindingSource(source: AnswerSource): boolean {
  return BINDING_SOURCES.includes(source);
}

// ---------------------------------------------------------------------------
// Les dix-sept points
// ---------------------------------------------------------------------------

/**
 * Ce qui doit être répondu, séparément, avant qu'un euro puisse circuler.
 *
 * Aucun point ne s'infère d'un autre. Un « oui » global qui ne les couvre pas
 * tous laisse les autres à `UNKNOWN` — c'est la seule lecture honnête d'une
 * réponse partielle.
 *
 * **Trois points ajoutés le 2 septembre 2026**, après une revue qui a trouvé
 * qu'ils manquaient (écarts `C-1` et `C-2` de `docs/PSP-REGISTRE.md`) :
 *
 *  - `VISA_ACCEPTANCE_CONFIRMED` et `MASTERCARD_ACCEPTANCE_CONFIRMED`. Les deux
 *    réseaux étaient jusque-là rangés sous `PRODUCT_CATEGORIES_ACCEPTED`, si
 *    bien qu'un « oui » sur les catégories faisait passer ce point au vert sans
 *    qu'un mot ait été dit des réseaux. Séparés, ils restent `UNKNOWN` tant que
 *    personne ne les a confirmés nommément — et un refus de prestataire qui
 *    *invoque* Visa ou Mastercard ne les renseigne pas davantage : citer un
 *    tiers ne l'engage pas.
 *  - `TERMINATION_CONDITIONS_STATED`. `PRODUCTION_CONDITIONS_STATED` porte
 *    l'entrée en production ; la sortie — résiliation, gel, sort des fonds
 *    restants et des impayés postérieurs — n'avait aucune case, donc ne pouvait
 *    pas manquer visiblement.
 *
 * Ces trois ajouts ne peuvent que **bloquer davantage** : ils naissent
 * `NOT_ASKED` pour tous les dossiers existants.
 */
export const QUALIFICATION_POINTS = [
  "PROVIDER_IDENTIFIED",
  "ACQUIRING_ENTITY_IDENTIFIED",
  "ACQUIRING_COUNTRY_IDENTIFIED",
  "MERCHANT_CATEGORY_CODE_CONFIRMED",
  "ACTIVITY_ACCEPTED",
  "PRODUCT_CATEGORIES_ACCEPTED",
  "VISA_ACCEPTANCE_CONFIRMED",
  "MASTERCARD_ACCEPTANCE_CONFIRMED",
  "MODEL_A_ACCEPTED",
  "MODEL_B_ACCEPTED",
  "COMPLIANCE_CONDITIONS_STATED",
  "RESERVE_CONDITIONS_STATED",
  "CHARGEBACK_RULES_STATED",
  "REFUND_RULES_STATED",
  "SETTLEMENT_RULES_STATED",
  "PRODUCTION_CONDITIONS_STATED",
  "TERMINATION_CONDITIONS_STATED",
] as const;

export type QualificationPoint = (typeof QUALIFICATION_POINTS)[number];

export const QUALIFICATION_POINT_LABEL_FR: Record<QualificationPoint, string> = {
  PROVIDER_IDENTIFIED: "Prestataire identifié",
  ACQUIRING_ENTITY_IDENTIFIED: "Entité acquéreur nommée",
  ACQUIRING_COUNTRY_IDENTIFIED: "Pays de l'acquéreur",
  MERCHANT_CATEGORY_CODE_CONFIRMED: "Code d'activité confirmé",
  ACTIVITY_ACCEPTED: "Activité acceptée",
  PRODUCT_CATEGORIES_ACCEPTED: "Catégories de produits acceptées",
  VISA_ACCEPTANCE_CONFIRMED: "Acceptation Visa confirmée",
  MASTERCARD_ACCEPTANCE_CONFIRMED: "Acceptation Mastercard confirmée",
  MODEL_A_ACCEPTED: "Modèle A accepté ou refusé",
  MODEL_B_ACCEPTED: "Modèle B accepté ou refusé",
  COMPLIANCE_CONDITIONS_STATED: "Conditions de conformité énoncées",
  RESERVE_CONDITIONS_STATED: "Conditions de réserve énoncées",
  CHARGEBACK_RULES_STATED: "Règles d'impayé énoncées",
  REFUND_RULES_STATED: "Règles de restitution énoncées",
  SETTLEMENT_RULES_STATED: "Règles de reversement énoncées",
  PRODUCTION_CONDITIONS_STATED: "Conditions de passage en production énoncées",
  TERMINATION_CONDITIONS_STATED: "Conditions de résiliation et sort des fonds énoncées",
};

/**
 * Points qui portent sur l'acquéreur et non sur le prestataire.
 *
 * Isolés pour qu'un rapport puisse dire « le prestataire a répondu, l'acquéreur
 * non » — la phrase la plus fréquente de ce dossier, et celle qu'un statut
 * unique rendrait indicible.
 */
export const ACQUIRING_POINTS: readonly QualificationPoint[] = [
  "ACQUIRING_ENTITY_IDENTIFIED",
  "ACQUIRING_COUNTRY_IDENTIFIED",
  "MERCHANT_CATEGORY_CODE_CONFIRMED",
];

/**
 * Points qui portent sur les réseaux cartes, et sur personne d'autre.
 *
 * Séparés des points prestataire **et** des points acquéreur, parce que les
 * trois niveaux décident indépendamment. Un prestataire peut accepter un
 * dossier que son acquéreur refuse ; un acquéreur peut souscrire une activité
 * qu'un réseau assortit de conditions. Aucune de ces trois décisions ne
 * s'infère des deux autres.
 *
 * Ce qui, en pratique, interdit trois phrases : « Stripe accepte donc Visa
 * accepte », « Stripe accepte donc Mastercard accepte », et « ce prestataire a
 * cité Visa pour nous refuser donc Visa refuse le CBD ». Aucune n'est étayée
 * par une pièce émanant d'un réseau.
 */
export const CARD_NETWORK_POINTS: readonly QualificationPoint[] = [
  "VISA_ACCEPTANCE_CONFIRMED",
  "MASTERCARD_ACCEPTANCE_CONFIRMED",
];

// ---------------------------------------------------------------------------
// Le dossier
// ---------------------------------------------------------------------------

export interface QualificationResponse {
  readonly point: QualificationPoint;
  readonly answer: QualificationAnswer;
  readonly source: AnswerSource;
  /** Date de la réponse. `null` si elle n'est pas datable — donc inopposable. */
  readonly answeredAt: Date | null;
  /** Référence retrouvable : identifiant de fil, numéro de courrier, contrat. */
  readonly reference: string | null;
  /** Obligatoire quand la réponse est « oui sous conditions ». */
  readonly conditions: string | null;
}

export interface ProviderQualification {
  readonly providerName: string;
  readonly responses: readonly QualificationResponse[];
}

/** Dossier neuf : tout est à `UNKNOWN` parce que rien n'a été demandé. */
export function emptyQualification(providerName: string): ProviderQualification {
  return { providerName, responses: [] };
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export const POINT_VERDICTS = [
  "SATISFIED",
  "REFUSED",
  /** Répondu favorablement, mais la réponse n'engage pas son émetteur. */
  "NOT_BINDING",
  /** Répondu « oui sous conditions » sans que les conditions soient écrites. */
  "CONDITIONS_MISSING",
  /** Répondu, mais sans date ni référence retrouvable. */
  "NOT_TRACEABLE",
  "AWAITING_ANSWER",
  "NOT_ASKED",
] as const;

export type PointVerdict = (typeof POINT_VERDICTS)[number];

export interface PointAssessment {
  readonly point: QualificationPoint;
  readonly verdict: PointVerdict;
}

export type QualificationAssessment =
  | { readonly qualified: true; readonly providerName: string }
  | {
      readonly qualified: false;
      readonly providerName: string;
      /** Tous les points qui manquent, jamais le premier seulement. */
      readonly blocking: readonly PointAssessment[];
    };

function assessPoint(
  point: QualificationPoint,
  response: QualificationResponse | undefined,
): PointAssessment {
  if (response === undefined) return { point, verdict: "NOT_ASKED" };
  if (response.answer === "UNKNOWN") return { point, verdict: "NOT_ASKED" };
  if (response.answer === "NO_ANSWER") return { point, verdict: "AWAITING_ANSWER" };
  if (response.answer === "NO") return { point, verdict: "REFUSED" };

  // À partir d'ici la réponse est favorable. Reste à savoir si elle vaut
  // quelque chose.
  if (!isBindingSource(response.source)) return { point, verdict: "NOT_BINDING" };

  if (
    response.answeredAt === null ||
    Number.isNaN(response.answeredAt.getTime()) ||
    response.reference === null ||
    response.reference.trim() === ""
  ) {
    // Une réponse qu'on ne peut pas retrouver ne s'oppose à personne.
    return { point, verdict: "NOT_TRACEABLE" };
  }

  if (
    response.answer === "YES_WITH_CONDITIONS" &&
    (response.conditions === null || response.conditions.trim() === "")
  ) {
    return { point, verdict: "CONDITIONS_MISSING" };
  }

  return { point, verdict: "SATISFIED" };
}

/**
 * Juge un dossier de qualification.
 *
 * Le verdict par défaut est le refus : un dossier vide n'est pas « en attente »,
 * il est **non qualifié**. Tous les points bloquants sont rendus ensemble —
 * corriger une question à la fois, avec un aller-retour à chaque fois, prend des
 * mois sur ce type de dossier.
 *
 * Cette fonction ne dit **jamais** qu'un prestataire est bon. Elle dit qu'il
 * reste des questions sans réponse opposable, ou qu'il n'en reste plus. La
 * décision de contracter appartient à des humains.
 */
export function assessQualification(
  qualification: ProviderQualification,
): QualificationAssessment {
  const parPoint = new Map(
    qualification.responses.map((response) => [response.point, response] as const),
  );

  const blocking = QUALIFICATION_POINTS.map((point) =>
    assessPoint(point, parPoint.get(point)),
  ).filter((assessment) => assessment.verdict !== "SATISFIED");

  if (blocking.length > 0) {
    return { qualified: false, providerName: qualification.providerName, blocking };
  }
  return { qualified: true, providerName: qualification.providerName };
}

export class ProviderNotQualifiedError extends Error {
  readonly status = 409;
  readonly providerName: string;
  readonly blocking: readonly PointAssessment[];

  constructor(providerName: string, blocking: readonly PointAssessment[]) {
    super(
      `Le prestataire « ${providerName} » n'est pas qualifié : ` +
        `${blocking.length} point(s) sans réponse opposable — ` +
        `${blocking.map((b) => `${b.point}=${b.verdict}`).join(", ")}.`,
    );
    this.name = "ProviderNotQualifiedError";
    this.providerName = providerName;
    this.blocking = blocking;
  }
}

/**
 * Garde à placer devant toute activation en production.
 *
 * Elle n'existe pas pour être appelée aujourd'hui — rien n'encaisse — mais pour
 * que le jour où un adaptateur réel sera écrit, l'oubli de cette vérification
 * soit une omission visible plutôt qu'un chemin par défaut.
 */
export function assertProviderQualified(qualification: ProviderQualification): void {
  const assessment = assessQualification(qualification);
  if (!assessment.qualified) {
    throw new ProviderNotQualifiedError(assessment.providerName, assessment.blocking);
  }
}

/**
 * Vrai si le prestataire a répondu mais que l'acquéreur reste inconnu.
 *
 * L'état le plus fréquent de ce dossier, et celui qu'un statut unique rendrait
 * indicible : « ils sont d'accord » sans que personne ne sache qui souscrit.
 */
export function acquiringStillUnknown(qualification: ProviderQualification): boolean {
  const assessment = assessQualification(qualification);
  if (assessment.qualified) return false;
  return assessment.blocking.some((item) => ACQUIRING_POINTS.includes(item.point));
}

/**
 * Vrai si l'acceptation Visa ou Mastercard reste à confirmer.
 *
 * Distinct de `acquiringStillUnknown` à dessein : un acquéreur nommé qui a
 * souscrit l'activité ne dit toujours rien des conditions que Visa ou
 * Mastercard peuvent imposer à cette catégorie de commerce.
 */
export function cardNetworksStillUnknown(qualification: ProviderQualification): boolean {
  const assessment = assessQualification(qualification);
  if (assessment.qualified) return false;
  return assessment.blocking.some((item) => CARD_NETWORK_POINTS.includes(item.point));
}
