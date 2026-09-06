/**
 * Niveau de preuve d'une réponse de prestataire — **axe consultatif**.
 *
 * Ce module ne décide rien. Il ne qualifie pas, il ne bloque pas, il n'ouvre
 * pas. Il répond à une question que le verdict ne pose pas : *avec quelle force
 * cette réponse est-elle établie ?*
 *
 * **Pourquoi il existe séparément du verdict.** `assessPoint` rend `REFUSED`
 * dès qu'une réponse vaut « non », sans examiner sa source ni sa traçabilité. Ce
 * verdict est juste — un refus bloque, archivé ou non — mais il ne dit pas
 * *pourquoi* on est bloqué, et c'est cette information-là qui commande l'action
 * suivante : consigner une archive manquante, ou passer au prestataire suivant.
 * Exprimer cette nuance dans le verdict aurait confondu un niveau de preuve avec
 * un statut de décision. Elle vit donc sur son propre axe.
 *
 * **Deux dimensions orthogonales, et elles le restent :**
 *
 * ```
 * POINT_VERDICT   décision métier      SATISFIED · REFUSED · NOT_BINDING · …
 * EVIDENCE_LEVEL  niveau documentaire  VERIFIED · CONVERGENT · UNVERIFIED
 * ```
 *
 * **La garantie est structurelle, pas conventionnelle.** Ce module importe
 * `qualification.js` ; le graphe du domaine interdit les cycles, et cette règle
 * est vérifiée à chaque exécution. `qualification.ts` ne peut donc **jamais**
 * importer ce module en retour, et aucune décision ne peut consommer un niveau
 * de preuve. Ce n'est pas une consigne qu'on peut oublier : c'est un chemin qui
 * n'existe pas.
 *
 * **Aucune heuristique.** Le niveau se dérive des seuls champs de la réponse —
 * source, date, référence. Jamais d'un nom de prestataire, jamais d'une date
 * particulière, jamais d'une impression. Deux réponses portant les mêmes champs
 * reçoivent le même niveau, quel que soit celui qui les a envoyées.
 */

import { isBindingSource, type QualificationResponse } from "./qualification.js";

/**
 * Les trois niveaux du registre, et pas un de plus.
 *
 * Nommés `PROVIDER_…` et non `PSP_…` : la garde anti-monétaire gèle la racine
 * « psp », et il valait mieux accorder ce module au vocabulaire déjà employé
 * autour de lui — `ProviderDossier`, `ProviderQualification`, `providerName` —
 * que d'élargir la liste d'exceptions d'une garde dont la valeur tient à sa
 * rareté.
 *
 * Ce sont ceux que `docs/PSP-REGISTRE.md` emploie depuis l'origine. En inventer
 * un quatrième créerait un vocabulaire de plus à tenir accordé avec les deux
 * existants — le catalogue et le document.
 */
export const PROVIDER_EVIDENCE_LEVELS = ["VERIFIED", "CONVERGENT", "UNVERIFIED"] as const;

export type ProviderEvidenceLevel = (typeof PROVIDER_EVIDENCE_LEVELS)[number];

export const PROVIDER_EVIDENCE_LEVEL_LABEL_FR: Record<ProviderEvidenceLevel, string> = {
  VERIFIED: "Preuve opposable : source engageante, datée, retrouvable",
  CONVERGENT: "Fait tenu pour établi, mais pas encore opposable",
  UNVERIFIED: "Rien d'établi",
};

/** Une date exploitable : présente, et non corrompue. */
function estDatable(date: Date | null): date is Date {
  return date !== null && !Number.isNaN(date.getTime());
}

/** Une référence retrouvable : présente, et pas une chaîne vide. */
function estRetrouvable(reference: string | null): boolean {
  return reference !== null && reference.trim() !== "";
}

/**
 * Niveau de preuve d'une réponse, dérivé de ses seuls champs.
 *
 * Les trois règles, dans l'ordre où elles s'appliquent :
 *
 *  1. **Une source non opposable n'établit rien.** Un appel commercial, une page
 *     marketing, un bac à sable qui fonctionne : `UNVERIFIED`, que la réponse
 *     soit favorable ou non. C'est le pendant, côté preuve, de la règle qui veut
 *     qu'aucune de ces sources ne qualifie jamais.
 *  2. **Un fait qu'on ne peut pas dater n'est pas établi.** Sans date, on ne
 *     peut ni situer la réponse, ni savoir ce qu'elle visait : `UNVERIFIED`.
 *  3. **Daté mais non retrouvable : `CONVERGENT`.** Le fait est tenu pour vrai —
 *     il vient d'une source qui engage, à une date connue — mais on ne peut pas
 *     produire la pièce. C'est exactement l'état des refus dont l'archive n'a
 *     pas été consignée.
 *
 * Tout le reste est `VERIFIED` : source engageante, date valide, référence
 * retrouvable.
 *
 * **Ce niveau ne dit rien du contenu de la réponse.** Un refus parfaitement
 * archivé et une acceptation parfaitement archivée sont tous deux `VERIFIED`.
 * C'est voulu : la force d'une preuve ne dépend pas de ce qui nous arrange.
 */
export function responseEvidenceLevel(response: QualificationResponse): ProviderEvidenceLevel {
  if (!isBindingSource(response.source)) return "UNVERIFIED";
  if (!estDatable(response.answeredAt)) return "UNVERIFIED";
  if (!estRetrouvable(response.reference)) return "CONVERGENT";
  return "VERIFIED";
}

/**
 * Niveau de preuve d'un dossier entier : celui de sa réponse la mieux établie.
 *
 * Un dossier sans aucune réponse est `UNVERIFIED` — l'absence n'établit rien.
 *
 * **Le maximum, et non le minimum, parce que cet axe décrit ce que le dossier
 * *contient*, pas ce qu'il autorise.** Prendre le minimum reviendrait à traiter
 * ce niveau comme un verdict — une seule réponse faible ferait chuter tout le
 * dossier —, et c'est précisément la confusion que ce module existe pour éviter.
 * Le blocage, lui, reste l'affaire de `assessQualification`, qui exige que
 * **tous** les points soient satisfaits.
 */
export function qualificationEvidenceLevel(
  responses: readonly QualificationResponse[],
): ProviderEvidenceLevel {
  let meilleur: ProviderEvidenceLevel = "UNVERIFIED";
  for (const response of responses) {
    const niveau = responseEvidenceLevel(response);
    if (niveau === "VERIFIED") return "VERIFIED";
    if (niveau === "CONVERGENT") meilleur = "CONVERGENT";
  }
  return meilleur;
}

/**
 * Ce qui manque pour qu'une réponse devienne opposable.
 *
 * Rendue en clair, pour qu'un rapport puisse dire l'action suivante plutôt que
 * l'état. `null` quand la réponse est déjà `VERIFIED`, ou quand rien ne peut la
 * sauver — une source non opposable ne le devient pas en ajoutant une date.
 */
export function missingForOpposability(response: QualificationResponse): string | null {
  if (!isBindingSource(response.source)) {
    return "La source n'engage pas son émetteur : aucune date ni référence ne la rendra opposable.";
  }
  if (!estDatable(response.answeredAt)) return "Date de la réponse.";
  if (!estRetrouvable(response.reference)) {
    return "Référence d'archive : émetteur identifiable, objet, identifiant de fil.";
  }
  return null;
}
