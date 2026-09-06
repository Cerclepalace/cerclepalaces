import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROOF_POLICY,
  satisfiesProofPolicy,
  validateProof,
  type ProofOfDelivery,
} from "./proof.js";

const capturedAt = new Date("2026-06-01T18:30:00Z");

const preuve = (overrides: Partial<ProofOfDelivery> = {}): ProofOfDelivery => ({
  id: "pod_1",
  deliveryId: "dlv_1",
  type: "PHOTO",
  storageKey: "deliveries/dlv_1/photo.jpg",
  capturedAt,
  ...overrides,
});

/** Une preuve CODE ne porte pas de storageKey du tout — pas un storageKey vide. */
const preuveCode = (overrides: Partial<ProofOfDelivery> = {}): ProofOfDelivery => ({
  id: "pod_code",
  deliveryId: "dlv_1",
  type: "CODE",
  codeHash: "a3f9c1",
  capturedAt,
  ...overrides,
});

describe("validation d'une preuve", () => {
  it("accepte une photo référencée", () => {
    expect(validateProof(preuve()).valid).toBe(true);
  });

  it("accepte une signature référencée", () => {
    expect(validateProof(preuve({ type: "SIGNATURE" })).valid).toBe(true);
  });

  it("refuse une photo sans référence de stockage", () => {
    const { storageKey: _omit, ...sansRéférence } = preuve();
    expect(validateProof(sansRéférence).valid).toBe(false);
  });

  it("accepte un code par son empreinte", () => {
    expect(validateProof(preuveCode()).valid).toBe(true);
  });

  it("refuse un code sans empreinte", () => {
    const { codeHash: _omit, ...sansEmpreinte } = preuveCode();
    expect(validateProof(sansEmpreinte).valid).toBe(false);
  });
});

describe("le domaine ne manipule jamais de contenu", () => {
  it("ne porte qu'une référence, jamais le fichier", () => {
    const p = preuve();
    expect(typeof p.storageKey).toBe("string");
    expect(Object.keys(p)).not.toContain("fileContent");
    expect(Object.keys(p)).not.toContain("bytes");
  });

  it("ne porte jamais le code en clair", () => {
    const p = preuveCode();
    expect(Object.keys(p)).not.toContain("code");
    expect(p.codeHash).toBeDefined();
  });
});

describe("politique de preuve", () => {
  it("n'exige rien par défaut, tant que la vérification d'âge n'est pas tranchée", () => {
    expect(DEFAULT_PROOF_POLICY.requiredTypes).toHaveLength(0);
    expect(satisfiesProofPolicy([]).valid).toBe(true);
  });

  it("exige les types demandés quand une politique est posée", () => {
    const politique = { requiredTypes: ["PHOTO", "CODE"] as const };
    expect(satisfiesProofPolicy([preuve()], politique).valid).toBe(false);
    expect(satisfiesProofPolicy([preuve(), preuveCode()], politique).valid).toBe(true);
  });

  it("ne compte pas une preuve invalide comme satisfaisante", () => {
    const { storageKey: _omit, ...invalide } = preuve();
    expect(satisfiesProofPolicy([invalide], { requiredTypes: ["PHOTO"] }).valid).toBe(false);
  });

  it("nomme ce qui manque", () => {
    const résultat = satisfiesProofPolicy([], { requiredTypes: ["SIGNATURE"] });
    expect(résultat.valid).toBe(false);
    if (!résultat.valid) expect(résultat.reason).toContain("SIGNATURE");
  });
});
