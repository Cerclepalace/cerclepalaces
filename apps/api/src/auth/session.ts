/**
 * Jetons de session.
 *
 * Le jeton est opaque et aléatoire — pas un JWT. Deux raisons :
 *
 *  1. Une session doit pouvoir être révoquée immédiatement. Un coursier suspendu
 *     ou un compte compromis ne peut pas rester actif jusqu'à l'expiration d'un
 *     jeton auto-porteur.
 *  2. Il n'y a rien à falsifier : le jeton ne porte aucune information, seule la
 *     ligne en base fait foi.
 *
 * En base, seule l'empreinte du jeton est stockée. Une fuite de la table des
 * sessions ne permet donc pas de se connecter — c'est la même logique que pour
 * les mots de passe.
 *
 * SHA-256 suffit ici, contrairement aux mots de passe : le jeton fait 256 bits
 * d'entropie aléatoire, il n'y a pas de dictionnaire à essayer.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours

/**
 * Au-delà de ce délai sans activité, la session est considérée abandonnée même
 * si elle n'a pas expiré. Protège les comptes ouverts sur un poste partagé.
 */
export const SESSION_IDLE_MS = 14 * 24 * 60 * 60 * 1000; // 14 jours

export interface IssuedSession {
  /** À transmettre au client. Ne jamais journaliser ni stocker en clair. */
  readonly token: string;
  /** À stocker en base. */
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function issueSession(now: Date = new Date()): IssuedSession {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return {
    token,
    tokenHash: hashToken(token),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
  };
}

/** Comparaison en temps constant, pour ne pas révéler de préfixe commun. */
export function tokenMatchesHash(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashToken(token), "hex");
  let expected: Buffer;
  try {
    expected = Buffer.from(storedHash, "hex");
  } catch {
    return false;
  }
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export interface SessionRecord {
  readonly expiresAt: Date;
  readonly lastSeenAt: Date;
}

export type SessionValidity =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: "EXPIRED" | "IDLE" };

export function checkSessionValidity(
  session: SessionRecord,
  now: Date = new Date(),
): SessionValidity {
  if (session.expiresAt.getTime() <= now.getTime()) {
    return { valid: false, reason: "EXPIRED" };
  }
  if (now.getTime() - session.lastSeenAt.getTime() > SESSION_IDLE_MS) {
    return { valid: false, reason: "IDLE" };
  }
  return { valid: true };
}

/**
 * Hachage d'une IP avant journalisation.
 *
 * Une IP est une donnée personnelle. On veut pouvoir détecter qu'une série de
 * tentatives vient d'une même source sans conserver l'adresse elle-même. Le
 * secret de l'application sert de sel : sans lui, l'espace des IPv4 se
 * force brutalement en quelques secondes.
 */
export function hashIp(ip: string, secret: string): string {
  return createHash("sha256").update(`${secret}:${ip}`).digest("hex").slice(0, 32);
}
