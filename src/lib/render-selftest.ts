// Auto-test du coupe-circuit de rendu : on demande au service Railway de
// simuler un ffmpeg figé, puis on vérifie qu'il est bien tué au bout du
// timeout et que la file de rendu redevient disponible immédiatement.

import { getRenderSession } from "./render-session.functions";

export type StallTestResult = {
  ok: boolean;
  killed: boolean;
  slotReleased: boolean;
  queueFreeAfterMs: number;
  timeoutMs: number;
  elapsedMs: number;
  activeRenders: number;
  queued: number;
  maxConcurrency: number;
  detail: string;
};

/**
 * @param timeoutMs délai de coupe-circuit simulé (3–30 s côté serveur)
 */
export async function runStallSelfTest(timeoutMs = 8000): Promise<StallTestResult> {
  const session = await getRenderSession();
  if (!session.available) {
    throw new Error(
      "Rendu serveur indisponible : configure RENDER_SERVICE_URL et RENDER_SERVICE_SECRET.",
    );
  }

  const controller = new AbortController();
  const abortTimer = window.setTimeout(() => controller.abort(), timeoutMs + 30_000);
  let body: Omit<StallTestResult, "queueFreeAfterMs">;
  const startedAt = performance.now();
  try {
    const res = await fetch(`${session.baseUrl}/diagnostics/stall`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ timeoutMs }),
      signal: controller.signal,
    });
    if (res.status === 404) {
      throw new Error("Service de rendu pas à jour : redéploie Railway pour activer l'auto-test.");
    }
    if (!res.ok) throw new Error(`Service de rendu: HTTP ${res.status}`);
    body = (await res.json()) as Omit<StallTestResult, "queueFreeAfterMs">;
  } catch (error) {
    window.clearTimeout(abortTimer);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Le coupe-circuit n'a pas répondu : la file est restée bloquée.");
    }
    throw error;
  }
  window.clearTimeout(abortTimer);

  // Contre-preuve : une fois le faux blocage coupé, le service doit répondre
  // tout de suite avec zéro rendu actif.
  const probeStart = performance.now();
  let queueFreeAfterMs = -1;
  try {
    const health = await fetch(`${session.baseUrl}/health`);
    const info = (await health.json()) as { activeRenders?: number };
    if ((info.activeRenders ?? 0) === 0) queueFreeAfterMs = Math.round(performance.now() - probeStart);
  } catch {
    /* la sonde est optionnelle */
  }

  return {
    ...body,
    queueFreeAfterMs,
    ok: body.ok && queueFreeAfterMs >= 0,
    elapsedMs: Math.round(body.elapsedMs ?? performance.now() - startedAt),
  };
}
