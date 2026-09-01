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

export const SUBMISSION_GAPS = [
  "MISSING_NAME",
  "MISSING_CERTIFICATE_OF_ANALYSIS",
  "MISSING_BATCH_NUMBER",
  "MISSING_SUPPLIER",
  "MISSING_DECLARED_CONTENTS",
  "CERTIFICATE_ALREADY_EXPIRED",
] as const;

export type SubmissionGap = (typeof SUBMISSION_GAPS)[number];

export const SUBMISSION_GAP_LABEL_FR: Record<SubmissionGap, string> = {
  MISSING_NAME: "Nom de produit absent",
  MISSING_CERTIFICATE_OF_ANALYSIS: "Aucun certificat d'analyse joint",
  MISSING_BATCH_NUMBER: "Numéro de lot absent",
  MISSING_SUPPLIER: "Fournisseur non renseigné",
  MISSING_DECLARED_CONTENTS: "Taux THC et CBD non déclarés",
  CERTIFICATE_ALREADY_EXPIRED: "Le certificat fourni est déjà expiré",
};

export interface ComplianceSubmission {
  readonly productName: string | null;
  readonly batchNumber: string | null;
  readonly supplier: string | null;
  /** Taux déclarés, tels que fournis. Aucun seuil ne leur est appliqué ici. */
  readonly thcContent: number | null;
  readonly cbdContent: number | null;
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
export function checkComplianceSubmission(
  submission: ComplianceSubmission,
  now: Date,
): SubmissionReadiness {
  const gaps: SubmissionGap[] = [];

  if (blank(submission.productName)) gaps.push("MISSING_NAME");
  if (!submission.documentKinds.includes("CERTIFICATE_OF_ANALYSIS")) {
    gaps.push("MISSING_CERTIFICATE_OF_ANALYSIS");
  }
  if (blank(submission.batchNumber)) gaps.push("MISSING_BATCH_NUMBER");
  if (blank(submission.supplier)) gaps.push("MISSING_SUPPLIER");
  if (submission.thcContent === null || submission.cbdContent === null) {
    gaps.push("MISSING_DECLARED_CONTENTS");
  }
  // Un certificat déjà périmé au dépôt n'est pas un dossier à corriger plus
  // tard : il est faux dès maintenant.
  if (submission.expiresAt !== null && submission.expiresAt.getTime() <= now.getTime()) {
    gaps.push("CERTIFICATE_ALREADY_EXPIRED");
  }

  return { complete: gaps.length === 0, gaps };
}

/*
 * `evaluateProductAvailability()` vivait ici, avec sa liste
 * `AVAILABILITY_BLOCKERS`. Supprimée pour la même raison qu'`isOrderable` :
 * elle ignorait le KYB et toute la politique de catalogue, tout en étant
 * exportée à côté du portail complet. Voir `listing-gate.ts`.
 */
