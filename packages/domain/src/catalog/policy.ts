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
 * Seule une preuve `VERIFIED`, **datée dans le passé** et attribuée soutient une
 * autorisation.
 *
 * Le statut seul ne suffit pas : une ligne marquée vérifiée sans date ni auteur
 * est une case cochée, pas une vérification. Exiger les trois rend le raccourci
 * impossible.
 *
 * L'horloge est passée en argument parce qu'une vérification datée du futur
 * n'a pas eu lieu — un audit a montré qu'une preuve datée de 2099 soutenait une
 * autorisation. Une date invalide est traitée comme une absence de date.
 */
export function supportsAuthorisation(evidence: LegalEvidence, now: Date): boolean {
  if (evidence.status !== "VERIFIED") return false;
  if (evidence.verifiedBy === null || evidence.verifiedBy.trim() === "") return false;

  const verifiedAt = evidence.verifiedAt;
  if (verifiedAt === null || Number.isNaN(verifiedAt.getTime())) return false;
  if (verifiedAt.getTime() > now.getTime()) return false;

  return true;
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
  /** Nom canonique, tel qu'il sera affiché dans un motif de refus. */
  readonly substance: string;
  /**
   * Écritures alternatives de la même substance.
   *
   * Indispensable : la normalisation rattrape la casse, les accents, les tirets
   * et les espaces, mais pas les synonymes. « X-O » et « XO » se normalisent
   * identiquement ; « X-O » et « X acétate » non. Ce qu'une machine ne peut pas
   * déduire doit être écrit à la main, substance par substance.
   */
  readonly aliases: readonly string[];
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
  /**
   * Date de la dernière revue **complète** de cette politique.
   *
   * `null` signifie « jamais revue », pas « toujours valable ». Une liste de
   * substances interdites vieillit : de nouvelles molécules apparaissent plus
   * vite que les revues. Sans cette date, une politique figée en 2020 serait
   * traitée aujourd'hui comme une politique d'aujourd'hui.
   */
  readonly reviewedAt: Date | null;
  /**
   * Durée au-delà de laquelle la politique est considérée périmée, en jours.
   *
   * `null` désactive le contrôle — un choix qui doit être explicite, jamais un
   * oubli.
   */
  readonly maxAgeDays: number | null;
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
  reviewedAt: null,
  maxAgeDays: null,
};

export type PolicyFreshness =
  | { readonly fresh: true }
  | { readonly fresh: false; readonly cause: "NEVER_REVIEWED" | "REVIEW_OVERDUE" };

/**
 * Une politique jamais revue n'est pas fraîche.
 *
 * `maxAgeDays: null` laisse une politique datée vivre indéfiniment — c'est un
 * choix explicite. Une politique **sans date de revue** est en revanche toujours
 * périmée, quel que soit `maxAgeDays` : on ne peut pas garantir la fraîcheur de
 * quelque chose dont on ignore l'âge.
 */
export function checkPolicyFreshness(policy: CataloguePolicy, now: Date): PolicyFreshness {
  const reviewedAt = policy.reviewedAt;
  if (reviewedAt === null || Number.isNaN(reviewedAt.getTime())) {
    return { fresh: false, cause: "NEVER_REVIEWED" };
  }
  if (policy.maxAgeDays === null) return { fresh: true };

  const âgeJours = (now.getTime() - reviewedAt.getTime()) / 86_400_000;
  if (âgeJours > policy.maxAgeDays) return { fresh: false, cause: "REVIEW_OVERDUE" };
  return { fresh: true };
}

/**
 * Normalisation pour une liste d'**autorisation** — catégories, analytes.
 *
 * Volontairement conservatrice : ici, ne pas reconnaître une valeur la rend
 * *non tranchée*, donc bloquante. L'échec est du côté sûr.
 */
const normalise = (value: string): string => value.trim().toLowerCase();

/**
 * Normalisation pour une liste de **refus** — les substances.
 *
 * Beaucoup plus agressive que la précédente, et c'est délibéré : ici, ne pas
 * reconnaître une valeur la laisse **passer**. La même prudence produit des
 * conséquences opposées selon le sens de la liste, et un audit a montré que
 * quatre écritures d'une même substance — élision du tiret, espace à la place du
 * tiret, tiret demi-cadratin, homoglyphe grec — échappaient toutes à un simple
 * `trim().toLowerCase()`. Les deux dernières sont invisibles à l'œil.
 *
 * Ce que fait cette fonction : décomposition Unicode et suppression des
 * diacritiques, repli des homoglyphes grecs et cyrilliques usuels sur leur
 * équivalent latin, suppression de tout ce qui n'est ni lettre ni chiffre.
 * « X-O », « x o » et « X–Ο » deviennent tous `xo`.
 */
