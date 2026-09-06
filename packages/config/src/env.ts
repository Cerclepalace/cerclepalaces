/**
 * Validation des variables d'environnement.
 *
 * Le principe : un processus qui démarre avec une configuration incomplète est
 * plus dangereux qu'un processus qui refuse de démarrer. Une clé de session
 * absente, un `DATABASE_URL` qui pointe encore sur la machine du développeur,
 * un secret de webhook vide — chacun de ces cas produit un service qui a l'air
 * de fonctionner jusqu'au moment où il perd de l'argent ou fuit des données.
 *
 * Ce module échoue donc au démarrage, bruyamment, en listant tout ce qui
 * manque d'un coup plutôt qu'une variable à la fois.
 */

import { z } from "zod";

const nonEmpty = (label: string) => z.string().min(1, `${label} est requis`);

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),

  DATABASE_URL: nonEmpty("DATABASE_URL").url(),
  REDIS_URL: nonEmpty("REDIS_URL").url(),

  // 32 octets d'entropie minimum. Une valeur courte ou devinable rend toutes
  // les sessions forgeables ; ce n'est pas une préférence de style.
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET doit faire au moins 32 caractères aléatoires"),

  // Sert à construire les URLs imprimées sur les QR codes physiques. Une erreur
  // ici se corrige au pilon : les supports sont déjà distribués.
  PUBLIC_BASE_URL: nonEmpty("PUBLIC_BASE_URL").url(),

  S3_ENDPOINT: z.string().url().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  // Paiement : aucun fournisseur n'est retenu (docs/TO_VERIFY.md, décision 09).
  // Les champs restent optionnels tant que la décision n'est pas prise, mais la
  // règle de production ci-dessous interdit de lancer un service qui encaisse
  // sans secret de webhook.
  PAYMENT_PROVIDER: z.string().optional(),
  PAYMENT_API_KEY: z.string().optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Règles qui dépendent de plusieurs variables à la fois — un schéma champ par
 * champ ne peut pas les exprimer.
 */
function crossFieldIssues(env: ServerEnv): string[] {
  const issues: string[] = [];

  if (env.NODE_ENV === "production") {
    if (env.PUBLIC_BASE_URL.startsWith("http://")) {
      issues.push("PUBLIC_BASE_URL doit être en https en production");
    }
    if (env.DATABASE_URL.includes("localhost")) {
      issues.push("DATABASE_URL pointe sur localhost en production");
    }
    // Un PSP configuré sans secret de webhook signifie qu'aucune notification
    // de paiement ne peut être authentifiée : n'importe qui pourrait déclarer
    // une commande payée.
    if (env.PAYMENT_PROVIDER && !env.PAYMENT_WEBHOOK_SECRET) {
      issues.push(
        "PAYMENT_WEBHOOK_SECRET est requis dès qu'un PAYMENT_PROVIDER est configuré",
      );
    }
    if (env.PAYMENT_PROVIDER && !env.PAYMENT_API_KEY) {
      issues.push("PAYMENT_API_KEY est requis dès qu'un PAYMENT_PROVIDER est configuré");
    }
  }

  // Le stockage objet est tout ou rien : à moitié configuré, les uploads
  // échouent à l'exécution au lieu d'échouer au démarrage.
  const s3 = [env.S3_ENDPOINT, env.S3_BUCKET, env.S3_ACCESS_KEY_ID, env.S3_SECRET_ACCESS_KEY];
  const s3Set = s3.filter(Boolean).length;
  if (s3Set > 0 && s3Set < s3.length) {
    issues.push("La configuration S3 est incomplète : renseigner les quatre variables ou aucune");
  }

  return issues;
}

export class EnvValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Configuration invalide :\n  - ${issues.join("\n  - ")}`);
    this.name = "EnvValidationError";
  }
}

/**
 * Valide la configuration et renvoie un objet typé. Lève une `EnvValidationError`
 * listant **tous** les problèmes, pour éviter la correction une-par-une.
 */
export function parseServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path} : ${issue.message}` : issue.message;
    });
    throw new EnvValidationError(issues);
  }

  const issues = crossFieldIssues(parsed.data);
  if (issues.length > 0) throw new EnvValidationError(issues);

  return parsed.data;
}
