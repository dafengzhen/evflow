import type {
  BroadcastAdapter,
  BroadcastFilter,
  BroadcastMessage,
  BroadcastOptions,
  EmitOptions,
  EventContext,
  EventHandler,
  EventMap,
  EventMiddleware,
  EventMigrator,
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
  private broadcastAdapters: Map<string, BroadcastAdapter> = new Map();

  private broadcastFilters: BroadcastFilter[] = [];

  private handlers = new Map<keyof EM, Array<VersionedHandler<any, any>>>();

  private middlewares = new Map<keyof EM, Array<EventMiddleware<any, any>>>();

  private migrators = new Map<keyof EM, Map<number, EventMigrator<any>>>(); // key: fromVersion

  private nodeId: string;

  private readonly store?: EventStore;

  private subscribedChannels: Set<string> = new Set();

  constructor(store?: EventStore) {
    this.store = store;
    this.nodeId = `node_${Math.random().toString(36).slice(2, 9)}_${Date.now()}`;
  }

  addBroadcastAdapter(adapter: BroadcastAdapter): void {
    this.broadcastAdapters.set(adapter.name, adapter);
  }

  addBroadcastFilter(filter: BroadcastFilter): void {
    this.broadcastFilters.push(filter);
  }

  async broadcast<K extends keyof EM>(
    eventName: K,
    context: EventContext<EM[K]> = {},
    broadcastOptions: BroadcastOptions = {},
    emitOptions: EmitOptions = {},
  ): Promise<Array<{ error?: any; handlerIndex: number; result?: any; state: EventState; traceId: string }>> {
    // 1. Execute locally first
    const localResults = await this.emit(eventName, context, undefined, emitOptions);

    // 2. Prepare broadcast message
    const broadcastId = `broadcast_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const broadcastMessage: BroadcastMessage = {
      broadcastId,
      context: {
        ...context,
        broadcast: true,
        broadcastChannels: broadcastOptions.channels || ['default'],
        broadcastId,
        broadcastSource: this.nodeId,
        excludeSelf: broadcastOptions.excludeSelf ?? true,
        name: context.name ?? String(eventName),
        timestamp: context.timestamp ?? Date.now(),
        traceId: context.traceId ?? `trace_${Math.random().toString(36).slice(2, 11)}`,
        version: context.version ?? 1,
      },
      eventName: String(eventName),
      id: broadcastId,
      source: this.nodeId,
      timestamp: Date.now(),
      traceId: context.traceId ?? `trace_${Math.random().toString(36).slice(2, 11)}`,
      version: context.version ?? 1,
    };

    // 3. Send to all specified adapters
    const channels = broadcastOptions.channels || ['default'];
    const adaptersToUse = this.getAdaptersToUse(broadcastOptions.adapters);

    if (adaptersToUse.length > 0) {
      const broadcastPromises: Promise<void>[] = [];

      for (const adapter of adaptersToUse) {
        for (const channel of channels) {
          broadcastPromises.push(
            adapter.publish(channel, broadcastMessage).catch((error) => {
              console.error(`Broadcast failed on adapter ${adapter.name}, channel ${channel}:`, error);
              // Store broadcast failure if store is available
              if (this.store) {
                this.store
                  .save({
                    context: broadcastMessage.context,
                    error: error.message,
                    id: `broadcast_fail_${broadcastId}`,
                    name: `broadcast.${String(eventName)}`,
                    result: null,
                    state: EventState.Failed,
                    timestamp: Date.now(),
                    traceId: broadcastMessage.traceId,
                    version: broadcastMessage.version,
                  })
                  .catch(() => {
                    /* Ignore store errors */
                  });
              }
            }),
          );
        }
      }

      // Don't block on broadcast completion
      if (broadcastPromises.length > 0) {
        Promise.all(broadcastPromises).catch(console.error);
      }
    }

    return localResults;
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

    const migratedContext = this.migrateContext(eventName, context);

    const handlers = this.getHandlers(eventName, migratedContext.version!);

    const results = await this.withGlobalTimeout(
      this.executeHandlers(handlers, migratedContext, taskOptions, emitOptions),
      <number>emitOptions.globalTimeout,
    );

    if (this.store) {
      for (const r of results) {
        await this.store.save({
          context: migratedContext,
          error: r.error,
          id: `${migratedContext.name}_${r.handlerIndex}`,
          name: migratedContext.name!,
          result: r.result,
          state: r.state,
          timestamp: migratedContext.timestamp!,
          traceId: migratedContext.traceId!,
          version: migratedContext.version ?? 1,
        });
      }
    }

    return results;
  }

  getNodeId(): string {
    return this.nodeId;
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

  registerMigrator<K extends keyof EM>(eventName: K, fromVersion: number, migrator: EventMigrator<EM[K]>) {
    if (!this.migrators.has(eventName)) {
      this.migrators.set(eventName, new Map());
    }
    this.migrators.get(eventName)!.set(fromVersion, migrator);
  }

  removeBroadcastAdapter(name: string): void {
    const adapter = this.broadcastAdapters.get(name);
    if (adapter) {
      // Unsubscribe from all channels
      for (const channel of this.subscribedChannels) {
        adapter.unsubscribe(channel).catch((error) => {
          console.warn(`Failed to unsubscribe from channel ${channel} on adapter ${name}:`, error);
        });
      }
      // Disconnect if supported
      if (adapter.disconnect) {
        adapter.disconnect().catch(console.error);
      }
      this.broadcastAdapters.delete(name);
    }
  }

  removeBroadcastFilter(filter: BroadcastFilter): void {
    const index = this.broadcastFilters.indexOf(filter);
    if (index > -1) {
      this.broadcastFilters.splice(index, 1);
    }
  }

  async subscribeBroadcast(channels: string | string[], options: { adapter?: string } = {}): Promise<void> {
    const channelList = Array.isArray(channels) ? channels : [channels];
    const adapters = this.getAdaptersToUse(options.adapter ? [options.adapter] : undefined);

    for (const adapter of adapters) {
      for (const channel of channelList) {
        if (this.subscribedChannels.has(channel)) {
          continue;
        }

        await adapter.subscribe(channel, async (message: BroadcastMessage) => {
          await this.handleIncomingBroadcast(message);
        });

        this.subscribedChannels.add(channel);
      }
    }
  }

  async unsubscribeBroadcast(channels: string | string[], adapterName?: string): Promise<void> {
    const channelList = Array.isArray(channels) ? channels : [channels];
    const adapters = this.getAdaptersToUse(adapterName ? [adapterName] : undefined);

    for (const adapter of adapters) {
      for (const channel of channelList) {
        await adapter.unsubscribe(channel);
        this.subscribedChannels.delete(channel);
      }
    }
  }

  use<K extends keyof EM>(eventName: K, middleware: EventMiddleware<EM[K], any>) {
    const arr = this.middlewares.get(eventName) ?? [];
    arr.push(middleware);
    this.middlewares.set(eventName, arr);
    return () => {
      const updated = (this.middlewares.get(eventName) ?? []).filter((m) => m !== middleware);
      this.middlewares.set(eventName, updated);
    };
  }

  private async executeHandlers<K extends keyof EM, R>(
    handlers: EventHandler<EM[K], R>[],
    context: EventContext<EM[K]>,
    taskOptions?: EventTaskOptions,
    emitOptions?: EmitOptions,
  ) {
    const tasks = handlers.map((handler, idx) => ({
      idx,
      task: new EventTask((ctx) => this.runWithMiddlewares(ctx as EventContext<EM[K]>, handler), {
        ...taskOptions,
        id: `${context.name}_${idx}`,
      }),
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

  private getAdaptersToUse(adapterNames?: string[]): BroadcastAdapter[] {
    if (adapterNames && adapterNames.length > 0) {
      return adapterNames
        .map((name) => this.broadcastAdapters.get(name))
        .filter((adapter): adapter is BroadcastAdapter => adapter !== undefined);
    }
    return Array.from(this.broadcastAdapters.values());
  }

  private getHandlers<K extends keyof EM>(eventName: K, version: number) {
    return (this.handlers.get(eventName) ?? []).filter((h) => h.version === version).map((h) => h.handler);
  }

  private getLatestHandler<K extends keyof EM>(eventName: K) {
    const arr = this.handlers.get(eventName) ?? [];
    if (!arr.length) {
      return null;
    }
    return arr.reduce((prev, cur) => (cur.version > prev.version ? cur : prev));
  }

  private getMiddlewares<K extends keyof EM>(eventName: K) {
    return this.middlewares.get(eventName) ?? [];
  }

  private async handleIncomingBroadcast(message: BroadcastMessage): Promise<void> {
    try {
      // Avoid processing our own messages if excludeSelf is true
      const excludeSelf = message.context.excludeSelf ?? true;
      if (excludeSelf && message.source === this.nodeId) {
        return;
      }

      // Apply filters
      for (const filter of this.broadcastFilters) {
        try {
          const shouldProcess = await filter(message);
          if (!shouldProcess) {
            return; // Filter rejected the message
          }
        } catch (error) {
          console.error('Error in broadcast filter:', error);
          // Continue processing if filter fails
        }
      }

      // Execute the event with broadcast context
      await this.emit(message.eventName, {
        ...message.context,
        broadcast: true,
        broadcastId: message.broadcastId,
        broadcastSource: message.source,
        meta: message.context.meta as EM[keyof EM],
        receivedAt: Date.now(),
      });
    } catch (error) {
      console.error(`Failed to handle broadcast message ${message.id}:`, error);

      // Store broadcast handling failure if store is available
      if (this.store) {
        this.store
          .save({
            context: message.context,
            error: error instanceof Error ? error.message : String(error),
            id: `broadcast_handle_fail_${message.id}`,
            name: `broadcast.handle.${message.eventName}`,
            result: null,
            state: EventState.Failed,
            timestamp: Date.now(),
            traceId: message.traceId,
            version: message.version,
          })
          .catch(() => {
            /* Ignore store errors */
          });
      }
    }
  }

  private migrateContext<K extends keyof EM>(eventName: K, context: EventContext<EM[K]>): EventContext<EM[K]> {
    let ctx = { ...context };
    const latest = this.getLatestHandler(eventName);
    if (!latest) {
      return ctx;
    }

    while (ctx.version! < latest.version) {
      const migrator = this.migrators.get(eventName)?.get(ctx.version!);
      if (!migrator) {
        break;
      }
      ctx = migrator(ctx);
      ctx.version = ctx.version! + 1;
    }

    return ctx;
  }

  private async runWithMiddlewares<K extends keyof EM, R>(
    context: EventContext<EM[K]>,
    handler: EventHandler<EM[K], R>,
  ): Promise<R> {
    const middlewares = this.getMiddlewares(context.name as K);
    let idx = -1;

    const dispatch = async (): Promise<R> => {
      idx++;
      if (idx < middlewares.length) {
        return middlewares[idx](context, dispatch);
      } else {
        return handler(context);
      }
    };

    return dispatch();
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
