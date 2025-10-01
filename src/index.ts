import type {
  EmitOptions,
  EventContext,
  EventHandler,
  EventMap,
  EventStore,
  EventTaskOptions,
  PlainObject,
  VersionedHandler,
} from './types.js';

import { EventCancelledError } from './event-cancelled-error.js';
import { EventTimeoutError } from './event-timeout-error.js';
import { EventState } from './types.js';

/**
 * EventBus.
 *
 * @author dafengzhen
 */
export class EventBus<EM extends EventMap> {
  private handlers = new Map<keyof EM, Array<VersionedHandler<any, any>>>();
  private readonly store?: EventStore;

  constructor(store?: EventStore) {
    this.store = store;
  }

  async emit<K extends keyof EM, R = any>(
    eventName: K,
    context: EventContext<EM[K]> = {},
    taskOptions?: EventTaskOptions,
    emitOptions: EmitOptions = { globalTimeout: 0, parallel: true, stopOnError: false },
  ): Promise<Array<{ error?: any; handlerIndex: number; result?: R; state: EventState; traceId: string }>> {
    context = {
      ...context,
      name: context.name ?? String(eventName),
      timestamp: context.timestamp ?? Date.now(),
      traceId: context.traceId ?? `trace_${Math.random().toString(36).slice(2, 11)}`,
      version: context.version ?? 1,
    };

    const handlers = this.getHandlers(eventName, context.version!);

    const results = await this.withGlobalTimeout(
      this.executeHandlers(handlers, context, taskOptions, emitOptions),
      <number>emitOptions.globalTimeout,
    );

    if (this.store) {
      for (const r of results) {
        await this.store.save({
          context,
          error: r.error,
          id: `${context.name}_${r.handlerIndex}`,
          name: context.name!,
          result: r.result,
          state: r.state,
          timestamp: context.timestamp!,
          traceId: context.traceId!,
          version: (context as any).version ?? 1,
        });
      }
    }

    return results;
  }

  off<K extends keyof EM>(eventName: K, handler?: EventHandler<EM[K], any>, version?: number) {
    if (!handler) {
      this.handlers.delete(eventName);
      return;
    }
    const arr = this.handlers.get(eventName);
    if (!arr) {
      return;
    }

    const filtered = arr.filter((h) => h.handler !== handler || (version && h.version !== version));
    if (filtered.length) {
      this.handlers.set(eventName, filtered);
    } else {
      this.handlers.delete(eventName);
    }
  }

  on<K extends keyof EM>(eventName: K, handler: EventHandler<EM[K], any>, version: number = 1) {
    const arr = this.handlers.get(eventName) ?? [];
    arr.push({ handler, version });
    this.handlers.set(eventName, arr);
    return () => this.off(eventName, handler);
  }

  private async executeHandlers<K extends keyof EM, R>(
    handlers: EventHandler<EM[K], R>[],
    context: EventContext<EM[K]>,
    taskOptions?: EventTaskOptions,
    emitOptions?: EmitOptions,
  ) {
    const tasks = handlers.map((handler, idx) => ({
      idx,
      task: new EventTask(handler, { ...taskOptions, id: `${context.name}_${idx}` }),
    }));

    const runTask = async ({ idx, task }: { idx: number; task: EventTask<EM[K], R> }) => {
      try {
        const result = await task.run({ ...context, parentId: context.id });
        return { handlerIndex: idx, result, state: task.state, traceId: context.traceId! };
      } catch (err) {
        return { error: err, handlerIndex: idx, state: task.state, traceId: context.traceId! };
      }
    };

    const exec = async () => {
      if (emitOptions?.parallel) {
        return Promise.all(tasks.map(runTask));
      }

      const results: any[] = [];
      for (const t of tasks) {
        const r = await runTask(t);
        results.push(r);
        if (r.error && emitOptions?.stopOnError) {
          break;
        }
      }
      return results;
    };

    return exec();
  }

