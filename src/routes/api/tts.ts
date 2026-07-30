import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const bodySchema = z.object({
  text: z.string().min(1).max(2000),
  voiceId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  stability: z.number().min(0).max(1).optional(),
  speed: z.number().min(0.7).max(1.2).optional(),
});

export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
          return Response.json(
            {
              error:
                "La synthèse vocale n'est pas connectée. Connecte ElevenLabs ou importe un fichier audio.",
            },
            { status: 503 },
          );
        }

        let parsed;
        try {
          parsed = bodySchema.parse(await request.json());
        } catch {
          return Response.json({ error: "Requête invalide" }, { status: 400 });
        }

        const res = await fetch(
          `https://api.elevenlabs.io/v1/text-to-speech/${parsed.voiceId}?output_format=mp3_44100_128`,
          {
            method: "POST",
            headers: {
              "xi-api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              text: parsed.text,
              model_id: "eleven_multilingual_v2",
              voice_settings: {
                stability: parsed.stability ?? 0.5,
                similarity_boost: 0.75,
                style: 0.35,
                use_speaker_boost: true,
                speed: parsed.speed ?? 1,
              },
            }),
          },
        );

        if (!res.ok) {
          const body = await res.text();
          console.error(`ElevenLabs TTS failed [${res.status}]: ${body}`);
          return Response.json(
            { error: `Synthèse vocale échouée [${res.status}]: ${body}` },
            { status: res.status },
          );
        }

        return new Response(res.body, {
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
