/**
 * Politique de catalogue : ce que la plateforme accepte de faire circuler.
 *
 * **Ce module ne contient aucune règle de droit.** Il contient le mécanisme qui
 * applique une politique, et cette politique est une donnée fournie par
 * l'exploitant — jamais une constante ici. Aucun seuil, aucune catégorie, aucune
 * substance n'est écrite en dur : les valeurs réglementaires ne sont pas
 * arrêtées (docs/TO_VERIFY.md, décisions 03 et 10), et les figer dans du code
 * reviendrait à affirmer un droit que nous n'avons pas vérifié.
 *
 * Trois principes gouvernent tout le fichier.
 *
 * **1. Trois réponses, pas deux.** Une catégorie ou un analyte est autorisé,
 * interdit, ou *non tranché*. Le troisième cas est le plus important : c'est
 * celui qui existe réellement aujourd'hui, sur presque tout. Le confondre avec
 * « autorisé » ferait vendre par défaut ce que personne n'a examiné.
 *
 * **2. Le silence bloque.** L'absence de décision n'autorise rien. Une politique
 * vide interdit tout, ce qui est le comportement correct d'un système qui ne
 * sait pas encore.
 *
 * **3. Asymétrie assumée entre autoriser et interdire.** Autoriser exige au
 * moins une preuve juridique vérifiée ; interdire n'exige rien. Refuser de
 * vendre n'a jamais besoin d'être justifié par une source — se tromper dans ce
 * sens coûte une vente, se tromper dans l'autre coûte autre chose.
 */

// ---------------------------------------------------------------------------
// Preuves juridiques
// ---------------------------------------------------------------------------

export const LEGAL_EVIDENCE_KINDS = [
  "STATUTE",
  "CASE_LAW",
  "REGULATOR_GUIDANCE",
  "OFFICIAL_PUBLICATION",
  "LEGAL_OPINION",
] as const;

export type LegalEvidenceKind = (typeof LEGAL_EVIDENCE_KINDS)[number];

/**
 * Cycle de vie d'une preuve.
 *
 * `SUPERSEDED` n'est pas `UNVERIFIED` : une source remplacée a été vérifiée, et
 * l'écraser effacerait la raison pour laquelle une décision passée avait été
 * prise. Elle cesse de soutenir une autorisation sans disparaître de
 * l'historique.
 */
export const LEGAL_EVIDENCE_STATUSES = ["UNVERIFIED", "VERIFIED", "SUPERSEDED"] as const;

export type LegalEvidenceStatus = (typeof LEGAL_EVIDENCE_STATUSES)[number];

export interface LegalEvidence {
  readonly id: string;
  readonly kind: LegalEvidenceKind;
  /** Référence citable : article, numéro d'affaire, intitulé de publication. */
  readonly reference: string;
  readonly sourceUrl: string | null;
  readonly status: LegalEvidenceStatus;
  readonly verifiedAt: Date | null;
  /** Qui a vérifié. Une preuve sans vérificateur nommé n'est pas une preuve. */
  readonly verifiedBy: string | null;
}

/**
 * Seule une preuve `VERIFIED` **et** attribuée soutient une autorisation.
 *
 * Le statut seul ne suffit pas : une ligne marquée vérifiée sans date ni auteur
 * est une case cochée, pas une vérification. Exiger les trois rend le raccourci
 * impossible.
 */
export function supportsAuthorisation(evidence: LegalEvidence): boolean {
  return (
    evidence.status === "VERIFIED" &&
    evidence.verifiedAt !== null &&
    evidence.verifiedBy !== null &&
    evidence.verifiedBy.trim() !== ""
  );
}

// ---------------------------------------------------------------------------
// Décisions
// ---------------------------------------------------------------------------

export const POLICY_DECISIONS = ["ALLOWED", "PROHIBITED", "UNDECIDED"] as const;

export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

