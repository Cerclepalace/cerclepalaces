import { describe, expect, it } from "vitest";

import {
  SESSION_IDLE_MS,
  checkSessionValidity,
  hashIp,
  hashToken,
  issueSession,
  tokenMatchesHash,
} from "./session.js";

describe("issueSession", () => {
  it("délivre un jeton et son empreinte", () => {
    const session = issueSession();
    expect(session.token.length).toBeGreaterThanOrEqual(43);
    expect(session.tokenHash).toBe(hashToken(session.token));
  });

  it("ne délivre jamais deux fois le même jeton", () => {
    const jetons = new Set(Array.from({ length: 500 }, () => issueSession().token));
    expect(jetons.size).toBe(500);
  });

  it("fixe une expiration dans le futur", () => {
    const maintenant = new Date("2026-01-01T00:00:00Z");
    expect(issueSession(maintenant).expiresAt.getTime()).toBeGreaterThan(maintenant.getTime());
  });

  it("ne laisse pas deviner le jeton depuis l'empreinte", () => {
    const session = issueSession();
    expect(session.tokenHash).not.toContain(session.token);
  });
});

describe("tokenMatchesHash", () => {
  it("reconnaît le bon jeton", () => {
    const session = issueSession();
    expect(tokenMatchesHash(session.token, session.tokenHash)).toBe(true);
  });

  it("rejette un autre jeton", () => {
    const session = issueSession();
    expect(tokenMatchesHash(issueSession().token, session.tokenHash)).toBe(false);
  });

  it("rejette une empreinte malformée sans lever", () => {
    const session = issueSession();
    for (const mauvaise of ["", "zz", "pas-de-l-hexa"]) {
      expect(tokenMatchesHash(session.token, mauvaise)).toBe(false);
    }
  });
});

describe("checkSessionValidity", () => {
  const maintenant = new Date("2026-06-01T12:00:00Z");

  it("accepte une session récente et non expirée", () => {
    const résultat = checkSessionValidity(
      { expiresAt: new Date("2026-06-20T00:00:00Z"), lastSeenAt: maintenant },
      maintenant,
    );
    expect(résultat.valid).toBe(true);
  });

  it("refuse une session expirée", () => {
    const résultat = checkSessionValidity(
      { expiresAt: new Date("2026-05-01T00:00:00Z"), lastSeenAt: maintenant },
      maintenant,
    );
    expect(résultat).toEqual({ valid: false, reason: "EXPIRED" });
  });

  it("refuse une session abandonnée depuis trop longtemps", () => {
    const résultat = checkSessionValidity(
      {
        expiresAt: new Date("2026-12-01T00:00:00Z"),
        lastSeenAt: new Date(maintenant.getTime() - SESSION_IDLE_MS - 1000),
      },
      maintenant,
    );
    expect(résultat).toEqual({ valid: false, reason: "IDLE" });
  });

  it("refuse une session expirant exactement maintenant", () => {
    const résultat = checkSessionValidity(
      { expiresAt: maintenant, lastSeenAt: maintenant },
      maintenant,
    );
    expect(résultat.valid).toBe(false);
  });
});

describe("hashIp", () => {
  it("ne conserve pas l'adresse en clair", () => {
    const empreinte = hashIp("192.168.1.42", "secret-application");
    expect(empreinte).not.toContain("192.168");
  });

  it("est stable, pour pouvoir regrouper des tentatives", () => {
    expect(hashIp("10.0.0.1", "s")).toBe(hashIp("10.0.0.1", "s"));
  });

  it("change avec le secret, pour empêcher le forçage de l'espace des IP", () => {
    expect(hashIp("10.0.0.1", "secret-a")).not.toBe(hashIp("10.0.0.1", "secret-b"));
  });
});
