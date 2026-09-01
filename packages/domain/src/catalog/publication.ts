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

import { isSellable, type ComplianceStatus } from "../compliance/status.js";
import { canSell, type MerchantStatus } from "../merchant/status.js";

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

// ---------------------------------------------------------------------------
// Mise à disposition d'un produit
// ---------------------------------------------------------------------------

export const AVAILABILITY_BLOCKERS = [
  "MERCHANT_NOT_ACTIVE",
  "COMPLIANCE_NOT_APPROVED",
  "COMPLIANCE_EXPIRED",
  "NOT_LISTED",
  "OUT_OF_STOCK",
  "NO_PRICE",
] as const;

export type AvailabilityBlocker = (typeof AVAILABILITY_BLOCKERS)[number];

export const AVAILABILITY_BLOCKER_LABEL_FR: Record<AvailabilityBlocker, string> = {
  MERCHANT_NOT_ACTIVE: "Le shop n'est pas actif",
  COMPLIANCE_NOT_APPROVED: "La conformité du produit n'est pas validée",
  COMPLIANCE_EXPIRED: "Le certificat de conformité est expiré",
  NOT_LISTED: "Le produit n'est pas mis en vente par le shop",
  OUT_OF_STOCK: "Produit en rupture",
  NO_PRICE: "Aucun prix défini",
};

export interface ProductAvailabilityInput {
  readonly merchantStatus: MerchantStatus;
  readonly complianceStatus: ComplianceStatus;
  /** Fin de validité du certificat, ou `null` s'il n'en porte pas. */
  readonly complianceExpiresAt: Date | null;
  readonly isListed: boolean;
  readonly stock: number;
  readonly priceCents: number | null;
}

export interface ProductAvailability {
  readonly orderable: boolean;
  readonly blockers: readonly AvailabilityBlocker[];
}

/**
 * Dit si un produit est commandable, et sinon **tout** ce qui l'en empêche.
 *
 * L'expiration est traitée à part du statut : un certificat périmé sur un
 * produit encore marqué `APPROVED` est le cas le plus dangereux du lot, parce
 * qu'il ressemble à un produit conforme. Il est bloqué ici sans attendre que la
 * tâche de fond ait basculé le statut en `EXPIRED` — une garde qui dépend d'un
 * cron n'est pas une garde.
 */
export function evaluateProductAvailability(
  input: ProductAvailabilityInput,
  now: Date,
): ProductAvailability {
  const blockers: AvailabilityBlocker[] = [];

  if (!canSell(input.merchantStatus)) blockers.push("MERCHANT_NOT_ACTIVE");
  if (!isSellable(input.complianceStatus)) blockers.push("COMPLIANCE_NOT_APPROVED");
  if (
    input.complianceExpiresAt !== null &&
    input.complianceExpiresAt.getTime() <= now.getTime()
  ) {
    blockers.push("COMPLIANCE_EXPIRED");
  }
  if (!input.isListed) blockers.push("NOT_LISTED");
  if (input.stock <= 0) blockers.push("OUT_OF_STOCK");
  if (input.priceCents === null || input.priceCents <= 0) blockers.push("NO_PRICE");

  return { orderable: blockers.length === 0, blockers };
}
