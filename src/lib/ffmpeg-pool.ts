// Pool of Web Workers, each running its own ffmpeg.wasm instance.
// Init once with input bytes + fonts; then acquire a worker per job.

type PendingResolver = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

class PooledWorker {
  private w: Worker;
  private nextId = 0;
  private pending = new Map<string, PendingResolver>();
  public busy = false;

  constructor(private onLog?: (msg: string) => void) {
    this.w = new Worker(new URL("./ffmpeg-worker.ts", import.meta.url), { type: "module" });
    this.w.addEventListener("message", (ev: MessageEvent) => {
      const data = ev.data as { type: string; id?: string; message?: string } & Record<string, unknown>;
      if (data.type === "log") {
        this.onLog?.(String(data.message ?? ""));
        return;
      }
      if (!data.id) return;
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.type === "err") p.reject(new Error(String(data.message ?? "worker error")));
      else p.resolve(data);
    });
    this.w.addEventListener("error", (e) => {
      // Reject anything pending so callers don't hang forever.
      for (const [, p] of this.pending) p.reject(new Error(e.message || "worker crashed"));
      this.pending.clear();
    });
  }

  send<T = unknown>(msg: Record<string, unknown>, transfer?: Transferable[]): Promise<T> {
    const id = `${this.nextId++}`;
    const full = { ...msg, id };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.w.postMessage(full, transfer ?? []);
    });
  }

  terminate() {
    this.w.terminate();
    for (const [, p] of this.pending) p.reject(new Error("pool terminated"));
    this.pending.clear();
  }
}

export type PoolInit = {
  size: number;
  inputBytes: ArrayBuffer; // will be structured-cloned per worker
  fonts: Array<{ file: string; bytes: ArrayBuffer }>;
  voiceBytes?: ArrayBuffer | null;
  logoBytes?: ArrayBuffer | null;
  onLog?: (workerIdx: number, msg: string) => void;
};

export class FFmpegPool {
  private workers: PooledWorker[] = [];
  private waiters: Array<(w: PooledWorker) => void> = [];

  static async create(opts: PoolInit): Promise<FFmpegPool> {
    const pool = new FFmpegPool();
    const size = Math.max(1, opts.size);
    for (let i = 0; i < size; i++) {
      const worker = new PooledWorker(opts.onLog ? (m) => opts.onLog!(i, m) : undefined);
      pool.workers.push(worker);
    }
    // Init workers in parallel. Each needs its own copy of input bytes / fonts
    // (structured clone happens under the hood).
    await Promise.all(
      pool.workers.map((w) =>
        w.send({
          type: "init",
          inputBytes: opts.inputBytes,
          fonts: opts.fonts,
          voiceBytes: opts.voiceBytes ?? null,
          logoBytes: opts.logoBytes ?? null,
        }),
      ),
    );
    return pool;
  }

  size(): number {
    return this.workers.length;
  }

  private acquire(): Promise<PooledWorker> {
    const free = this.workers.find((w) => !w.busy);
    if (free) {
      free.busy = true;
      return Promise.resolve(free);
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(w: PooledWorker) {
    const next = this.waiters.shift();
    if (next) {
      // hand it off; still busy
      next(w);
    } else {
      w.busy = false;
    }
  }

  async run<T>(fn: (w: PooledWorker) => Promise<T>): Promise<T> {
    const w = await this.acquire();
    try {
      return await fn(w);
    } finally {
      this.release(w);
    }
  }

  terminate() {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    for (const r of this.waiters) r(null as unknown as PooledWorker);
    this.waiters = [];
  }
}

export function suggestedPoolSize(): number {
  if (typeof navigator === "undefined") return 1;
  const cores = navigator.hardwareConcurrency ?? 4;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) return 1;
  return Math.max(1, Math.min(4, Math.floor(cores / 2)));
}
