import type { DefaultBaseOptions, EventState, ExecOptions } from './types.ts';

/**
 * Executor.
 *
 * @author dafengzhen
 */
export class Executor {
  private readonly handler: () => any;

  private readonly options: ExecOptions;

  constructor(handler: () => any, options?: ExecOptions) {
    const defaultOptions: DefaultBaseOptions = {
      maxRetries: 3,
      onCancel: () => {
      },
      onRetryAttempt: () => {
      },
      onStateChange: () => {
      },
      onTimeout: () => {
      },
      retryDelay: 1000,
      shouldRetry: () => false,
      throwOnError: false,
      timeout: 30000
    };

    this.handler = handler;
    this.options = {
      ...defaultOptions,
      ...options
    };
  }

  async execute(): Promise<void> {
    let attempt = 0;
    let state: EventState = 'pending';

    const setState = (newState: EventState) => {
      if (state !== newState) {
        state = newState;
        this.options.onStateChange(newState);
      }
    };

    while (true) {
      try {
        if (this.isCancelled()) {
          // noinspection ExceptionCaughtLocallyJS
          throw new ExecutorCancelledError();
        }

        setState(attempt === 0 ? 'running' : 'retrying');

        await this.executeHandlerWithTimeout();

        setState('succeeded');

        break;
      } catch (err) {
        if (err instanceof ExecutorCancelledError) {
          setState('cancelled');
          this.options.onCancel();

          if (this.options.throwOnError) {
            throw err;
          }
          break;
        }

        if (err instanceof ExecutorTimeoutError) {
          setState('timeout');
          this.options.onTimeout(this.options.timeout);
        }

        if (!this.shouldRetry(attempt, err)) {
          setState('failed');

          if (this.options.throwOnError) {
            throw err;
          }
          break;
        }

        attempt++;
        this.options.onRetryAttempt(attempt, err);

        const delay = this.calculateRetryDelay(attempt);
        if (delay > 0) {
          try {
            await this.waitWithCancellation(delay);
          } catch (waitErr) {
            if (waitErr instanceof ExecutorCancelledError) {
              setState('cancelled');
              this.options.onCancel();

              if (this.options.throwOnError) {
                throw waitErr;
              }
              break;
            }
            throw waitErr;
          }
        }
      }
    }
  }

  private calculateRetryDelay(attempt: number): number {
    const d = this.options.retryDelay;
    return Math.max(0, typeof d === 'function' ? d(attempt) : d);
  }

  private executeHandlerWithTimeout(): Promise<void> {
    const { signal: outer, timeout } = this.options;

    if (!timeout && !outer) {
      return Promise.resolve(this.handler());
    }

    const controller = new AbortController();
    const inner = controller.signal;

    let timeoutId: null | ReturnType<typeof setTimeout> = null;
    let outerHandler: (() => void) | null = null;

    if (outer) {
      outerHandler = () => controller.abort();
      outer.addEventListener('abort', outerHandler);
    }

    if (timeout > 0) {
      timeoutId = setTimeout(() => controller.abort(), timeout);
    }

    const cleanup = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }

      if (outer && outerHandler) {
        outer.removeEventListener('abort', outerHandler);
      }
    };

    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        if (outer?.aborted) {
          reject(new ExecutorCancelledError());
        } else {
          reject(new ExecutorTimeoutError(timeout));
        }
      };

      inner.addEventListener('abort', onAbort, { once: true });

      Promise.resolve(this.handler()).then(
        (val) => {
          cleanup();
          resolve(val);
        },
        (err) => {
          cleanup();
          reject(err);
        }
      );
    });
  }

  private isCancelled(): boolean {
    return this.options.signal?.aborted ?? false;
  }

  private shouldRetry(attempt: number, error: unknown): boolean {
    return attempt < this.options.maxRetries && this.options.shouldRetry(error);
  }

  private waitWithCancellation(ms: number): Promise<void> {
    const sig = this.options.signal;

    if (!sig) {
      return new Promise((res) => setTimeout(res, ms));
    }

    if (sig.aborted) {
      return Promise.reject(
        new ExecutorCancelledError('Cancelled during wait')
      );
    }

    return new Promise((resolve, reject) => {
      let timeoutId: null | ReturnType<typeof setTimeout> = null;

      const onAbort = () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        sig.removeEventListener('abort', onAbort);
        reject(new ExecutorCancelledError('Cancelled during wait'));
      };

      sig.addEventListener('abort', onAbort);

      timeoutId = setTimeout(() => {
        sig.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
    });
  }
}

/**
 * ExecutorError.
 *
 * @author dafengzhen
 */
export class ExecutorError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'ExecutorError';
  }
}

/**
 * ExecutorCancelledError.
 *
 * @author dafengzhen
 */
export class ExecutorCancelledError extends ExecutorError {
  constructor(message: string = 'Operation was cancelled') {
    super('CANCELLED', message);
    this.name = 'ExecutorCancelledError';
  }
}

/**
 * ExecutorTimeoutError.
 *
 * @author dafengzhen
 */
export class ExecutorTimeoutError extends ExecutorError {
  constructor(
    public readonly timeout: number,
    message: string = `Operation timed out after ${timeout}ms`
  ) {
    super('TIMEOUT', message);
    this.name = 'ExecutorTimeoutError';
  }
}