  private getHandlers<K extends keyof EM>(eventName: K, version: number) {
    return (this.handlers.get(eventName) ?? []).filter((h) => h.version === version).map((h) => h.handler);
  }

  private withGlobalTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    if (!timeout || timeout <= 0) {
      return promise;
    }
    return Promise.race([
      promise,
      new Promise<T>((_, rej) =>
        setTimeout(() => rej(new EventTimeoutError(`Global emit timeout after ${timeout}ms`)), timeout),
      ),
    ]);
  }
}

/**
 * EventTask.
 *
 * @author dafengzhen
 */
export class EventTask<Ctx extends PlainObject = PlainObject, R = any> {
  public readonly id: string;
  public readonly name?: string;
  public state: EventState = EventState.Idle;
  private cancelled = false;
  private readonly handler: EventHandler<Ctx, R>;
  private readonly opts: Required<EventTaskOptions>;

  constructor(handler: EventHandler<Ctx, R>, opts?: EventTaskOptions) {
    this.id = opts?.id ?? `evt_${Math.random().toString(36).slice(2, 9)}`;
    this.name = opts?.name;
    this.handler = handler;
    this.opts = {
      id: this.id,
      isRetryable: opts?.isRetryable ?? (() => true),
      name: this.name ?? this.id,
      onStateChange: opts?.onStateChange ?? (() => {}),
      retries: opts?.retries ?? 1,
      retryBackoff: opts?.retryBackoff ?? 1,
      retryDelay: opts?.retryDelay ?? 200,
      timeout: opts?.timeout ?? 0,
    };
  }

  cancel() {
    if (this.cancelled) {
      return;
    }
    this.cancelled = true;
    this._setState(EventState.Cancelled);
  }

  async run(context: EventContext<Ctx> = {}): Promise<R> {
    if (this.state === EventState.Running) {
      throw new Error('Task is already running');
    }

    context = {
      ...context,
      id: context.id ?? this.id,
      name: context.name ?? this.name,
      timestamp: Date.now(),
      traceId: context.traceId ?? `trace_${Math.random().toString(36).slice(2, 11)}`,
    };

    this._setState(EventState.Running, { context });

    const maxAttempts = Math.max(1, Math.floor(this.opts.retries));
    let attempt = 0;
    let lastErr: any = null;

    while (attempt < maxAttempts && !this.cancelled) {
      attempt++;
      try {
        const result = await this._executeOnce(context);
        if (this.cancelled) {
          // noinspection ExceptionCaughtLocallyJS
          throw new EventCancelledError();
        }

        this._setState(EventState.Succeeded, { attempt, result });
        return result;
      } catch (err) {
        lastErr = err;
        this._setState(EventState.Failed, { attempt, error: err });
        if (!this.opts.isRetryable(err) || attempt >= maxAttempts || this.cancelled) {
          break;
        }

        const delay = Math.round(this.opts.retryDelay * Math.pow(this.opts.retryBackoff, attempt - 1));
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    if (this.cancelled) {
      throw new EventCancelledError();
    }

    this._setState(lastErr instanceof EventTimeoutError ? EventState.Timeout : EventState.Failed, {
      attempts: attempt,
      error: lastErr,
    });
    throw lastErr;
  }

  private _executeOnce(context: EventContext<Ctx>): Promise<R> {
    if (this.cancelled) {
      return Promise.reject(new EventCancelledError());
    }

    const run = () => Promise.resolve().then(() => this.handler(context));
    if (!this.opts.timeout) {
      return run();
    }

    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new EventTimeoutError(`Task ${this.id} timed out after ${this.opts.timeout}ms`)),
        this.opts.timeout,
      );
      run()
        .then(resolve, reject)
        .finally(() => clearTimeout(timer));
    });
  }

  private _setState(state: EventState, info?: any) {
    this.state = state;
    try {
      this.opts.onStateChange(state, info);
    } catch {
      /* empty */
    }
  }
}
