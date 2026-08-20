/**
 * Preuve de remise.
 *
 * Le domaine ne connaît ni fichier, ni stockage : il manipule une **référence**
 * (`storageKey`) et, pour un code de confirmation, une empreinte. Le code en
 * clair ne traverse jamais cette couche et n'est jamais persisté — sinon une
 * fuite de la base permettrait de fabriquer des preuves de livraison.
 *
 * Aucun mécanisme n'est imposé. Le choix dépendra de la décision sur la
 * vérification d'âge (docs/TO_VERIFY.md, décision 11) : un code remis au client
 * et saisi par le driver ne prouve pas la même chose qu'une photo du colis
 * déposé. Les trois types coexistent donc, et une livraison peut en porter
 * plusieurs.
 */

export const PROOF_TYPES = ["PHOTO", "SIGNATURE", "CODE"] as const;
export type ProofType = (typeof PROOF_TYPES)[number];

export interface ProofOfDelivery {
  readonly id: string;
  readonly deliveryId: string;
  readonly type: ProofType;
  /** Référence dans le stockage objet. Jamais le contenu lui-même. */
  readonly storageKey?: string;
  /** Empreinte du code de confirmation. Jamais le code en clair. */
  readonly codeHash?: string;
  readonly capturedAt: Date;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export type ProofValidity =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: string };

/**
 * Vérifie qu'une preuve est structurellement exploitable.
 *
 * Une preuve incomplète est pire qu'une preuve absente : elle donne
 * l'apparence d'une livraison tracée là où il n'y a rien à produire en cas de
 * litige.
 */
export function validateProof(proof: ProofOfDelivery): ProofValidity {
  switch (proof.type) {
    case "PHOTO":
    case "SIGNATURE":
      return proof.storageKey && proof.storageKey.length > 0
        ? { valid: true }
        : { valid: false, reason: `Une preuve ${proof.type} exige une référence de stockage.` };

    case "CODE":
      return proof.codeHash && proof.codeHash.length > 0
        ? { valid: true }
        : { valid: false, reason: "Une preuve CODE exige l'empreinte du code." };
  }
}

/**
 * Politique de preuve exigée pour clore une livraison.
 *
 * `requiredTypes` vide = aucune preuve obligatoire, ce qui reste le défaut V1 :
 * imposer un mécanisme avant d'avoir tranché la vérification d'âge reviendrait
 * à transformer une hypothèse juridique en contrainte technique.
 */
export interface ProofPolicy {
  readonly requiredTypes: readonly ProofType[];
}

export const DEFAULT_PROOF_POLICY: ProofPolicy = { requiredTypes: [] };

export function satisfiesProofPolicy(
  proofs: readonly ProofOfDelivery[],
  policy: ProofPolicy = DEFAULT_PROOF_POLICY,
): ProofValidity {
  const valid = proofs.filter((proof) => validateProof(proof).valid);
  const present = new Set(valid.map((proof) => proof.type));

  const missing = policy.requiredTypes.filter((type) => !present.has(type));
  return missing.length === 0
    ? { valid: true }
    : { valid: false, reason: `Preuve manquante : ${missing.join(", ")}.` };
}
