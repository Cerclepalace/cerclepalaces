/**
 * Ce qui autorise un produit à être proposé à la vente.
 *
 * Trois choses, indépendantes, qui doivent être vraies **ensemble** :
 *
 *   1. le shop a le droit de vendre (`merchant/status.ts`) ;
 *   2. le produit est conforme (`compliance/status.ts`) ;
 *   3. le shop l'a mis en vente et en a en stock (`Inventory`).
 *
 * Elles sont séparées parce qu'elles échouent séparément, et qu'un commerçant
 * qui ne voit pas son produit doit savoir laquelle des trois lui manque. Un
 * simple booléen le laisserait chercher.
 *
 * **Aucun seuil réglementaire n'est codé ici.** Les taux THC/CBD sont stockés
 * tels que déclarés ; la règle appliquée est uniquement « seul `APPROVED` est
 * vendable », et c'est un humain qui décide de l'approbation
 * (docs/TO_VERIFY.md, décision 10).
 */


/**
 * Nature d'une pièce jointe au dossier de conformité.
 *
 * Nommées ici plutôt que laissées en chaînes libres : « COA », « coa »,
 * « certificat » et « Certificat d'analyse » désigneraient la même chose sans
 * qu'aucun code ne puisse les rapprocher.
 */
export const COMPLIANCE_DOCUMENT_KINDS = [
  /** Certificat d'analyse de lot, émis par un laboratoire. */
  "CERTIFICATE_OF_ANALYSIS",
  "SUPPLIER_SHEET",
  "PRODUCT_LABEL",
  "OTHER",
] as const;

export type ComplianceDocumentKind = (typeof COMPLIANCE_DOCUMENT_KINDS)[number];

export const COMPLIANCE_DOCUMENT_KIND_LABEL_FR: Record<ComplianceDocumentKind, string> = {
  CERTIFICATE_OF_ANALYSIS: "Certificat d'analyse (COA)",
  SUPPLIER_SHEET: "Fiche fournisseur",
  PRODUCT_LABEL: "Étiquetage produit",
  OTHER: "Autre pièce",
};

// ---------------------------------------------------------------------------
// Dépôt d'un dossier de conformité
// ---------------------------------------------------------------------------

/**
 * Noms canoniques des deux mesures de THC.
 *
 * Elles ne disent pas la même chose et ne se substituent pas l'une à l'autre :
 * le **delta-9** est la mesure sur laquelle porte un plafond, le **THC total**
 * agrège des formes qui n'ont pas le même statut. Confondre les deux, dans un
 * sens comme dans l'autre, produit une décision fausse : un plafond appliqué au
 * total refuserait des produits conformes ; un total présenté comme du delta-9
 * en laisserait passer d'autres.
 *
 * Ce sont des **noms**, pas des seuils. Aucune valeur n'est écrite ici : les
 * plafonds vivent dans la politique de catalogue, révisables et adossés à une
 * preuve (décision 10).
 */
export const DELTA9_THC_ANALYTE = "DELTA9_THC";
export const TOTAL_THC_ANALYTE = "TOTAL_THC";

export const SUBMISSION_GAPS = [
  "MISSING_NAME",
  "MISSING_CERTIFICATE_OF_ANALYSIS",
  "MISSING_LABORATORY",
  "MISSING_BATCH_NUMBER",
  "MISSING_SUPPLIER",
  "MISSING_DECLARED_CONTENTS",
  "INVALID_MEASUREMENT",
  "MISSING_ISSUE_DATE",
  "INVALID_ISSUE_DATE",
  "ISSUE_DATE_IN_FUTURE",
  "CERTIFICATE_ALREADY_EXPIRED",
] as const;

export type SubmissionGap = (typeof SUBMISSION_GAPS)[number];

export const SUBMISSION_GAP_LABEL_FR: Record<SubmissionGap, string> = {
  MISSING_NAME: "Nom de produit absent",
  MISSING_CERTIFICATE_OF_ANALYSIS: "Aucun certificat d'analyse joint",
  MISSING_LABORATORY: "Laboratoire émetteur non identifié",
  MISSING_BATCH_NUMBER: "Numéro de lot absent",
  MISSING_SUPPLIER: "Fournisseur non renseigné",
  MISSING_DECLARED_CONTENTS: "Taux delta-9 THC et CBD non déclarés",
  INVALID_MEASUREMENT: "Un taux déclaré n'est pas une mesure exploitable",
  MISSING_ISSUE_DATE: "Date d'émission du certificat absente",
  INVALID_ISSUE_DATE: "Date d'émission illisible",
  ISSUE_DATE_IN_FUTURE: "Certificat émis à une date future",
  CERTIFICATE_ALREADY_EXPIRED: "Le certificat fourni est déjà expiré",
};

