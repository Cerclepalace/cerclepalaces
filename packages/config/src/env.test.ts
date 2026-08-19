import { describe, expect, it } from "vitest";

import { EnvValidationError, parseServerEnv } from "./env.js";

const valid = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://user:pass@localhost:5432/cbd",
  REDIS_URL: "redis://localhost:6379",
  AUTH_SECRET: "x".repeat(48),
  PUBLIC_BASE_URL: "http://localhost:3000",
} satisfies NodeJS.ProcessEnv;

const production = {
  ...valid,
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://user:pass@db.interne:5432/cbd",
  PUBLIC_BASE_URL: "https://plateforme.fr",
};

describe("configuration valide", () => {
  it("accepte une configuration de développement minimale", () => {
    const env = parseServerEnv(valid);
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(3001);
  });

  it("convertit PORT en nombre", () => {
    expect(parseServerEnv({ ...valid, PORT: "8080" }).PORT).toBe(8080);
  });
});

describe("refus au démarrage", () => {
  it("refuse un AUTH_SECRET trop court", () => {
    expect(() => parseServerEnv({ ...valid, AUTH_SECRET: "trop-court" })).toThrow(
      EnvValidationError,
    );
  });

  it("refuse une URL de base de données absente", () => {
    const { DATABASE_URL: _omit, ...sansDb } = valid;
    expect(() => parseServerEnv(sansDb)).toThrow(EnvValidationError);
  });

  it("liste tous les problèmes d'un coup plutôt qu'un seul", () => {
    try {
      parseServerEnv({ NODE_ENV: "development" });
      expect.unreachable("la validation aurait dû échouer");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues.length).toBeGreaterThan(3);
    }
  });
});

describe("règles propres à la production", () => {
  it("accepte une production correctement configurée", () => {
    expect(parseServerEnv(production).NODE_ENV).toBe("production");
  });

  it("refuse une URL publique en http", () => {
    expect(() =>
      parseServerEnv({ ...production, PUBLIC_BASE_URL: "http://plateforme.fr" }),
    ).toThrow(/https en production/);
  });

  it("refuse une base de données pointant sur localhost", () => {
    expect(() =>
      parseServerEnv({ ...production, DATABASE_URL: "postgresql://u:p@localhost:5432/cbd" }),
    ).toThrow(/localhost en production/);
  });

  it("refuse un PSP configuré sans secret de webhook", () => {
    expect(() =>
      parseServerEnv({ ...production, PAYMENT_PROVIDER: "psp-x", PAYMENT_API_KEY: "k" }),
    ).toThrow(/PAYMENT_WEBHOOK_SECRET/);
  });

  it("laisse passer ces mêmes cas hors production", () => {
    expect(() => parseServerEnv({ ...valid, PAYMENT_PROVIDER: "psp-x" })).not.toThrow();
  });
});

describe("configuration S3", () => {
  it("refuse une configuration partielle", () => {
    expect(() => parseServerEnv({ ...valid, S3_BUCKET: "cbd" })).toThrow(/incomplète/);
  });

  it("accepte les quatre variables ensemble", () => {
    expect(() =>
      parseServerEnv({
        ...valid,
        S3_ENDPOINT: "https://s3.exemple.fr",
        S3_BUCKET: "cbd",
        S3_ACCESS_KEY_ID: "id",
        S3_SECRET_ACCESS_KEY: "secret",
      }),
    ).not.toThrow();
  });

  it("accepte l'absence totale de configuration S3", () => {
    expect(() => parseServerEnv(valid)).not.toThrow();
  });
});
