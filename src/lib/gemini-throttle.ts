// Simple concurrency + rate limiter for outbound Gemini calls.
// Combines:
//   - a semaphore capping concurrent in-flight requests
//   - a sliding-window RPM (requests per minute) quota
// Requests wait (FIFO) until both allow them through.

export type ThrottleOptions = {
  maxConcurrent?: number; // default 4
  rpm?: number; // default 30 (requests per rolling 60s)
};

export class GeminiThrottle {
  private maxConcurrent: number;
  private rpm: number;
  private active = 0;
  private timestamps: number[] = []; // completion/entry times within last 60s
  private queue: Array<() => void> = [];

  constructor(opts: ThrottleOptions = {}) {
    this.maxConcurrent = Math.max(1, opts.maxConcurrent ?? 4);
    this.rpm = Math.max(1, opts.rpm ?? 30);
  }

  configure(opts: ThrottleOptions) {
    if (opts.maxConcurrent) this.maxConcurrent = Math.max(1, opts.maxConcurrent);
    if (opts.rpm) this.rpm = Math.max(1, opts.rpm);
    this.pump();
  }

  stats() {
    this.prune();
    return {
      active: this.active,
      queued: this.queue.length,
      windowUsed: this.timestamps.length,
      rpm: this.rpm,
      maxConcurrent: this.maxConcurrent,
    };
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private prune() {
    const cutoff = Date.now() - 60_000;
    while (this.timestamps.length && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }

  private canRun(): boolean {
    this.prune();
    return this.active < this.maxConcurrent && this.timestamps.length < this.rpm;
  }

  private acquire(): Promise<void> {
    return new Promise((resolve) => {
      const tryTake = () => {
        if (this.canRun()) {
          this.active++;
          this.timestamps.push(Date.now());
          resolve();
          return true;
        }
        return false;
      };
      if (tryTake()) return;
      this.queue.push(() => {
        tryTake();
      });
      // If RPM is the blocker, schedule a wake when the oldest timestamp expires.
      this.scheduleWake();
    });
  }

  private release() {
    this.active = Math.max(0, this.active - 1);
    this.pump();
  }

  private wakeTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduleWake() {
    if (this.wakeTimer) return;
    this.prune();
    if (this.timestamps.length < this.rpm) return; // will wake on release
    const oldest = this.timestamps[0];
    const wait = Math.max(50, oldest + 60_000 - Date.now() + 20);
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null;
      this.pump();
    }, wait);
  }

  private pump() {
    while (this.queue.length && this.canRun()) {
      const next = this.queue.shift()!;
      next();
    }
    if (this.queue.length) this.scheduleWake();
  }
}

// Shared instance used by the video pipeline.
export const geminiThrottle = new GeminiThrottle({ maxConcurrent: 4, rpm: 30 });
