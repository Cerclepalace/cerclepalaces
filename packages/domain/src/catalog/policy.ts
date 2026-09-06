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
// Taxonomie produit
// ---------------------------------------------------------------------------

/**
 * Les catégories que la plateforme sait nommer. Liste **fermée**.
 *
 * Une chaîne libre permettait d'inventer une catégorie ; une valeur inconnue
 * bloquait, donc l'échec était du bon côté, mais rien ne distinguait « catégorie
 * jamais examinée » de « catégorie qui n'existe pas ». Ce sont deux incidents
 * différents : le premier attend une décision, le second une correction de
 * saisie.
 *
 * Il n'existe **pas** de catégorie « CBD ». Un produit au CBD peut être une
 * fleur, une résine, une huile, un cosmétique, un aliment, un complément ou un
 * liquide à vapoter, et ces natures ne relèvent pas des mêmes règles. Les
 * confondre sous une étiquette unique effacerait précisément la distinction que
 * la conformité doit faire.
 */
export const PRODUCT_CATEGORIES = [
  "FLOWER",
  "RESIN",
  "OIL_NON_FOOD",
  "COSMETIC",
  "FOOD",
  "SUPPLEMENT",
  "VAPE",
  "ACCESSORY",
  /** Non classé. Attend un classement humain ; ne s'ouvre jamais. */
  "OTHER",
  /** Fermée par construction. Aucune politique ne peut l'ouvrir. */
  "PROHIBITED_DERIVATIVE",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export function isProductCategory(value: unknown): value is ProductCategory {
  return typeof value === "string" && (PRODUCT_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Catégories qu'aucune politique ne peut ouvrir, quoi qu'elle déclare.
 *
 * `PROHIBITED_DERIVATIVE` est fermée structurellement : une règle qui
 * l'autoriserait, même soutenue par une preuve vérifiée, est ignorée. C'est le
 * seul endroit du module où le code refuse d'obéir à sa politique, et c'est
 * volontaire — cette catégorie existe pour nommer ce qui ne se distribue pas.
 *
 * `OTHER` ne s'ouvre pas non plus, pour une raison différente : ce n'est pas une
 * catégorie, c'est l'absence de classement. L'ouvrir reviendrait à autoriser
 * tout ce que personne n'a su ranger.
 */
export const STRUCTURALLY_CLOSED_CATEGORIES: readonly ProductCategory[] = [
  "PROHIBITED_DERIVATIVE",
  "OTHER",
];

/**
 * Ce que le code peut, et ce qu'il ne peut pas.
 *
 * Il vérifie qu'une **déclaration** est recevable : la catégorie existe, elle
 * est ouverte, les taux déclarés tiennent dans les plafonds, le dossier est
 * complet. Il ne vérifie **pas** que la déclaration est vraie. Rien dans une
 * chaîne de caractères ne dit la nature matérielle d'un produit, et aucun
 * contrôle automatique ne remplacera l'examen du dossier et de la marchandise.
 *
 * Un produit déclaré `FLOWER` alors qu'il relève de `PROHIBITED_DERIVATIVE`
 * franchira toutes les portes de ce module. Cette limite est structurelle, pas
 * un défaut à corriger : elle se traite par le contrôle humain et la preuve
 * documentaire, pas par du code.
 */
export const CATEGORY_DECLARATION_IS_NOT_VERIFICATION = true;

// ---------------------------------------------------------------------------
// Décisions
// ---------------------------------------------------------------------------

export const POLICY_DECISIONS = ["ALLOWED", "PROHIBITED", "UNDECIDED"] as const;

export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

export interface CategoryRule {
  readonly categorySlug: ProductCategory;
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

/**
 * Dépendance entre analyses : la présence de l'une en rend une autre exigible.
 *
 * **Ce module ne contient aucune règle de ce type.** Il fournit le mécanisme
 * pour en appliquer, quand une source vérifiée en documentera. Écrire ici une
 * dépendance concrète reviendrait à inventer une règle de conformité, ce que ce
 * dépôt s'interdit.
 *
 * Forme : « si l'analyte déclenchant est mesuré au-dessus du seuil, alors ces
 * analytes-là doivent être mesurés eux aussi ». Une exigence non satisfaite est
 * un refus, jamais un avertissement.
 */
export interface ConditionalAnalyteRule {
  readonly id: string;
  /** Analyte dont la mesure déclenche la condition. */
  readonly triggerAnalyte: string;
  /**
   * Seuil de déclenchement, strictement dépassé.
   *
   * `0` déclenche dès qu'une mesure strictement positive est déclarée ;
   * `null` déclenche dès que l'analyte est mesuré, quelle que soit sa valeur.
   */
  readonly triggerAbovePercent: number | null;
  /** Analytes qui deviennent obligatoires quand la condition est remplie. */
  readonly requiredAnalytes: readonly string[];
  /** Une dépendance affirme quelque chose : elle exige une preuve vérifiée. */
  readonly evidenceIds: readonly string[];
  readonly decidedAt: Date;
}

export interface CataloguePolicy {
  readonly evidence: readonly LegalEvidence[];
  readonly categories: readonly CategoryRule[];
  readonly prohibitedSubstances: readonly SubstanceRule[];
  readonly analytes: readonly AnalyteRule[];
  readonly conditionalAnalytes: readonly ConditionalAnalyteRule[];
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
  conditionalAnalytes: [],
  reviewedAt: null,
  maxAgeDays: null,
};

export interface DuplicateEvidenceId {
  readonly id: string;
  readonly count: number;
}

/**
 * Identifiants de preuve apparaissant plus d'une fois.
 *
 * L'unicité est une **invariance du registre**, pas une préférence : les règles
 * citent leurs preuves par identifiant. Deux lignes portant le même identifiant
 * rendent la citation ambiguë, et rien ne dit laquelle la règle visait.
 *
 * À distinguer de `reference`, qui peut légitimement se répéter : deux règles
 * différentes peuvent s'appuyer sur la même source.
 */
export function findDuplicateEvidenceIds(
  evidence: readonly LegalEvidence[],
): readonly DuplicateEvidenceId[] {
  const comptes = new Map<string, number>();
  for (const item of evidence) comptes.set(item.id, (comptes.get(item.id) ?? 0) + 1);
  return [...comptes.entries()]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ id, count }));
}

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
  // Un identifiant ambigu ne soutient rien. Retenir la ligne vérifiée parmi deux
  // homonymes reviendrait à laisser une preuve non vérifiée en couvrir une
  // autre : il suffirait d'ajouter une ligne pour ouvrir une catégorie.
  const ambigus = new Set(findDuplicateEvidenceIds(policy.evidence).map((d) => d.id));

  return policy.evidence.filter(
    (evidence) =>
      evidenceIds.includes(evidence.id) &&
      !ambigus.has(evidence.id) &&
      supportsAuthorisation(evidence, now),
  );
}

