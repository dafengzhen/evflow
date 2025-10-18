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
  private readonly context: EventContext;

  private readonly handler: EventHandler<any, any, any, any>;

  private readonly opts: EventTaskOptions;

  constructor(context: EventContext, handler: EventHandler<any, any, any, any>, options: EventTaskOptions = {}) {
    this.context = context;
    this.handler = handler;
    this.opts = {
      isRetryable: options.isRetryable,
      maxRetries: options.maxRetries ?? 0,
      onRetry: options.onRetry ?? (() => {}),
      onStateChange: options.onStateChange ?? (() => {}),
      onTimeout: options.onTimeout ?? (() => {}),
      retryDelay: options.retryDelay ?? 0,
      signal: options.signal,
      timeout: options.timeout ?? 0,
    };
  }

  async execute(): Promise<EventEmitResult<R>> {
    let attempt = 0;
    let state: EventState = 'pending';

    const setState = (s: EventState) => {
      if (state !== s) {
        state = s;
        try {
          this.opts.onStateChange?.(s);
        } catch {
          /* empty */
        }
      }
    };

    try {
      setState('running');

      while (true) {
        this.ensureNotCancelled(this.opts.signal);

        try {
          const result = await this.runHandlerWithTimeoutAndSignal(this.opts.signal, this.opts.timeout);
          setState('succeeded');
          return this.createResult('succeeded', result);
        } catch (rawErr) {
          const err = this.normalizeError(rawErr);

          if (err.code === 'TIMEOUT' && this.opts.timeout) {
            try {
              this.opts.onTimeout?.(this.opts.timeout, 'handler-execution');
            } catch {
              /* empty */
            }
          }

          if (err.code === 'CANCELLED') {
            setState('cancelled');
            return this.createResult('cancelled', undefined, err);
          }

          const canRetry =
            attempt < this.opts.maxRetries! && (this.opts.isRetryable ? this.opts.isRetryable(err) : true);

          if (!canRetry) {
            setState('failed');
            return this.createResult('failed', undefined, err);
          }

          attempt++;
          setState('retrying');
          try {
            this.opts.onRetry?.(attempt, err);
          } catch {
            /* empty */
          }

          const delay =
            typeof this.opts.retryDelay === 'function' ? this.opts.retryDelay(attempt) : this.opts.retryDelay!;
          if (delay > 0) {
            try {
              await this.wait(delay, this.opts.signal);
            } catch (waitErr) {
              const wErr = this.normalizeError(waitErr);
              if (wErr.code === 'CANCELLED') {
                setState('cancelled');
                return this.createResult('cancelled', undefined, wErr);
              }
              setState('failed');
              return this.createResult('failed', undefined, wErr);
            }
          }
        }
      }
    } catch (rawErr) {
      const err = this.normalizeError(rawErr);
      if (err.code === 'CANCELLED') {
        setState('cancelled');
        return this.createResult('cancelled', undefined, err);
      }
      setState('failed');
      return this.createResult('failed', undefined, err);
    }
  }

  private createError(code: string, message?: string, error?: unknown): EventError {
    return {
      code,
      message: message ?? (error instanceof Error ? error.message : String(error ?? '')),
      error,
      stack: error instanceof Error ? error.stack : undefined,
    };
  }

  private createResult(state: EventState, result?: R, error?: EventError): EventEmitResult<R> {
    return { state, result, error };
  }

  private ensureNotCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw this.createError('CANCELLED', 'Task was cancelled');
    }
  }

  private normalizeError(err: unknown): EventError {
    if (err && typeof err === 'object') {
      const e = err as Partial<EventError> & { message?: string; code?: string; stack?: string };
      if (e.code && (e as EventError).message) {
        return {
          code: e.code,
          message: e.message ?? String(err),
          error: err,
          stack: e.stack,
        };
      }
      if (err instanceof Error) {
        return {
          code: (err as any).code ?? 'UNKNOWN',
          error: err,
          message: err.message,
          stack: err.stack,
        };
      }
      return {
        code: (e.code as string) ?? 'UNKNOWN',
        error: err,
        message: e.message ?? JSON.stringify(err),
        stack: e.stack,
      };
    }
    return this.createError('UNKNOWN', String(err ?? 'Unknown error'), err);
  }

  private async runHandlerWithTimeoutAndSignal(externalSignal?: AbortSignal, timeout = 0): Promise<R> {
    if (!timeout && !externalSignal) {
      return (await Promise.resolve(this.handler(this.context))) as R;
    }

    const controller = new AbortController();
    const internalSignal = controller.signal;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      externalSignal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      controller.abort();
    };

    externalSignal?.addEventListener('abort', onAbort);

    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        if (!internalSignal.aborted) {
          controller.abort();
        }
      }, timeout);
    }

    try {
      return (await Promise.race([
        Promise.resolve(this.handler(this.context)),
        new Promise<never>((_, rej) => {
          internalSignal.addEventListener(
            'abort',
            () => {
              cleanup();
              if (externalSignal?.aborted) {
                rej(this.createError('CANCELLED', 'Task was cancelled'));
              } else if (timeout > 0 && timeoutId !== undefined) {
                rej(this.createError('TIMEOUT', `Task timed out after ${timeout}ms`));
              } else {
                rej(this.createError('CANCELLED', 'Task was cancelled'));
              }
            },
            { once: true },
          );
        }),
      ])) as R;
    } finally {
      cleanup();
    }
  }

  private wait(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return reject(this.createError('CANCELLED', 'Task was cancelled'));
      }

      const id = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);

      const onAbort = () => {
        cleanup();
        reject(this.createError('CANCELLED', 'Task was cancelled'));
      };

      function cleanup() {
        clearTimeout(id);
        signal?.removeEventListener('abort', onAbort);
      }

      signal?.addEventListener('abort', onAbort);
    });
  }
}
