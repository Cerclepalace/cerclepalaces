/**
 * Le portail de mise en vente.
 *
 * Un produit franchit **une seule porte**, pas six. Ce module rassemble toutes
 * les conditions déjà écrites ailleurs — état du vendeur, complétude du KYB,
 * conformité du produit, politique de catalogue, disponibilité commerciale — et
 * rend un verdict unique accompagné de **tous** les motifs de refus.
 *
 * Pourquoi tout rassembler ici. Ces règles ont des auteurs différents et des
 * rythmes différents : le KYB bouge quand un commerçant complète son dossier, la
 * conformité quand un relecteur tranche, la politique quand une source juridique
 * est publiée. Éparpiller la décision finale garantit qu'un jour l'une d'elles
 * sera oubliée sur un chemin. Il n'y a donc qu'un chemin.
 *
 * Ce module **ne décide rien lui-même** : il compose. Chaque règle reste testée
 * là où elle vit ; ce fichier vérifie qu'elles sont toutes consultées, dans le
 * bon ordre, et qu'aucun motif n'est perdu en route.
 */

import { isSellable, type ComplianceStatus } from "../compliance/status.js";
import { canSell, checkKybDossier, type KybDossier, type MerchantStatus } from "../merchant/status.js";
import {
  decideAnalyte,
  decideCategory,
  findProhibitedSubstances,
  type CataloguePolicy,
  type DeclaredAnalyte,
} from "./policy.js";

export const LISTING_BLOCKERS = [
  // --- Vendeur ---
  "MERCHANT_NOT_ACTIVE",
  "MERCHANT_KYB_INCOMPLETE",
  // --- Conformité du produit ---
  "COMPLIANCE_NOT_APPROVED",
  "COMPLIANCE_EXPIRED",
  // --- Politique de catalogue ---
  "CATEGORY_MISSING",
  "CATEGORY_PROHIBITED",
  "CATEGORY_UNDECIDED",
  "SUBSTANCE_PROHIBITED",
  "ANALYTE_ABOVE_LIMIT",
  "ANALYTE_UNDECIDED",
  // --- Disponibilité commerciale ---
  "NOT_LISTED",
  "OUT_OF_STOCK",
  "NO_PRICE",
] as const;

export type ListingBlocker = (typeof LISTING_BLOCKERS)[number];

export const LISTING_BLOCKER_LABEL_FR: Record<ListingBlocker, string> = {
  MERCHANT_NOT_ACTIVE: "Le shop n'est pas actif",
  MERCHANT_KYB_INCOMPLETE: "Le dossier du shop est incomplet",
  COMPLIANCE_NOT_APPROVED: "La conformité du produit n'est pas validée",
  COMPLIANCE_EXPIRED: "Le certificat de conformité est expiré",
  CATEGORY_MISSING: "Le produit n'est rattaché à aucune catégorie",
  CATEGORY_PROHIBITED: "Cette catégorie n'est pas distribuée par la plateforme",
  CATEGORY_UNDECIDED: "Cette catégorie n'a pas encore été tranchée",
  SUBSTANCE_PROHIBITED: "La composition déclare une substance non distribuée",
  ANALYTE_ABOVE_LIMIT: "Un taux déclaré dépasse le plafond de la politique",
  ANALYTE_UNDECIDED: "Un taux déclaré relève d'une règle non tranchée",
  NOT_LISTED: "Le produit n'est pas mis en vente par le shop",
  OUT_OF_STOCK: "Produit en rupture",
  NO_PRICE: "Aucun prix défini",
};

/**
 * Détail attaché à un motif de refus.
 *
 * Un motif sans son détail est inexploitable : « un taux dépasse le plafond »
 * n'aide personne si on ne dit pas lequel, ni de combien.
 */
export interface ListingFinding {
  readonly blocker: ListingBlocker;
  readonly detail: string;
}

export interface ListingCandidate {
  readonly merchantStatus: MerchantStatus;
  readonly kyb: KybDossier;
  readonly complianceStatus: ComplianceStatus;
  readonly complianceExpiresAt: Date | null;
  /** `null` si le produit n'est rattaché à aucune catégorie. */
  readonly categorySlug: string | null;
  readonly declaredComposition: readonly string[];
  readonly declaredAnalytes: readonly DeclaredAnalyte[];
  readonly isListed: boolean;
  readonly stock: number;
  readonly priceCents: number | null;
}

