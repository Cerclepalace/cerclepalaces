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
  ) {}

  private active = 0;
  private queue: Array<() => void> = [];
  private closed = false;
  private refreshing: Promise<string> | null = null;

  static async create(opts: RemoteInit): Promise<RemoteRenderPool> {
    const session = await getRenderSession();
    if (!session.available) {
      throw new Error(
        "Rendu serveur indisponible : configure RENDER_SERVICE_URL et RENDER_SERVICE_SECRET.",
      );
    }

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
      `${session.baseUrl}/session`,
      session.token,
      form,
      opts.onUploadProgress,
    );

    return new RemoteRenderPool(
      session.baseUrl,
      session.token,
      sessionId,
      Math.max(1, Math.min(4, opts.size)),
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

  private async call(msg: Record<string, unknown>): Promise<unknown> {
    if (this.closed) throw new Error("Session de rendu fermée");
    const type = msg.type as string;
    const url = `${this.baseUrl}/session/${this.sessionId}/${type === "extract" ? "extract" : "render"}`;

    const doFetch = async (token: string) =>
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(msg),
      });

    let res = await doFetch(await this.freshToken());
    if (res.status === 401) {
      // jeton périmé pendant un long rendu : on le renouvelle et on rejoue une fois
      res = await doFetch(await this.freshToken(true));
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
    if (type === "extract") return res.json();
    const buf = await res.arrayBuffer();
    return { mp4: buf };
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
