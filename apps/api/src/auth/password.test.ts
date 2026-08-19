import { describe, expect, it } from "vitest";

import {
  MIN_PASSWORD_LENGTH,
  WeakPasswordError,
  assertPasswordAcceptable,
  hashPassword,
  needsRehash,
  verifyPassword,
} from "./password.js";

const motDePasse = "un-mot-de-passe-assez-long";

describe("hashPassword", () => {
  it("produit une empreinte vérifiable", async () => {
    const empreinte = await hashPassword(motDePasse);
    expect(await verifyPassword(motDePasse, empreinte)).toBe(true);
  });

  it("ne stocke jamais le mot de passe en clair", async () => {
    const empreinte = await hashPassword(motDePasse);
    expect(empreinte).not.toContain(motDePasse);
  });

  it("produit deux empreintes différentes pour le même mot de passe", async () => {
    const [a, b] = await Promise.all([hashPassword(motDePasse), hashPassword(motDePasse)]);
    expect(a).not.toBe(b);
    expect(await verifyPassword(motDePasse, a)).toBe(true);
    expect(await verifyPassword(motDePasse, b)).toBe(true);
  });

  it("porte ses paramètres dans l'empreinte", async () => {
    expect(await hashPassword(motDePasse)).toMatch(/^scrypt\$\d+\$\d+\$\d+\$/);
  });
});

describe("verifyPassword", () => {
  it("rejette un mauvais mot de passe", async () => {
    const empreinte = await hashPassword(motDePasse);
    expect(await verifyPassword("un-autre-mot-de-passe", empreinte)).toBe(false);
  });

  it("renvoie false sur une empreinte corrompue plutôt que de lever", async () => {
    for (const corrompue of ["", "n'importe quoi", "scrypt$1", "bcrypt$1$2$3$c2Vs$Y2xl"]) {
      expect(await verifyPassword(motDePasse, corrompue)).toBe(false);
    }
  });

  it("normalise l'unicode pour que la même saisie fonctionne partout", async () => {
    // « é » composé (e + accent) et précomposé s'écrivent différemment selon le
    // clavier et le système : sans normalisation, un utilisateur macOS ne peut
    // plus se connecter depuis Windows.
    const composé = "café-mot-de-passe";
    const précomposé = "café-mot-de-passe";
    const empreinte = await hashPassword(composé);
    expect(await verifyPassword(précomposé, empreinte)).toBe(true);
  });
});

describe("politique de mot de passe", () => {
  it("refuse un mot de passe trop court", () => {
    expect(() => assertPasswordAcceptable("court")).toThrow(WeakPasswordError);
  });

  it("accepte à la longueur minimale exacte", () => {
    expect(() => assertPasswordAcceptable("a".repeat(MIN_PASSWORD_LENGTH))).not.toThrow();
  });

  it("refuse un mot de passe démesuré, pour ne pas offrir un déni de service", () => {
    expect(() => assertPasswordAcceptable("a".repeat(5000))).toThrow(WeakPasswordError);
  });

  it("refuse de hacher un mot de passe faible", async () => {
    await expect(hashPassword("court")).rejects.toThrow(WeakPasswordError);
  });
});

describe("needsRehash", () => {
  it("laisse tranquille une empreinte aux paramètres courants", async () => {
    expect(needsRehash(await hashPassword(motDePasse))).toBe(false);
  });

  it("signale une empreinte produite avec des paramètres plus faibles", () => {
    expect(needsRehash("scrypt$1024$8$1$c2Vs$Y2xl")).toBe(true);
  });

  it("signale une empreinte illisible", () => {
    expect(needsRehash("n'importe quoi")).toBe(true);
  });
});