export interface ComplianceSubmission {
  readonly productName: string | null;
  /** Laboratoire ayant émis le certificat. Un COA sans émetteur n'engage rien. */
  readonly laboratory: string | null;
  readonly batchNumber: string | null;
  readonly supplier: string | null;
  /**
   * Delta-9 THC déclaré. **C'est la mesure sur laquelle porte un plafond.**
   * Aucun seuil ne lui est appliqué ici : la politique s'en charge.
   */
  readonly delta9ThcPercent: number | null;
  /**
   * THC total déclaré, **informatif**. Il agrège des formes qui n'ont pas le
   * même statut ; il ne remplace jamais le delta-9 et n'est confronté à aucun
   * plafond par ce module.
   */
  readonly totalThcPercent: number | null;
  readonly cbdContent: number | null;
  readonly issuedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly documentKinds: readonly ComplianceDocumentKind[];
}

export interface SubmissionReadiness {
  readonly complete: boolean;
  readonly gaps: readonly SubmissionGap[];
}

const blank = (value: string | null): boolean => value === null || value.trim() === "";

/**
 * Vérifie qu'un dossier est **déposable**, pas qu'il est conforme.
 *
 * La conformité est jugée par un humain. Ce que cette fonction empêche, c'est
 * qu'un dossier vide arrive sur le bureau de ce relecteur : sans COA, sans lot
 * et sans taux déclarés, il n'y a rien à vérifier, et le refus qui suivra aura
 * coûté un aller-retour à tout le monde.
 *
 * L'exigence d'un certificat d'analyse est une **règle de la plateforme**, pas
 * une affirmation réglementaire : nous refusons de faire circuler un produit
 * dont personne n'a analysé le contenu. Ce qu'un COA doit contenir légalement
 * reste à confirmer (décision 10).
 */
/** Une mesure exploitable : finie, positive, exprimée en pourcentage. */
function mesureExploitable(valeur: number | null): boolean {
  return valeur === null || (Number.isFinite(valeur) && valeur >= 0 && valeur <= 100);
}

export function checkComplianceSubmission(
  submission: ComplianceSubmission,
  now: Date,
): SubmissionReadiness {
  const gaps: SubmissionGap[] = [];

  if (blank(submission.productName)) gaps.push("MISSING_NAME");
  if (!submission.documentKinds.includes("CERTIFICATE_OF_ANALYSIS")) {
    gaps.push("MISSING_CERTIFICATE_OF_ANALYSIS");
  }
  // Un certificat sans émetteur identifié n'engage personne : il n'y a alors
  // rien à recontacter en cas de doute, ni personne à opposer.
  if (blank(submission.laboratory)) gaps.push("MISSING_LABORATORY");
  if (blank(submission.batchNumber)) gaps.push("MISSING_BATCH_NUMBER");
  if (blank(submission.supplier)) gaps.push("MISSING_SUPPLIER");

  if (submission.delta9ThcPercent === null || submission.cbdContent === null) {
    gaps.push("MISSING_DECLARED_CONTENTS");
  }
  // Séparé de l'absence : « pas déclaré » et « déclaré n'importe comment » se
  // corrigent différemment. `NaN`, négatif et au-delà de cent tombent ici.
  if (
    !mesureExploitable(submission.delta9ThcPercent) ||
    !mesureExploitable(submission.totalThcPercent) ||
    !mesureExploitable(submission.cbdContent)
  ) {
    gaps.push("INVALID_MEASUREMENT");
  }

  const issuedAt = submission.issuedAt;
  if (issuedAt === null) {
    gaps.push("MISSING_ISSUE_DATE");
  } else if (Number.isNaN(issuedAt.getTime())) {
    gaps.push("INVALID_ISSUE_DATE");
  } else if (issuedAt.getTime() > now.getTime()) {
    // Une analyse ne peut pas avoir été faite demain.
    gaps.push("ISSUE_DATE_IN_FUTURE");
  }

  // Un certificat déjà périmé au dépôt n'est pas un dossier à corriger plus
  // tard : il est faux dès maintenant.
  const expiresAt = submission.expiresAt;
  if (expiresAt !== null) {
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
      gaps.push("CERTIFICATE_ALREADY_EXPIRED");
    }
  }

  return { complete: gaps.length === 0, gaps };
}

/*
 * `evaluateProductAvailability()` vivait ici, avec sa liste
 * `AVAILABILITY_BLOCKERS`. Supprimée pour la même raison qu'`isOrderable` :
 * elle ignorait le KYB et toute la politique de catalogue, tout en étant
 * exportée à côté du portail complet. Voir `listing-gate.ts`.
 */
