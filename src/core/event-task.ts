import type { EventContext, EventHandler, EventTaskOptions, PlainObject } from '../types.ts';

import { EventState } from '../enums.ts';
import { EventCancelledError, EventTimeoutError } from '../errors.ts';
import { genId, now } from '../utils.ts';

/**
 * EventBus.
 *
 * @author dafengzhen
 */
export class EventTask<Ctx extends PlainObject = PlainObject, R = any> {
  public attempts = 0;

  public readonly id: string;

  public lastError: unknown = null;

  public readonly name?: string;

  public readonly opts: Required<EventTaskOptions>;

  public state: EventState = EventState.Idle;

  private abortController?: AbortController;

  private readonly handler: EventHandler<Ctx, R>;

  private isAborted = false;

  private isDestroyed = false;

  constructor(handler: EventHandler<Ctx, R>, opts?: EventTaskOptions) {
    this.id = opts?.id ?? genId('evt');
    this.name = opts?.name;
    this.handler = handler;

    this.opts = {
      id: this.id,
      isRetryable: opts?.isRetryable ?? (() => true),
      name: this.name ?? this.id,
      onStateChange: opts?.onStateChange ?? (() => {}),
      retries: Math.max(0, opts?.retries ?? 1),
      retryBackoff: Math.max(1, opts?.retryBackoff ?? 1),
      retryDelay: Math.max(0, opts?.retryDelay ?? 200),
      timeout: Math.max(0, opts?.timeout ?? 0),
    };
  }

  cancel(): void {
    if (this.isAborted || this.isDestroyed) {
      return;
    }

    this.isAborted = true;
    this.abortController?.abort();
    this.setState(EventState.Cancelled);
  }

  cleanup(): void {
    this.isDestroyed = true;
    this.cancel();
  }

  async run(context: EventContext<Ctx> = {}): Promise<R> {
    this.validateExecutionState();

    const executionContext = this.buildExecutionContext(context);
    this.setState(EventState.Running, { context: executionContext });

    const maxAttempts = Math.max(1, this.opts.retries + 1);
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.checkCancellation();
      this.attempts = attempt;

      try {
        const result = await this.executeWithTimeout(executionContext);
        this.setState(EventState.Succeeded, { attempt, result });
        return result;
      } catch (error) {
        lastError = error;
        this.lastError = error;
        this.setState(EventState.Failed, { attempt, error });

        if (!this.shouldRetry(error) || attempt >= maxAttempts) {
          break;
        }

        await this.delayBeforeRetry(attempt);
      }
    }

    this.checkCancellation();
    this.handleFinalError(lastError);
    throw lastError;
  }

  private buildExecutionContext(context: EventContext<Ctx>): EventContext<Ctx> {
    return {
      ...context,
      id: context.id ?? this.id,
      name: context.name ?? this.name,
      timestamp: context.timestamp ?? now(),
      traceId: context.traceId ?? genId('trace'),
    };
  }

  private checkCancellation(): void {
    if (this.isAborted || this.isDestroyed) {
      throw new EventCancelledError();
    }
  }

  private async createTimeoutRace(handlerPromise: Promise<R>, signal: AbortSignal): Promise<R> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timeoutId = setTimeout(() => {
        this.abortController?.abort();
        reject(new EventTimeoutError(`Task ${this.id} timed out after ${this.opts.timeout}ms`));
      }, this.opts.timeout);

      signal.addEventListener('abort', () => clearTimeout(timeoutId), {
        once: true,
      });
    });

    return Promise.race([handlerPromise, timeoutPromise]);
  }

  private async delayBeforeRetry(attempt: number): Promise<void> {
    const delay = Math.round(this.opts.retryDelay * Math.pow(this.opts.retryBackoff, attempt - 1));

    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  private async executeWithTimeout(context: EventContext<Ctx>): Promise<R> {
    this.checkCancellation();

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const handlerPromise = Promise.resolve()
      .then(() => this.handler({ ...context, signal }))
      .then((result) => {
        this.checkCancellation();
        return result;
      });

    if (this.opts.timeout <= 0) {
      return handlerPromise;
    }

    return this.createTimeoutRace(handlerPromise, signal);
  }

  private handleFinalError(error: unknown): void {
    const finalState = error instanceof EventTimeoutError ? EventState.Timeout : EventState.Failed;

    this.setState(finalState, {
      attempts: this.attempts,
      error,
    });
  }

  private setState(state: EventState, info?: PlainObject): void {
    if (this.isDestroyed) {
      return;
    }

    this.state = state;
    try {
      this.opts.onStateChange(state, info);
    } catch (error) {
      console.error('Error in onStateChange callback:', error);
    }
  }

  private shouldRetry(error: unknown): boolean {
    return this.opts.isRetryable(error);
  }

  private validateExecutionState(): void {
    if (this.state === EventState.Running) {
      throw new Error('Task is already running');
    }

    this.checkCancellation();
  }
}
