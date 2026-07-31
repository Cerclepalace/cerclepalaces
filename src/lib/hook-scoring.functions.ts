import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { callGeminiJson } from "./ai-gateway.server";

const LineSchema = z.object({
  t: z.number().min(0),
  text: z.string().min(1).max(300),
});

const InputSchema = z.object({
  lines: z.array(LineSchema).min(1).max(600),
  count: z.number().int().min(3).max(8).default(5),
});

export type HookCandidate = {
  /** timestamp (s, absolute in source video) où commence la phrase choc */
  startSec: number;
  /** score de potentiel viral, 0-100 */
  score: number;
  /** la phrase choc elle-même */
  hookText: string;
  /** pourquoi ce moment peut buzzer */
  reason: string;
};

export const scoreHooks = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => InputSchema.parse(raw))
  .handler(async ({ data }): Promise<{ hooks: HookCandidate[] }> => {
    const transcript = data.lines
      .map((l) => `[${l.t.toFixed(1)}] ${l.text}`)
      .join("\n")
      .slice(0, 60000);

    const prompt = `Tu es un éditeur TikTok expert en virailité. Voici la transcription horodatée d'une vidéo (timestamps en secondes).

Repère les ${data.count * 2} moments avec le plus fort potentiel viral. Un bon "hook" est :
- une question rhétorique ("tu savais que...", "pourquoi personne ne...")
- un chiffre ou une statistique frappante
- une révélation / un secret ("personne ne sait que...", "en vrai...")
- un retournement ("mais en fait...", "sauf que...")
- une déclaration choc, une opinion clivante, une punchline, un moment drôle

Règles :
- startSec = le timestamp EXACT du début de la phrase choc (jamais avant, pas de silence en ouverture).
- score = 0-100, potentiel viral réel (sois sévère, réserve >85 aux moments exceptionnels).
- hookText = la phrase choc telle qu'elle est dite (max 140 caractères).
- reason = 8 mots max, en français.
- Classe du meilleur au moins bon. Pas de doublons ni de moments à moins de 10s d'écart.

Transcription :
${transcript}

Réponds UNIQUEMENT en JSON : {"hooks":[{"startSec":number,"score":number,"hookText":"...","reason":"..."}]}`;

    const content = await callGeminiJson({
      model: "google/gemini-3.6-flash",
      messages: [{ role: "user", content: prompt }],
    });

    try {
      const parsed = JSON.parse(content) as { hooks?: HookCandidate[] };
      const hooks = Array.isArray(parsed.hooks) ? parsed.hooks : [];
      return {
        hooks: hooks
          .filter(
            (h) =>
              typeof h?.startSec === "number" &&
              isFinite(h.startSec) &&
              typeof h?.hookText === "string" &&
              h.hookText.trim().length > 0,
          )
          .map((h) => ({
            startSec: Math.max(0, h.startSec),
            score: Math.max(0, Math.min(100, Number(h.score) || 50)),
            hookText: h.hookText.trim().slice(0, 140),
            reason: (h.reason ?? "").toString().trim().slice(0, 80),
          })),
      };
    } catch {
      return { hooks: [] };
    }
  });