const HOMOGLYPHES: ReadonlyMap<string, string> = new Map([
  ["\u0391", "a"], ["\u0392", "b"], ["\u0395", "e"], ["\u0396", "z"], ["\u0397", "h"],
  ["\u0399", "i"], ["\u039a", "k"], ["\u039c", "m"], ["\u039d", "n"], ["\u039f", "o"],
  ["\u03a1", "p"], ["\u03a4", "t"], ["\u03a5", "y"], ["\u03a7", "x"], ["\u03bf", "o"],
  ["\u0410", "a"], ["\u0412", "b"], ["\u0415", "e"], ["\u041a", "k"], ["\u041c", "m"],
  ["\u041d", "h"], ["\u041e", "o"], ["\u0420", "p"], ["\u0421", "c"], ["\u0422", "t"],
  ["\u0425", "x"], ["\u043e", "o"], ["\u0430", "a"], ["\u0435", "e"], ["\u0441", "c"],
]);

export function normaliseSubstance(value: string): string {
  return [...value.normalize("NFKD")]
    .map((caractere) => HOMOGLYPHES.get(caractere) ?? caractere)
    .join("")
    // Diacritiques laissés par la décomposition NFKD.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // Tout séparateur — tirets de toutes largeurs, espaces, ponctuation — est
    // du bruit d'écriture, pas de l'information.
    .replace(/[^a-z0-9]/g, "");
}

function verifiedEvidence(
  policy: CataloguePolicy,
  evidenceIds: readonly string[],
  now: Date,
): readonly LegalEvidence[] {
  return policy.evidence.filter(
    (evidence) => evidenceIds.includes(evidence.id) && supportsAuthorisation(evidence, now),
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
export function decideCategory(
  policy: CataloguePolicy,
  categorySlug: string,
  now: Date,
): CategoryVerdict {
  const cible = normalise(categorySlug);
  const rule = policy.categories.find((candidate) => normalise(candidate.categorySlug) === cible);

  if (!rule) return { decision: "UNDECIDED", cause: "NO_RULE" };
  if (rule.decision === "PROHIBITED") return { decision: "PROHIBITED", rule };

  const evidence = verifiedEvidence(policy, rule.evidenceIds, now);
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
  // Une composition réelle est faite de phrases — « fleur de chanvre enrichie
  // en … » —, pas de jetons isolés. Un appariement par égalité stricte ne
  // trouvait donc rien dans un texte libre : on cherche par **occurrence**.
  const déclarées = declaredComposition.map(normaliseSubstance).filter((texte) => texte !== "");

  return policy.prohibitedSubstances
    .filter((rule) => {
      const formes = [rule.substance, ...rule.aliases]
        .map(normaliseSubstance)
        .filter((forme) => forme !== "");
      return formes.some((forme) => déclarées.some((texte) => texte.includes(forme)));
    })
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
      readonly cause:
        | "NO_RULE"
        | "RESTRICTION_UNSUPPORTED"
        | "NO_LIMIT_SET"
        | "INVALID_MEASUREMENT";
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
/**
 * Un taux mesurable : fini, positif, exprimé en pourcentage.
 *
 * Écrite parce qu'un audit a montré que `NaN > plafond` vaut `false` en
 * JavaScript, quel que soit le plafond :
 * une mesure illisible franchissait donc le plafond par la branche « conforme ».
 * Un taux négatif y passait aussi, et un taux de 999 % n'alertait personne. La
 * validation précède désormais toute comparaison.
 */
function estMesureValide(percent: number): boolean {
  return Number.isFinite(percent) && percent >= 0 && percent <= 100;
}

export function decideAnalyte(
  policy: CataloguePolicy,
  declared: DeclaredAnalyte,
  now: Date,
): AnalyteVerdict {
  if (!estMesureValide(declared.percent)) {
    return { analyte: declared.analyte, decision: "UNDECIDED", cause: "INVALID_MEASUREMENT" };
  }

  const cible = normalise(declared.analyte);
  const rule = policy.analytes.find((candidate) => normalise(candidate.analyte) === cible);

  if (!rule) return { analyte: declared.analyte, decision: "UNDECIDED", cause: "NO_RULE" };

  if (rule.decision === "UNRESTRICTED") {
    return { analyte: declared.analyte, decision: "UNRESTRICTED" };
  }

  if (verifiedEvidence(policy, rule.evidenceIds, now).length === 0) {
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
