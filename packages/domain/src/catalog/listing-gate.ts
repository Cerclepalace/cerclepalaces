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
  DELTA9_THC_ANALYTE,
  TOTAL_THC_ANALYTE,
  checkComplianceSubmission,
  type ComplianceSubmission,
} from "./publication.js";
import {
  checkPolicyFreshness,
  decideAnalyte,
  evaluateConditionalAnalytes,
  decideCategory,
  findProhibitedSubstances,
  normaliseSubstance,
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
  "SUBMISSION_INCOMPLETE",
  // --- Politique de catalogue ---
  "POLICY_STALE",
  "CATEGORY_MISSING",
  "CATEGORY_UNKNOWN",
  "CATEGORY_UNCLASSIFIED",
  "CATEGORY_PROHIBITED",
  "CATEGORY_UNDECIDED",
  "COMPOSITION_NOT_DECLARED",
  "SUBSTANCE_PROHIBITED",
  "ANALYTE_NOT_DECLARED",
  "ANALYTE_ABOVE_LIMIT",
  "ANALYTE_UNDECIDED",
  "CONDITIONAL_ANALYTE_MISSING",
  "CONDITIONAL_RULE_UNSUPPORTED",
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
  SUBMISSION_INCOMPLETE: "Le dossier de conformité est incomplet",
  POLICY_STALE: "La politique de catalogue n'a pas été revue à temps",
  CATEGORY_MISSING: "Le produit n'est rattaché à aucune catégorie",
  CATEGORY_UNKNOWN: "La valeur déclarée n'est pas une catégorie de la taxonomie",
  CATEGORY_UNCLASSIFIED: "Le produit n'est pas classé (catégorie OTHER)",
  CATEGORY_PROHIBITED: "Cette catégorie n'est pas distribuée par la plateforme",
  CATEGORY_UNDECIDED: "Cette catégorie n'a pas encore été tranchée",
  COMPOSITION_NOT_DECLARED: "Aucune composition n'est déclarée",
  SUBSTANCE_PROHIBITED: "La composition déclare une substance non distribuée",
  ANALYTE_NOT_DECLARED: "Un analyte encadré par la politique n'est pas mesuré",
  ANALYTE_ABOVE_LIMIT: "Un taux déclaré dépasse le plafond de la politique",
  ANALYTE_UNDECIDED: "Un taux déclaré relève d'une règle non tranchée",
  CONDITIONAL_ANALYTE_MISSING: "Une analyse rendue obligatoire par une autre est absente",
  CONDITIONAL_RULE_UNSUPPORTED: "Une dépendance entre analyses n'est soutenue par aucune preuve",
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
  /**
   * Le dossier réellement déposé.
   *
   * Exigé ici parce qu'un audit a montré que `checkComplianceSubmission` n'était
   * appelée nulle part : un produit pouvait être `APPROVED` sans qu'aucun
   * dossier — certificat d'analyse, lot, fournisseur — n'ait jamais été
   * contrôlé. Un statut est le résultat d'un examen, pas sa preuve.
   */
  readonly submission: ComplianceSubmission;
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
  const dossier = checkComplianceSubmission(candidate.submission, now);
  if (!dossier.complete) {
    refuse("SUBMISSION_INCOMPLETE", `Dossier incomplet : ${dossier.gaps.join(", ")}.`);
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
  // La fraîcheur est contrôlée avant le contenu : appliquer une politique
  // périmée avec assurance serait pire que de la déclarer périmée.
  const fraîcheur = checkPolicyFreshness(policy, now);
  if (!fraîcheur.fresh) {
    refuse(
      "POLICY_STALE",
      fraîcheur.cause === "NEVER_REVIEWED"
        ? "La politique n'a jamais été revue."
        : "La revue de politique est en retard.",
    );
  }

  if (candidate.categorySlug === null || candidate.categorySlug.trim() === "") {
    refuse("CATEGORY_MISSING", "Aucune catégorie n'est rattachée au produit.");
  } else {
    // Quatre refus distincts, parce qu'ils se corrigent de quatre façons :
    // saisir une valeur de la taxonomie, classer le produit, obtenir une
    // décision, ou renoncer. Les fondre en un seul enverrait chercher au
    // mauvais endroit.
    const verdict = decideCategory(policy, candidate.categorySlug, now);
    const étiquette = `Catégorie « ${candidate.categorySlug} »`;

    if (verdict.decision === "PROHIBITED") {
      refuse(
        "CATEGORY_PROHIBITED",
        verdict.rule === null
          ? `${étiquette} fermée par construction : aucune politique ne peut l'ouvrir.`
          : `${étiquette} écartée par la politique.`,
      );
    } else if (verdict.decision === "UNDECIDED") {
      if (verdict.cause === "NOT_A_CATEGORY") {
        refuse("CATEGORY_UNKNOWN", `${étiquette} ne fait pas partie de la taxonomie produit.`);
      } else if (verdict.cause === "UNCLASSIFIED") {
        refuse("CATEGORY_UNCLASSIFIED", "Le produit attend un classement : OTHER ne s'ouvre pas.");
      } else if (verdict.cause === "NO_RULE") {
        refuse("CATEGORY_UNDECIDED", `${étiquette} jamais examinée.`);
      } else {
        refuse(
          "CATEGORY_UNDECIDED",
          `${étiquette} autorisée sans preuve juridique vérifiée en vigueur.`,
        );
      }
    }
  }

  // Une composition vide n'est pas une composition propre : sans déclaration,
  // la liste de refus n'a rien à examiner et laisse tout passer.
  const compositionUtile = candidate.declaredComposition.filter(
    (ligne) => ligne.trim() !== "",
  );
  if (compositionUtile.length === 0) {
    refuse("COMPOSITION_NOT_DECLARED", "La composition déclarée est vide.");
  }

  for (const substance of findProhibitedSubstances(policy, compositionUtile)) {
    refuse("SUBSTANCE_PROHIBITED", `Substance déclarée : ${substance}.`);
  }

  // Chaque analyte que la politique encadre doit être **mesuré**. Sans cette
  // exigence, ne rien déclarer suffisait à sauter entièrement le contrôle des
  // plafonds — le produit passait avec zéro analyse.
  // Le certificat porte deux mesures de THC qui ne se substituent pas : le
  // delta-9, sur lequel un plafond peut porter, et le total, informatif. Elles
  // rejoignent les analytes déclarés sous leurs noms canoniques pour que la
  // politique puisse encadrer l'un sans encadrer l'autre.
  const analytesÀÉvaluer: readonly DeclaredAnalyte[] = [
    ...candidate.declaredAnalytes,
    ...(candidate.submission.delta9ThcPercent === null
      ? []
      : [{ analyte: DELTA9_THC_ANALYTE, percent: candidate.submission.delta9ThcPercent }]),
    ...(candidate.submission.totalThcPercent === null
      ? []
      : [{ analyte: TOTAL_THC_ANALYTE, percent: candidate.submission.totalThcPercent }]),
  ];

  const mesurés = new Set(
    analytesÀÉvaluer.map((declared) => normaliseSubstance(declared.analyte)),
  );
  for (const rule of policy.analytes) {
    if (rule.decision !== "RESTRICTED") continue;
    if (!mesurés.has(normaliseSubstance(rule.analyte))) {
      refuse("ANALYTE_NOT_DECLARED", `${rule.analyte} n'est pas mesuré au dossier.`);
    }
  }

  for (const declared of analytesÀÉvaluer) {
    const verdict = decideAnalyte(policy, declared, now);
    if (verdict.decision === "ABOVE_LIMIT") {
      refuse(
        "ANALYTE_ABOVE_LIMIT",
        `${verdict.analyte} déclaré à ${verdict.declaredPercent} %, plafond ${verdict.maxPercent} %.`,
      );
    } else if (verdict.decision === "UNDECIDED") {
      refuse("ANALYTE_UNDECIDED", `${verdict.analyte} : ${verdict.cause}.`);
    }
  }

  // Dépendances entre analyses : toutes évaluées, aucune n'interrompt les
  // suivantes.
  for (const exigence of evaluateConditionalAnalytes(policy, analytesÀÉvaluer, now)) {
    if (exigence.outcome === "MISSING_ANALYTE") {
      refuse(
        "CONDITIONAL_ANALYTE_MISSING",
        `${exigence.triggeredBy} déclenche ${exigence.ruleId} : ${exigence.missing.join(", ")} manquant(s).`,
      );
    } else if (exigence.outcome === "UNSUPPORTED") {
      refuse(
        "CONDITIONAL_RULE_UNSUPPORTED",
        `${exigence.ruleId}, déclenchée par ${exigence.triggeredBy}, n'a aucune preuve vérifiée.`,
      );
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