// ---------------------------------------------------------------------------
// Catégories
// ---------------------------------------------------------------------------

export type CategoryVerdict =
  | { readonly decision: "ALLOWED"; readonly evidence: readonly LegalEvidence[] }
  | { readonly decision: "PROHIBITED"; readonly rule: CategoryRule | null }
  | {
      readonly decision: "UNDECIDED";
      readonly cause:
        | "NO_RULE"
        | "AUTHORISATION_UNSUPPORTED"
        /** La valeur déclarée n'est pas une catégorie de la taxonomie. */
        | "NOT_A_CATEGORY"
        /** `OTHER` : le produit n'est pas classé, il attend un classement. */
        | "UNCLASSIFIED";
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
  categorySlug: unknown,
  now: Date,
): CategoryVerdict {
  // La taxonomie est fermée, et la comparaison est **exacte** : ni la casse ni
  // les tirets ne sont rattrapés. « flower » n'est pas `FLOWER`, c'est une
  // valeur qui n'a pas été produite par le système. La tolérer masquerait une
  // saisie libre là où l'on veut une valeur d'énumération.
  if (!isProductCategory(categorySlug)) {
    return { decision: "UNDECIDED", cause: "NOT_A_CATEGORY" };
  }

  // Fermeture structurelle : aucune politique ne peut ouvrir ces catégories.
  // Le contrôle passe avant la lecture des règles, pour qu'une règle contraire
  // n'ait aucun effet plutôt que d'être discutée.
  if (categorySlug === "PROHIBITED_DERIVATIVE") {
    return { decision: "PROHIBITED", rule: null };
  }
  if (categorySlug === "OTHER") {
    return { decision: "UNDECIDED", cause: "UNCLASSIFIED" };
  }

  const rule = policy.categories.find((candidate) => candidate.categorySlug === categorySlug);

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

// ---------------------------------------------------------------------------
// Dépendances entre analyses
// ---------------------------------------------------------------------------

export type ConditionalRequirement =
  | {
      readonly ruleId: string;
      readonly outcome: "SATISFIED";
      readonly triggeredBy: string;
    }
  | {
      readonly ruleId: string;
      readonly outcome: "MISSING_ANALYTE";
      readonly triggeredBy: string;
      readonly missing: readonly string[];
    }
  | {
      readonly ruleId: string;
      readonly outcome: "UNSUPPORTED";
      readonly triggeredBy: string;
    };

/**
 * Évalue les dépendances déclenchées par les analyses déclarées.
 *
 * Trois issues, et aucune n'est un silence :
 *
 *  - `SATISFIED` — la condition s'applique et les analyses exigées sont là ;
 *  - `MISSING_ANALYTE` — elle s'applique et il en manque : c'est un refus, avec
 *    la liste de ce qui manque ;
 *  - `UNSUPPORTED` — elle s'applique mais aucune preuve vérifiée ne la soutient.
 *    Le résultat est aussi un refus, et c'est délibéré : une exigence qu'on ne
 *    peut pas sourcer ne doit ni bloquer en silence ni s'effacer en silence.
 *
 * Une règle dont l'analyte déclenchant n'est pas mesuré, ou est mesuré sous le
 * seuil, ne rend rien : elle ne s'applique pas. Une mesure invalide **ne
 * déclenche pas** non plus — elle est déjà refusée par `decideAnalyte`, et la
 * traiter ici comme un déclenchement produirait deux motifs pour une seule
 * cause.
 *
 * Toutes les règles sont évaluées, jamais la première seulement : plusieurs
 * dépendances peuvent tomber ensemble, et l'exploitant doit toutes les voir.
 */
export function evaluateConditionalAnalytes(
  policy: CataloguePolicy,
  declared: readonly DeclaredAnalyte[],
  now: Date,
): readonly ConditionalRequirement[] {
  const parAnalyte = new Map(
    declared
      .filter((mesure) => estMesureValide(mesure.percent))
      .map((mesure) => [normalise(mesure.analyte), mesure.percent] as const),
  );

  const résultats: ConditionalRequirement[] = [];

  for (const rule of policy.conditionalAnalytes) {
    const valeur = parAnalyte.get(normalise(rule.triggerAnalyte));
    if (valeur === undefined) continue;
    if (rule.triggerAbovePercent !== null && valeur <= rule.triggerAbovePercent) continue;

    if (verifiedEvidence(policy, rule.evidenceIds, now).length === 0) {
      résultats.push({
        ruleId: rule.id,
        outcome: "UNSUPPORTED",
        triggeredBy: rule.triggerAnalyte,
      });
      continue;
    }

    const manquants = rule.requiredAnalytes.filter(
      (exigé) => !parAnalyte.has(normalise(exigé)),
    );

    résultats.push(
      manquants.length === 0
        ? { ruleId: rule.id, outcome: "SATISFIED", triggeredBy: rule.triggerAnalyte }
        : {
            ruleId: rule.id,
            outcome: "MISSING_ANALYTE",
            triggeredBy: rule.triggerAnalyte,
            missing: manquants,
          },
    );
  }

  return résultats;
}
