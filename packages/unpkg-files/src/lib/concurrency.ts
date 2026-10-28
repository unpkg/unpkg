// Thrown when queued work waits longer than the queue timeout. The
// request handler maps this to 429, which the edge workers do not
// retry (unlike 5xx), so shedding cannot amplify an overload.
export class OverloadedError extends Error {
  constructor(message = "Origin busy: tarball work queue timed out") {
    super(message);
    this.name = "OverloadedError";
  }
}

export interface ConcurrencyStats {
  active: number;
  waiting: number;
  acquired: number;
  shed: number;
}

interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// FIFO concurrency limiter with a bounded wait. At most `maxConcurrent`
// tasks run at once; queued tasks that wait longer than
// `queueTimeoutMs` are shed with OverloadedError instead of piling up
// memory behind an already-overloaded process.
export class ConcurrencyLimiter {
  private maxConcurrent: number;
  private queueTimeoutMs: number;
  private active = 0;
  private queue: Waiter[] = [];
  private acquiredCount = 0;
  private shedCount = 0;
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  constructor(maxConcurrent: number, queueTimeoutMs: number) {
    this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent) || 1);
    this.queueTimeoutMs = Math.max(0, queueTimeoutMs);
  }

  stats(): ConcurrencyStats {
    return {
      active: this.active,
      waiting: this.queue.length,
      acquired: this.acquiredCount,
      shed: this.shedCount,
    };
  }

  startStatsLogging(intervalMs = 60_000): void {
    if (this.statsTimer) return;
    this.statsTimer = setInterval(() => {
      let s = this.stats();
      console.log(
        `[tarball-limiter] active=${s.active} waiting=${s.waiting} acquired=${s.acquired} shed=${s.shed}`
      );
    }, intervalMs);
    (this.statsTimer as unknown as { unref?: () => void }).unref?.();
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquireSlot();
    try {
      return await task();
    } finally {
      this.releaseSlot();
    }
  }

  private acquireSlot(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      this.acquiredCount++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      let waiter: Waiter = {
        resolve: () => {
          this.acquiredCount++;
          resolve();
        },
        reject,
        timer: setTimeout(() => {
          let index = this.queue.indexOf(waiter);
          if (index !== -1) this.queue.splice(index, 1);
          this.shedCount++;
          reject(new OverloadedError());
        }, this.queueTimeoutMs),
      };
      this.queue.push(waiter);
    });
  }

  private releaseSlot(): void {
    this.active--;
    let next = this.queue.shift();
    if (next) {
      clearTimeout(next.timer);
      this.active++;
      next.resolve();
    }
  }
}

// Process-wide limiter for tarball download+parse work, configured from
// the environment. Defaults are sized for a 2 vCPU machine: parses are
// gunzip/tar-stream bound, and the Fly hard limit admits 100 concurrent
// requests, so the queue absorbs the difference in arrival rate.
let defaultLimiter: ConcurrencyLimiter | undefined;

export function getDefaultTarballLimiter(): ConcurrencyLimiter {
  if (!defaultLimiter) {
    let max = Number(process.env.UNPKG_MAX_CONCURRENT_TARBALLS ?? 16);
    let timeout = Number(process.env.UNPKG_TARBALL_QUEUE_TIMEOUT_MS ?? 20_000);
    defaultLimiter = new ConcurrencyLimiter(
      Number.isFinite(max) && max > 0 ? max : 16,
      Number.isFinite(timeout) && timeout >= 0 ? timeout : 20_000
    );
  }
  return defaultLimiter;
}

export function resetDefaultTarballLimiterForTests(limiter: ConcurrencyLimiter | undefined): void {
  defaultLimiter = limiter;
}
