/**
 * Hachage des mots de passe.
 *
 * `scrypt` du cœur de Node : mémoire-dur, donc coûteux à paralléliser sur GPU,
 * et sans dépendance native à compiler — un binaire qui refuse de builder en CI
 * finit toujours par être remplacé par quelque chose de plus faible.
 *
 * Le format stocké porte ses propres paramètres :
 *
 *   scrypt$N$r$p$sel_base64$empreinte_base64
 *
 * Les durcir plus tard n'invalide donc pas les mots de passe existants :
 * `needsRehash()` détecte les empreintes anciennes et le prochain login les
 * remet à niveau, de façon transparente pour l'utilisateur.
 */

import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

// `promisify` perd la surcharge de `scrypt` qui accepte des options : on
// enveloppe explicitement plutôt que de perdre le typage des paramètres.
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/** Paramètres courants. Augmenter `N` double le coût à chaque incrément. */
export const SCRYPT_PARAMS = { N: 2 ** 16, r: 8, p: 1 } as const;

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const PREFIX = "scrypt";

/**
 * `scrypt` a besoin d'environ 128 × N × r octets. À N = 2^16 et r = 8, cela fait
 * ~64 Mio, au-delà de la limite par défaut de Node : sans ce réglage explicite,
 * la dérivation échoue au lieu d'être simplement lente.
 */
const MAX_MEMORY = 256 * 1024 * 1024;

/** Longueur minimale. La robustesse réelle vient de la longueur, pas des symboles. */
export const MIN_PASSWORD_LENGTH = 12;

export class WeakPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeakPasswordError";
  }
}

export function assertPasswordAcceptable(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError(
      `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`,
    );
  }
  // Une limite haute évite qu'une requête de plusieurs mégaoctets ne devienne un
  // déni de service par dérivation.
  if (password.length > 200) {
    throw new WeakPasswordError("Le mot de passe ne peut pas dépasser 200 caractères.");
  }
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    ...SCRYPT_PARAMS,
    maxmem: MAX_MEMORY,
  });
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordAcceptable(password);
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt);
  const { N, r, p } = SCRYPT_PARAMS;
  return `${PREFIX}$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

interface ParsedHash {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly salt: Buffer;
  readonly key: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;

  try {
    return {
      N,
      r,
      p,
      salt: Buffer.from(parts[4] as string, "base64"),
      key: Buffer.from(parts[5] as string, "base64"),
    };
  } catch {
    return null;
  }
}

/**
 * Vérifie un mot de passe.
 *
 * Renvoie `false` plutôt que de lever, y compris sur une empreinte corrompue :
 * un utilisateur ne doit pas pouvoir distinguer « compte inexistant » de
 * « données abîmées » — c'est ainsi qu'on énumère des comptes.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;

  let derived: Buffer;
  try {
    derived = await scrypt(password.normalize("NFKC"), parsed.salt, parsed.key.length, {
      N: parsed.N,
      r: parsed.r,
      p: parsed.p,
      maxmem: MAX_MEMORY,
    });
  } catch {
    return false;
  }

  if (derived.length !== parsed.key.length) return false;
  return timingSafeEqual(derived, parsed.key);
}

/** Vrai si l'empreinte a été produite avec des paramètres plus faibles qu'aujourd'hui. */
export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  if (!parsed) return true;
  return parsed.N < SCRYPT_PARAMS.N || parsed.r < SCRYPT_PARAMS.r || parsed.p < SCRYPT_PARAMS.p;
}
