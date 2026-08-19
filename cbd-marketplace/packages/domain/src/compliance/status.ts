/**
 * Statut de conformité d'un produit.
 *
 * Cette machine est indépendante du catalogue commercial : un produit peut être
 * en stock, correctement prixé et visible en back-office shop tout en étant
 * interdit à la vente parce que sa conformité n'est pas validée.
 *
 * Les seuils réglementaires eux-mêmes (taux THC, mentions obligatoires) ne sont
 * PAS codés ici — ils sont à confirmer auprès de sources officielles
 * (docs/TO_VERIFY.md, décision 10) et seront des paramètres vérifiables, pas des
 * constantes en dur.
 */

import type { Actor } from "../roles.js";

export const COMPLIANCE_STATUSES = [
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
  "EXPIRED",
] as const;

export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export interface ComplianceTransition {
  readonly from: ComplianceStatus;
  readonly to: ComplianceStatus;
  readonly actors: readonly Actor[];
  readonly reason: string;
}

export const COMPLIANCE_TRANSITIONS: readonly ComplianceTransition[] = [
  { from: "PENDING_REVIEW", to: "APPROVED", actors: ["admin"], reason: "Dossier vérifié et conforme." },
  { from: "PENDING_REVIEW", to: "REJECTED", actors: ["admin"], reason: "Dossier incomplet ou non conforme." },
  { from: "APPROVED", to: "SUSPENDED", actors: ["admin"], reason: "Suspension immédiate (doute, signalement, rappel de lot)." },
  { from: "APPROVED", to: "EXPIRED", actors: ["system", "admin"], reason: "Date de validité du certificat dépassée." },
  { from: "SUSPENDED", to: "APPROVED", actors: ["admin"], reason: "Levée de suspension après vérification." },
  { from: "SUSPENDED", to: "REJECTED", actors: ["admin"], reason: "Suspension confirmée en refus définitif." },
  { from: "EXPIRED", to: "PENDING_REVIEW", actors: ["merchant_owner", "merchant_staff", "admin"], reason: "Nouveaux documents déposés." },
  { from: "REJECTED", to: "PENDING_REVIEW", actors: ["merchant_owner", "merchant_staff", "admin"], reason: "Dossier corrigé et resoumis." },
];

export function findComplianceTransition(
  from: ComplianceStatus,
  to: ComplianceStatus,
): ComplianceTransition | undefined {
  return COMPLIANCE_TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export function canChangeCompliance(from: ComplianceStatus, to: ComplianceStatus, actor: Actor): boolean {
  const transition = findComplianceTransition(from, to);
  return transition !== undefined && transition.actors.includes(actor);
}

/**
 * La règle non négociable du projet : seul `APPROVED` autorise la vente.
 *
 * Tout code qui construit une liste de produits commandables passe par ici.
 * Ne jamais dupliquer ce test ailleurs sous une autre forme — c'est ainsi que
 * les régressions de conformité arrivent.
 */
export function isSellable(status: ComplianceStatus): boolean {
  return status === "APPROVED";
}

/**
 * Un produit est réellement commandable s'il est conforme ET disponible chez ce
 * shop précis. La disponibilité vient de `Inventory` (par MerchantLocation),
 * jamais du catalogue global.
 */
export function isOrderable(input: {
  readonly compliance: ComplianceStatus;
  readonly stock: number;
  readonly listedByMerchant: boolean;
}): boolean {
  return isSellable(input.compliance) && input.listedByMerchant && input.stock > 0;
}

export const COMPLIANCE_STATUS_LABEL_FR: Record<ComplianceStatus, string> = {
  PENDING_REVIEW: "En cours de vérification",
  APPROVED: "Conforme",
  REJECTED: "Refusé",
  SUSPENDED: "Suspendu",
  EXPIRED: "Certificat expiré",
};
