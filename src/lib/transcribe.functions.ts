import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { callGeminiJson } from "./ai-gateway.server";

// Cap payload at ~8MB base64 (~6MB raw), enough for ~120s of compressed audio.
const MAX_AUDIO_BASE64_LENGTH = 8 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["audio/webm", "audio/mp3", "audio/mpeg", "audio/wav", "audio/x-wav"];

const InputSchema = z.object({
  audioBase64: z
    .string()
    .min(1)
    .max(MAX_AUDIO_BASE64_LENGTH, { message: "Audio payload too large" })
    .regex(/^[A-Za-z0-9+/=]+$/, { message: "Invalid base64 payload" }),
  mimeType: z
    .string()
    .default("audio/webm")
    .refine((m) => ALLOWED_MIME_TYPES.includes(m), { message: "Unsupported mime type" }),
  durationSec: z.number().min(1).max(120),
});

export type Cue = { start: number; end: number; text: string };

export const transcribeSegment = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => InputSchema.parse(raw))
  .handler(async ({ data }): Promise<{ cues: Cue[] }> => {
    const prompt = `You transcribe a short audio clip (~${Math.round(
      data.durationSec,
    )}s) into subtitle cues optimized for TikTok/Shorts.

Rules:
- Cues are 2-5 words each, punchy.
- Times are in SECONDS relative to the clip start (0 = start).
- Each cue lasts 0.6s to 2.5s. No overlap. No gaps larger than 0.5s when speech is continuous.
- Text UPPERCASE. No punctuation except "!" and "?".
- If clip is music-only or silent, return an empty cues array.
- Language: match the audio language.

Return ONLY JSON: {"cues":[{"start":number,"end":number,"text":"string"}, ...]}`;

    const content = await callGeminiJson({
      model: "google/gemini-3.6-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "input_audio",
              input_audio: {
                data: data.audioBase64,
                format: data.mimeType.includes("webm")
                  ? "webm"
                  : data.mimeType.includes("mp3")
                    ? "mp3"
                    : "wav",
              },
            },
          ],
        },
      ],
    });

    try {
      const parsed = JSON.parse(content) as { cues?: Cue[] };
      const cues = Array.isArray(parsed.cues) ? parsed.cues : [];
      return {
        cues: cues
          .filter(
            (c) =>
              typeof c?.start === "number" &&
              typeof c?.end === "number" &&
              c.end > c.start &&
              typeof c?.text === "string" &&
              c.text.trim().length > 0,
          )
          .map((c) => ({
            start: Math.max(0, c.start),
            end: Math.min(data.durationSec, c.end),
            text: c.text.trim().slice(0, 80),
          })),
      };
    } catch {
      return { cues: [] };
    }
  });
