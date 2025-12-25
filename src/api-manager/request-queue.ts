import type { RequestQueueOptions, Waiter } from './types.ts';

/**
 * RequestQueue.
 *
 * @author dafengzhen
 */
export class RequestQueue {
  private active = 0;

  private readonly timeoutMs?: number;

  private waiters = new Set<Waiter>();

  constructor(private readonly maxConcurrent: number, options: RequestQueueOptions = {}) {
    if (!Number.isFinite(maxConcurrent) || maxConcurrent <= 0) {
      throw new Error(`maxConcurrent must be a positive number, got: ${maxConcurrent}`);
    }
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async acquire(signal?: AbortSignal, timeoutMs: number | undefined = this.timeoutMs): Promise<void> {
    if (signal?.aborted) {
      throw new RequestQueueAbortedError();
    }

    if (this.active < this.maxConcurrent) {
      this.active++;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
        }
        signal?.removeEventListener('abort', onAbort);
      };

      const settleReject = (err: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        this.waiters.delete(resolver);
        cleanup();
        reject(err);
      };

      const settleResolve = () => {
        if (settled) {
          return;
        }
        settled = true;
        this.waiters.delete(resolver);
        cleanup();
        this.active++;
        resolve();
      };

      const resolver: Waiter = () => {
        if (this.active < this.maxConcurrent) {
          settleResolve();
        } else {
          this.waiters.add(resolver);
        }
      };

      const onAbort = () => settleReject(new RequestQueueAbortedError());

      signal?.addEventListener('abort', onAbort, { once: true });

      if (timeoutMs && timeoutMs > 0) {
        timer = setTimeout(() => settleReject(new RequestQueueTimeoutError()), timeoutMs);
      }

      this.waiters.add(resolver);
    });
  }

  getActiveCount(): number {
    return this.active;
  }

  getQueueLength(): number {
    return this.waiters.size;
  }

  release(): void {
    if (this.active > 0) {
      this.active--;
    }

    const iter = this.waiters.values();
    const next = iter.next().value as undefined | Waiter;
    if (!next) {
      return;
    }

    this.waiters.delete(next);
    next();
  }

  async run<T>(task: () => Promise<T>, signal?: AbortSignal, timeoutMs?: number): Promise<T> {
    await this.acquire(signal, timeoutMs);
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}

/**
 * RequestQueueAbortedError.
 *
 * @author dafengzhen
 */
export class RequestQueueAbortedError extends Error {
  constructor(message = 'Request queue aborted') {
    super(message);
    this.name = 'RequestQueueAbortedError';
  }
}

/**
 * RequestQueueTimeoutError.
 *
 * @author dafengzhen
 */
export class RequestQueueTimeoutError extends Error {
  constructor(message = 'Request queue timeout') {
    super(message);
    this.name = 'RequestQueueTimeoutError';
  }
}