export interface CategoryRule {
  readonly categorySlug: string;
  /** `UNDECIDED` ne s'écrit pas : c'est l'absence de règle. */
  readonly decision: "ALLOWED" | "PROHIBITED";
  readonly evidenceIds: readonly string[];
  readonly decidedAt: Date;
  readonly note: string | null;
}

export interface SubstanceRule {
  /** Nom normalisé, comparé sans casse ni espaces superflus. */
  readonly substance: string;
  readonly evidenceIds: readonly string[];
  readonly decidedAt: Date;
}

/**
 * Contrainte sur un analyte mesuré — un taux déclaré au certificat d'analyse.
 *
 * `RESTRICTED` porte un plafond et exige une preuve vérifiée : c'est une
 * affirmation sur le droit applicable. `UNRESTRICTED` déclare explicitement
 * qu'aucun plafond de plateforme ne s'applique — un acte conscient, pas un
 * oubli. L'absence des deux vaut `UNDECIDED`.
 */
export interface AnalyteRule {
  readonly analyte: string;
  readonly decision: "RESTRICTED" | "UNRESTRICTED";
  /** Plafond en pourcentage, requis si `RESTRICTED`, ignoré sinon. */
  readonly maxPercent: number | null;
  readonly evidenceIds: readonly string[];
  readonly decidedAt: Date;
}

export interface CataloguePolicy {
  readonly evidence: readonly LegalEvidence[];
  readonly categories: readonly CategoryRule[];
  readonly prohibitedSubstances: readonly SubstanceRule[];
  readonly analytes: readonly AnalyteRule[];
}

/**
 * Politique vide : elle interdit tout.
 *
 * Existe pour être le point de départ d'un environnement neuf, et pour que les
 * tests aient un défaut sans surprise. Une politique vide qui autoriserait tout
 * serait un piège de configuration.
 */
export const EMPTY_CATALOGUE_POLICY: CataloguePolicy = {
  evidence: [],
  categories: [],
  prohibitedSubstances: [],
  analytes: [],
};

const normalise = (value: string): string => value.trim().toLowerCase();

function verifiedEvidence(
  policy: CataloguePolicy,
  evidenceIds: readonly string[],
): readonly LegalEvidence[] {
  return policy.evidence.filter(
    (evidence) => evidenceIds.includes(evidence.id) && supportsAuthorisation(evidence),
  );
}

// ---------------------------------------------------------------------------
// Catégories
// ---------------------------------------------------------------------------

export type CategoryVerdict =
  | { readonly decision: "ALLOWED"; readonly evidence: readonly LegalEvidence[] }
  | { readonly decision: "PROHIBITED"; readonly rule: CategoryRule }
  | {
      readonly decision: "UNDECIDED";
      /** Pourquoi non tranché : jamais examiné, ou autorisé sans preuve tenable. */
      readonly cause: "NO_RULE" | "AUTHORISATION_UNSUPPORTED";
    };

/**
 * Statue sur une catégorie.
 *
 * Le cas qui mérite l'attention est `AUTHORISATION_UNSUPPORTED` : une règle dit
 * « autorisé », mais aucune preuve vérifiée ne la soutient — parce qu'elle n'en
 * a jamais eu, ou parce que la sienne a été remplacée depuis. Le résultat n'est
 * alors ni « autorisé » ni « interdit » : c'est un dossier redevenu ouvert, et
 * le dire ainsi permet de le rouvrir au lieu de le subir.
 */
export function decideCategory(policy: CataloguePolicy, categorySlug: string): CategoryVerdict {
  const cible = normalise(categorySlug);
  const rule = policy.categories.find((candidate) => normalise(candidate.categorySlug) === cible);

  if (!rule) return { decision: "UNDECIDED", cause: "NO_RULE" };
  if (rule.decision === "PROHIBITED") return { decision: "PROHIBITED", rule };

  const evidence = verifiedEvidence(policy, rule.evidenceIds);
  if (evidence.length === 0) {
    return { decision: "UNDECIDED", cause: "AUTHORISATION_UNSUPPORTED" };
  }
  return { decision: "ALLOWED", evidence };
}