export interface ListingVerdict {
  readonly listable: boolean;
  readonly findings: readonly ListingFinding[];
  /** Les motifs seuls, pour un test ou un filtre. Même ordre que `findings`. */
  readonly blockers: readonly ListingBlocker[];
}

/**
 * Statue sur la mise en vente d'un produit chez un shop donné.
 *
 * L'ordre des contrôles suit celui de la responsabilité : le vendeur d'abord, le
 * produit ensuite, la politique de la plateforme après, le commerce en dernier.
 * Un commerçant dont le shop est suspendu doit lire cela avant de lire qu'il lui
 * manque un prix.
 *
 * Tous les motifs sont rendus, jamais le premier : corriger un refus à la fois,
 * avec un aller-retour à chaque fois, fait abandonner.
 */
export function evaluateListing(
  candidate: ListingCandidate,
  policy: CataloguePolicy,
  now: Date,
): ListingVerdict {
  const findings: ListingFinding[] = [];
  const refuse = (blocker: ListingBlocker, detail: string): void => {
    findings.push({ blocker, detail });
  };

  // --- Vendeur ---
  if (!canSell(candidate.merchantStatus)) {
    refuse("MERCHANT_NOT_ACTIVE", `Statut du shop : ${candidate.merchantStatus}.`);
  }
  const kyb = checkKybDossier(candidate.kyb);
  if (!kyb.complete) {
    refuse("MERCHANT_KYB_INCOMPLETE", `Pièces manquantes : ${kyb.gaps.join(", ")}.`);
  }

  // --- Conformité du produit ---
  if (!isSellable(candidate.complianceStatus)) {
    refuse("COMPLIANCE_NOT_APPROVED", `Statut de conformité : ${candidate.complianceStatus}.`);
  }
  if (
    candidate.complianceExpiresAt !== null &&
    candidate.complianceExpiresAt.getTime() <= now.getTime()
  ) {
    // Vérifié sans attendre qu'une tâche de fond ait basculé le statut : une
    // garde qui dépend d'un cron n'est pas une garde.
    refuse(
      "COMPLIANCE_EXPIRED",
      `Certificat expiré le ${candidate.complianceExpiresAt.toISOString()}.`,
    );
  }

  // --- Politique de catalogue ---
  if (candidate.categorySlug === null || candidate.categorySlug.trim() === "") {
    refuse("CATEGORY_MISSING", "Aucune catégorie n'est rattachée au produit.");
  } else {
    const verdict = decideCategory(policy, candidate.categorySlug);
    if (verdict.decision === "PROHIBITED") {
      refuse("CATEGORY_PROHIBITED", `Catégorie « ${candidate.categorySlug} » écartée par la politique.`);
    } else if (verdict.decision === "UNDECIDED") {
      refuse(
        "CATEGORY_UNDECIDED",
        verdict.cause === "NO_RULE"
          ? `Catégorie « ${candidate.categorySlug} » jamais examinée.`
          : `Catégorie « ${candidate.categorySlug} » autorisée sans preuve juridique vérifiée en vigueur.`,
      );
    }
  }

  for (const substance of findProhibitedSubstances(policy, candidate.declaredComposition)) {
    refuse("SUBSTANCE_PROHIBITED", `Substance déclarée : ${substance}.`);
  }

  for (const declared of candidate.declaredAnalytes) {
    const verdict = decideAnalyte(policy, declared);
    if (verdict.decision === "ABOVE_LIMIT") {
      refuse(
        "ANALYTE_ABOVE_LIMIT",
        `${verdict.analyte} déclaré à ${verdict.declaredPercent} %, plafond ${verdict.maxPercent} %.`,
      );
    } else if (verdict.decision === "UNDECIDED") {
      refuse("ANALYTE_UNDECIDED", `${verdict.analyte} : ${verdict.cause}.`);
    }
  }

  // --- Disponibilité commerciale ---
  if (!candidate.isListed) refuse("NOT_LISTED", "Le shop n'a pas mis ce produit en vente.");
  if (candidate.stock <= 0) refuse("OUT_OF_STOCK", `Stock : ${candidate.stock}.`);
  if (candidate.priceCents === null || candidate.priceCents <= 0) {
    refuse("NO_PRICE", "Aucun prix strictement positif n'est défini.");
  }

  return {
    listable: findings.length === 0,
    findings,
    blockers: findings.map((finding) => finding.blocker),
  };
}
