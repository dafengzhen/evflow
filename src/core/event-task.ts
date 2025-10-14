import type {
  EventContext,
  EventEmitResult,
  EventError,
  EventHandler,
  EventState,
  EventTaskOptions,
  IEventTask,
} from '../types/types.ts';

/**
 * EventTask.
 *
 * @author dafengzhen
 */
export class EventTask<R = unknown> implements IEventTask<R> {
  constructor(
    private readonly context: EventContext,
    private readonly handler: EventHandler,
    private readonly options: EventTaskOptions = {},
  ) {}

  async execute(): Promise<EventEmitResult<R>> {
    const { isRetryable, maxRetries = 0, onRetry, onStateChange, retryDelay = 0, signal } = this.options;

    let attempt = 0;
    let state: EventState = 'pending';

    const setState = (newState: EventState) => {
      if (state !== newState) {
        state = newState;
        onStateChange?.(state);
      }
    };

    try {
      setState('running');

      while (true) {
        this.ensureNotCancelled(signal);

        try {
          const result = await this.runWithTimeout();
          setState('succeeded');
          return this.createResult('succeeded', result);
        } catch (error) {
          const eventError = this.normalizeError(error);

          if (eventError.code === 'CANCELLED') {
            setState('cancelled');
            return this.createResult('cancelled', undefined, eventError);
          }

          const canRetry = attempt < maxRetries && (isRetryable ? isRetryable(eventError) : true);

          if (!canRetry) {
            setState('failed');
            return this.createResult('failed', undefined, eventError);
          }

          attempt++;
          setState('retrying');
          onRetry?.(attempt, eventError);

          const delay = typeof retryDelay === 'function' ? retryDelay(attempt) : retryDelay;

          if (delay > 0) {
            await this.wait(delay, signal).catch((waitErr) => {
              const err = this.normalizeError(waitErr);
              if (err.code === 'CANCELLED') {
                setState('cancelled');
                throw err;
              }
              throw waitErr;
            });
          }
        }
      }
    } catch (error) {
      const eventError = this.normalizeError(error);
      setState(eventError.code === 'CANCELLED' ? 'cancelled' : 'failed');
      return this.createResult(state, undefined, eventError);
    }
  }

  private createError(code: string, message: string, error?: unknown): EventError {
    return {
      code,
      error,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    };
  }

  private createResult(state: EventState, result?: R, error?: EventError): EventEmitResult<R> {
    return { error, result, state };
  }

  private ensureNotCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw this.createError('CANCELLED', 'Task was cancelled');
    }
  }

  private normalizeError(error: unknown): EventError {
    if (error instanceof Error) {
      return {
        code: (error as any).code ?? 'UNKNOWN',
        error,
        message: error.message,
        stack: error.stack,
      };
    }

    if (error && typeof error === 'object' && 'message' in error) {
      const e = error as { code?: string; message?: string; stack?: string };
      return {
        code: e.code ?? 'UNKNOWN',
        error,
        message: e.message ?? String(error),
        stack: e.stack,
      };
    }

    return this.createError('UNKNOWN', String(error ?? 'Unknown error'), error);
  }

  private async runWithTimeout(): Promise<R> {
    const { signal, timeout } = this.options;
    if (!timeout && !signal) {
      return this.handler(this.context) as Promise<R>;
    }

    return new Promise<R>((resolve, reject) => {
      const timer = timeout && setTimeout(() => reject(this.createError('TIMEOUT', 'Task timed out')), timeout);

      const onAbort = () => {
        cleanup();
        reject(this.createError('CANCELLED', 'Task was cancelled'));
      };

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
        }
        signal?.removeEventListener('abort', onAbort);
      };

      signal?.addEventListener('abort', onAbort);

      Promise.resolve(this.handler(this.context))
        .then((result) => {
          cleanup();
          resolve(result as R);
        })
        .catch((err) => {
          cleanup();
          reject(err);
        });
    });
  }

  private wait(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);

      const onAbort = () => {
        cleanup();
        reject(this.createError('CANCELLED', 'Task was cancelled'));
      };

      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };

      signal?.addEventListener('abort', onAbort);
    });
  }
}
