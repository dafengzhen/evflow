import type {
  EventContext,
  EventEmitResult,
  EventError,
  EventHandler,
  EventState,
  EventTask,
  EventTaskOptions,
} from '../types/types.ts';

/**
 * EventTaskImpl.
 *
 * @author dafengzhen
 */
export class EventTaskImpl<R = unknown> implements EventTask<R> {
  constructor(
    private readonly context: EventContext,
    private readonly handler: EventHandler,
    private readonly options: EventTaskOptions = {},
  ) {}

  async execute(): Promise<EventEmitResult<R>> {
    const { isRetryable, maxRetries = 0, onRetry, onStateChange, retryDelay, signal } = this.options;

    let attempt = 0;
    let state: EventState = 'pending';

    const changeState = (newState: EventState) => {
      if (state !== newState) {
        state = newState;
        onStateChange?.(state);
      }
    };

    try {
      changeState('running');

      while (true) {
        this.ensureNotCancelled(signal);

        try {
          const result = await this.runWithTimeout();
          changeState('succeeded');
          return this.createResult('succeeded', result);
        } catch (error) {
          this.ensureNotCancelled(signal);

          const eventError = this.normalizeError(error);

          if (eventError.code === 'CANCELLED') {
            changeState('cancelled');
            return this.createResult('cancelled', undefined, eventError);
          }

          const shouldRetry = attempt < maxRetries && (isRetryable ? isRetryable(eventError) : true);

          if (!shouldRetry) {
            changeState('failed');
            return this.createResult('failed', undefined, eventError);
          }

          attempt++;
          changeState('retrying');
          onRetry?.(attempt, eventError);

          const delay = typeof retryDelay === 'function' ? retryDelay(attempt) : (retryDelay ?? 0);

          if (delay > 0) {
            try {
              await this.wait(delay, signal);
            } catch (waitError) {
              const waitEventError = this.normalizeError(waitError);

              if (waitEventError.code === 'CANCELLED') {
                changeState('cancelled');
                return this.createResult('cancelled', undefined, waitEventError);
              }

              // noinspection ExceptionCaughtLocallyJS
              throw waitError;
            }
          }
        }
      }
    } catch (error) {
      const eventError = this.normalizeError(error);

      if (eventError.code === 'CANCELLED') {
        changeState('cancelled');
        return this.createResult('cancelled', undefined, eventError);
      }

      changeState('failed');
      return this.createResult('failed', undefined, eventError);
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

    if (typeof error === 'object' && error !== null && 'message' in error) {
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
      return (await Promise.resolve(this.handler(this.context))) as Promise<R>;
    }

    return new Promise<R>((resolve, reject) => {
      const timer = timeout ? setTimeout(() => reject(this.createError('TIMEOUT', 'Task timed out')), timeout) : null;

      const cleanup = () => {
        if (timer) {
          clearTimeout(timer);
        }
        signal?.removeEventListener('abort', onAbort);
      };

      const onAbort = () => {
        cleanup();
        reject(this.createError('CANCELLED', 'Task was cancelled'));
      };

      signal?.addEventListener('abort', onAbort);

      Promise.resolve(this.handler(this.context))
        .then((result) => {
          cleanup();
          resolve(result as R);
        })
        .catch((error) => {
          cleanup();
          reject(error);
        });
    });
  }

  private wait(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);

      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };

      const onAbort = () => {
        cleanup();
        reject(this.createError('CANCELLED', 'Task was cancelled'));
      };

      signal?.addEventListener('abort', onAbort);
    });
  }
}