// ---------------------------------------------------------------------------
// Substances prohibées
// ---------------------------------------------------------------------------

/**
 * Substances interdites présentes dans une composition déclarée.
 *
 * Liste de refus, pas d'autorisation : une substance absente de la liste n'est
 * pas suspecte par défaut. C'est l'inverse des catégories, et la différence est
 * volontaire — on ne peut pas énumérer tout ce qui est licite, on peut énumérer
 * ce qui ne l'est pas.
 *
 * Rend **toutes** les substances trouvées, pas la première : un exploitant qui
 * retire un ingrédient à la fois pour découvrir le suivant ne comprend pas son
 * refus.
 */
export function findProhibitedSubstances(
  policy: CataloguePolicy,
  declaredComposition: readonly string[],
): readonly string[] {
  const déclarées = declaredComposition.map(normalise);
  return policy.prohibitedSubstances
    .filter((rule) => déclarées.includes(normalise(rule.substance)))
    .map((rule) => rule.substance);
}

// ---------------------------------------------------------------------------
// Analytes mesurés
// ---------------------------------------------------------------------------

export type AnalyteVerdict =
  | { readonly analyte: string; readonly decision: "WITHIN_LIMIT"; readonly maxPercent: number }
  | {
      readonly analyte: string;
      readonly decision: "ABOVE_LIMIT";
      readonly declaredPercent: number;
      readonly maxPercent: number;
    }
  | { readonly analyte: string; readonly decision: "UNRESTRICTED" }
  | {
      readonly analyte: string;
      readonly decision: "UNDECIDED";
      readonly cause: "NO_RULE" | "RESTRICTION_UNSUPPORTED" | "NO_LIMIT_SET";
    };

export interface DeclaredAnalyte {
  readonly analyte: string;
  readonly percent: number;
}

/**
 * Confronte un taux déclaré à la politique.
 *
 * Aucun plafond n'est connu de ce module : il applique celui qu'on lui donne, et
 * refuse de statuer quand on ne lui en donne pas. C'est ce refus qui garantit
 * qu'aucun seuil ne s'est glissé dans le code sans avoir été décidé.
 *
 * Un plafond n'est opposable que s'il est soutenu par une preuve vérifiée :
 * bloquer un produit sur un chiffre que personne ne peut sourcer serait aussi
 * peu défendable que le laisser passer.
 */
export function decideAnalyte(
  policy: CataloguePolicy,
  declared: DeclaredAnalyte,
): AnalyteVerdict {
  const cible = normalise(declared.analyte);
  const rule = policy.analytes.find((candidate) => normalise(candidate.analyte) === cible);

  if (!rule) return { analyte: declared.analyte, decision: "UNDECIDED", cause: "NO_RULE" };

  if (rule.decision === "UNRESTRICTED") {
    return { analyte: declared.analyte, decision: "UNRESTRICTED" };
  }

  if (verifiedEvidence(policy, rule.evidenceIds).length === 0) {
    return {
      analyte: declared.analyte,
      decision: "UNDECIDED",
      cause: "RESTRICTION_UNSUPPORTED",
    };
  }

  if (rule.maxPercent === null) {
    return { analyte: declared.analyte, decision: "UNDECIDED", cause: "NO_LIMIT_SET" };
  }

  // Strictement supérieur : un taux exactement égal au plafond respecte le
  // plafond. L'inverse transformerait « au plus 0,3 % » en « moins de 0,3 % »,
  // ce qui n'est pas la même règle.
  if (declared.percent > rule.maxPercent) {
    return {
      analyte: declared.analyte,
      decision: "ABOVE_LIMIT",
      declaredPercent: declared.percent,
      maxPercent: rule.maxPercent,
    };
  }

  return { analyte: declared.analyte, decision: "WITHIN_LIMIT", maxPercent: rule.maxPercent };
}
