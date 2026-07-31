// Backend de rendu distant : même interface que FFmpegPool (init + run/send),
// mais l'encodage tourne sur le service ffmpeg natif au lieu du navigateur.
// Utilisé par défaut sur mobile, où ffmpeg.wasm fait crasher l'onglet.

import { getRenderSession } from "./render-session.functions";
import type { PoolInit } from "./ffmpeg-pool";

export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export type RemoteInit = PoolInit & {
  /** nombre de rendus simultanés demandés au serveur */
  size: number;
  onUploadProgress?: (fraction: number) => void;
};

type Sendable = { send<T = unknown>(msg: Record<string, unknown>): Promise<T> };

function uploadWithProgress(
  url: string,
  token: string,
  form: FormData,
  onProgress?: (f: number) => void,
): Promise<{ sessionId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Réponse invalide du service de rendu"));
        }
      } else {
        reject(new Error(`Upload refusé par le service (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Service de rendu injoignable"));
    xhr.send(form);
  });
}

export class RemoteRenderPool {
  private constructor(
    private baseUrl: string,
    private token: string,
    private sessionId: string,
    private concurrency: number,
    private assets: RemoteInit,
  ) {}

  private active = 0;
  private queue: Array<() => void> = [];
  private closed = false;
  private refreshing: Promise<string> | null = null;
  private recreating: Promise<string> | null = null;

  private static async openSession(
    opts: RemoteInit,
    baseUrl: string,
    token: string,
  ): Promise<string> {
    const form = new FormData();
    form.append("input", new Blob([opts.inputBytes], { type: "video/mp4" }), "input.mp4");
    if (opts.voiceBytes) {
      form.append("voice", new Blob([opts.voiceBytes], { type: "audio/mpeg" }), "promo_vo.mp3");
    }
    if (opts.logoBytes) {
      form.append("logo", new Blob([opts.logoBytes], { type: "image/png" }), "pause_logo.png");
    }
    for (const f of opts.fonts) {
      form.append("font", new Blob([f.bytes], { type: "font/ttf" }), f.file);
    }
    const { sessionId } = await uploadWithProgress(
      `${baseUrl}/session`,
      token,
      form,
      opts.onUploadProgress,
    );
    return sessionId;
  }

  static async create(opts: RemoteInit): Promise<RemoteRenderPool> {
    const session = await getRenderSession();
    if (!session.available) {
      throw new Error(
        "Rendu serveur indisponible : configure RENDER_SERVICE_URL et RENDER_SERVICE_SECRET.",
      );
    }

    const sessionId = await RemoteRenderPool.openSession(opts, session.baseUrl, session.token);

    return new RemoteRenderPool(
      session.baseUrl,
      session.token,
      sessionId,
      // Le service sérialise les rendus (MAX_RENDER_CONCURRENCY) : au-delà de 2
      // requêtes en vol, les connexions restent ouvertes trop longtemps et iOS
      // les coupe avec "Load failed".
      Math.max(1, Math.min(2, opts.size)),
      opts,
    );
  }

  size(): number {
    return this.concurrency;
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise((resolve) =>
      this.queue.push(() => {
        this.active++;
        resolve();
      }),
    );
  }

  private release() {
    this.active--;
    this.queue.shift()?.();
  }

  /** Le jeton HMAC expire au bout de 15 min : sur un gros rendu il faut le renouveler. */
  private tokenExpiry(): number {
    const exp = Number(String(this.token).split(".")[0]);
    return Number.isFinite(exp) ? exp : 0;
  }

  private async freshToken(force = false): Promise<string> {
    if (!force && Date.now() < this.tokenExpiry() - 60_000) return this.token;
    if (!this.refreshing) {
      this.refreshing = getRenderSession()
        .then((s) => {
          if (s.available) this.token = s.token;
          return this.token;
        })
        .finally(() => {
          this.refreshing = null;
        });
    }
    return this.refreshing;
  }

  /** Le service a redémarré et a perdu la session : on ré-uploade la source une seule fois. */
  private async recreateSession(previous: string): Promise<string> {
    if (this.sessionId !== previous) return this.sessionId;
    if (!this.recreating) {
      this.recreating = (async () => {
        const token = await this.freshToken(true);
        this.sessionId = await RemoteRenderPool.openSession(
          { ...this.assets, onUploadProgress: undefined },
          this.baseUrl,
          token,
        );
        return this.sessionId;
      })().finally(() => {
        this.recreating = null;
      });
    }
    return this.recreating;
  }

  private async call(msg: Record<string, unknown>): Promise<unknown> {
    if (this.closed) throw new Error("Session de rendu fermée");
    const type = msg.type as string;
    const isExtract = type === "extract";

    const doFetch = async (token: string) => {
      const controller = new AbortController();
      // Une requête Railway ne doit jamais immobiliser tout le pipeline. Un
      // rendu de short qui dépasse 3 minutes est considéré bloqué et passe au
      // fallback suivant (sans promo, puis sans sous-titres).
      const timeout = window.setTimeout(() => controller.abort(), isExtract ? 90_000 : 180_000);
      try {
        return await fetch(
          `${this.baseUrl}/session/${this.sessionId}/${isExtract ? "extract" : "render"}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify(msg),
            signal: controller.signal,
          },
        );
      } finally {
        window.clearTimeout(timeout);
      }
    };

    // Ici on ne reprend que les vraies coupures réseau. Les erreurs FFmpeg 5xx
    // sont déterministes : les rejouer trois fois à l'identique multipliait les
    // 3 fallbacks du pipeline en 9 encodages et donnait une reprise « infinie ».
    const maxAttempts = 2;
    let lastError = "connexion interrompue";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let res: Response;
      try {
        res = await doFetch(await this.freshToken());
      } catch (error) {
        // Coupure réseau mobile / connexion fermée par iOS ("Load failed").
        lastError =
          error instanceof DOMException && error.name === "AbortError"
            ? "délai maximal dépassé"
            : error instanceof Error
              ? error.message
              : "connexion interrompue";
        if (this.closed || attempt === maxAttempts) break;
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }

      if (res.status === 401) {
        res = await doFetch(await this.freshToken(true));
      }
      if (res.status === 404) {
        // Session perdue (redéploiement / veille du service) : on la recrée.
        const previous = this.sessionId;
        try {
          await this.recreateSession(previous);
        } catch (e) {
          lastError = e instanceof Error ? e.message : "session perdue";
          break;
        }
        if (attempt < maxAttempts) continue;
      }
      if (res.status >= 500) {
        let detail = `${res.status}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) detail = j.error;
        } catch {
          /* ignore */
        }
        throw new Error(`Rendu serveur: ${detail}`);
      }
      if (!res.ok) {
        let detail = `${res.status}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) detail = j.error;
        } catch {
          /* ignore */
        }
        throw new Error(`Rendu serveur: ${detail}`);
      }

      if (isExtract) return res.json();
      const buf = await res.arrayBuffer();
      if (buf.byteLength === 0) throw new Error("Rendu serveur: fichier vide");
      return { mp4: buf };
    }

    throw new Error(`Service de rendu momentanément indisponible (${lastError})`);
  }



  async run<T>(fn: (w: Sendable) => Promise<T>): Promise<T> {
    await this.acquire();
    const sendable: Sendable = {
      send: <R,>(msg: Record<string, unknown>) => this.call(msg) as Promise<R>,
    };
    try {
      return await fn(sendable);
    } finally {
      this.release();
    }
  }

  terminate() {
    if (this.closed) return;
    this.closed = true;
    void fetch(`${this.baseUrl}/session/${this.sessionId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${this.token}` },
      keepalive: true,
    }).catch(() => {});
  }
}
