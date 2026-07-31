import { createServerFn } from "@tanstack/react-start";

/**
 * Délivre un jeton court terme (15 min) pour parler au service de rendu ffmpeg.
 * Le secret partagé ne quitte jamais le serveur : le client ne reçoit qu'une
 * signature HMAC horodatée, que le service vérifie.
 */
export const getRenderSession = createServerFn({ method: "GET" }).handler(async () => {
  const baseUrl = process.env.RENDER_SERVICE_URL;
  const secret = process.env.RENDER_SERVICE_SECRET;
  if (!baseUrl || !secret) {
    return { available: false as const, baseUrl: "", token: "" };
  }

  const exp = String(Date.now() + 15 * 60 * 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(exp));
  const sig = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return {
    available: true as const,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    token: `${exp}.${sig}`,
  };
});
