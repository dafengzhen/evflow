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
  EventRecord,
  EventStore,
  EventTaskOptions,
  PlainObject,
  VersionedHandler,
} from './types.ts';

import { EventState } from './enums.ts';
import { EventCancelledError } from './event-cancelled-error.ts';
import { EventTimeoutError } from './event-timeout-error.ts';

const DEFAULT_EMIT_OPTIONS: Required<EmitOptions> = {
  globalTimeout: 0,
  parallel: true,
  stopOnError: false,
};

const now = () => Date.now();

const genId = (prefix = 'id') => `${prefix}_${now()}_${Math.random().toString(36).slice(2, 9)}`;

const safeStoreSave = async (store: EventStore | undefined, rec: EventRecord) => {
  if (!store) {
    return Promise.resolve();
  }

  try {
    return store.save(rec);
  } catch (err) {
    console.warn('store.save failed (ignored):', err);
  }
};

/**
 * EventBus.
 *
 * @author dafengzhen
 */
export class EventBus<EM extends EventMap> {
  private broadcastAdapters = new Map<string, BroadcastAdapter>();

  private broadcastFilters: BroadcastFilter[] = [];

  private handlers = new Map<keyof EM, Array<VersionedHandler<any, any>>>();

  private middlewares = new Map<keyof EM, Array<EventMiddleware<any, any>>>();

  private migrators = new Map<keyof EM, Map<number, EventMigrator<any>>>(); // key: fromVersion

  private readonly nodeId: string;

  private readonly store?: EventStore;

  private subscribedChannels = new Set<string>();

  constructor(store?: EventStore) {
    this.store = store;
    this.nodeId = `node_${Math.random().toString(36).slice(2, 9)}_${now()}`;
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
  ) {
    // 1. Execute locally first (don't block broadcasts)
    const localPromise = this.emit(eventName, context, undefined, emitOptions);

    // 2. Prepare a canonical context/message
    const baseCtx = this.normalizeContext(eventName, context);
    const channels = broadcastOptions.channels ?? ['default'];
    const adapters = this.getAdaptersToUse(broadcastOptions.adapters);
    const broadcastId = genId('broadcast');
    const message: BroadcastMessage = {
      broadcastId,
      context: {
        ...baseCtx,
        broadcast: true,
        broadcastChannels: channels,
        broadcastId,
        broadcastSource: this.nodeId,
        excludeSelf: broadcastOptions.excludeSelf ?? true,
        name: baseCtx.name!,
      },
      eventName: String(eventName),
      id: broadcastId,
      source: this.nodeId,
      timestamp: now(),
      traceId: baseCtx.traceId!,
      version: baseCtx.version!,
    };

    // 3. Publish (fire-and-forget but record failures)
    if (adapters.length > 0) {
      const tasks: Promise<unknown>[] = [];
      for (const adapter of adapters) {
        for (const ch of channels) {
          tasks.push(
            adapter.publish(ch, message).catch(async (error) => {
              console.error(`Broadcast publish failed (${adapter.name}|${ch}):`, error);
              await safeStoreSave(this.store, {
                context: message.context,
                error: (error && (error as Error).message) ?? String(error),
                id: `broadcast_fail_${broadcastId}_${adapter.name}_${ch}`,
                name: `broadcast.${String(eventName)}`,
                result: null,
                state: EventState.Failed,
                timestamp: now(),
                traceId: message.traceId,
                version: message.version,
              });
            }),
          );
        }
      }
      // schedule logging of results but don't block core flow
      Promise.allSettled(tasks).then((res) => {
        const failed = res.filter((r) => r.status === 'rejected');
        if (failed.length) {
          console.warn(`${failed.length} broadcast publishes failed`);
        }
      });
    }

    return localPromise;
  }

  async emit<K extends keyof EM, R = any>(
    eventName: K,
    context: EventContext<EM[K]> = {},
    taskOptions?: EventTaskOptions,
    emitOptions: EmitOptions = {},
  ): Promise<Array<{ error?: any; handlerIndex: number; result?: R; state: EventState; traceId: string }>> {
    const options = { ...DEFAULT_EMIT_OPTIONS, ...emitOptions };
    const normalized = this.normalizeContext(eventName, context);
    const migrated = this.migrateContext(eventName, normalized);

    const handlers = this.getHandlers(eventName, migrated.version!);
    const rawResults = await this.withGlobalTimeout(
      this.executeHandlers(handlers, migrated, taskOptions, options),
      options.globalTimeout,
    );

    // persist results (sequentially safe)
    if (this.store) {
      await Promise.all(
        rawResults.map((r) =>
          safeStoreSave(this.store, {
            context: migrated as PlainObject,
            error: r.error,
            id: `${migrated.name}_${r.handlerIndex}`,
            name: migrated.name!,
            result: r.result,
            state: r.state,
            timestamp: migrated.timestamp!,
            traceId: migrated.traceId!,
            version: migrated.version ?? 1,
          }),
        ),
      );
    }

    return rawResults;
  }

  async getDLQStats(traceId?: string) {
    const dlqRecords = await this.listDLQ(traceId);
    const byEvent: Record<string, number> = {};
    let oldest: null | number = null;
    let newest: null | number = null;

    for (const r of dlqRecords) {
      byEvent[r.name] = (byEvent[r.name] || 0) + 1;
      oldest = oldest === null ? r.timestamp : Math.min(oldest, r.timestamp);
      newest = newest === null ? r.timestamp : Math.max(newest, r.timestamp);
    }

    return {
      byEvent,
      newest: newest ? new Date(newest) : null,
      oldest: oldest ? new Date(oldest) : null,
      total: dlqRecords.length,
    };
  }

  getNodeId(): string {
    return this.nodeId;
  }

  async listDLQ(traceId?: string): Promise<EventRecord[]> {
    if (!this.store) {
      return [];
    }

    try {
      const records: EventRecord[] = traceId
        ? await this.store.load(traceId)
        : await this.store.loadByTimeRange(now() - 24 * 60 * 60 * 1000, now());
      return records.filter((r) => r.state === EventState.DeadLetter).sort((a, b) => b.timestamp - a.timestamp);
    } catch (err) {
      console.error('Failed to load DLQ records:', err);
      return [];
    }
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

    const filtered = arr.filter((h) => h.handler !== handler || (version !== undefined && h.version !== version));
    if (filtered.length) {
      this.handlers.set(eventName, filtered);
    } else {
      this.handlers.delete(eventName);
    }
  }

  on<K extends keyof EM>(eventName: K, handler: EventHandler<EM[K], any>, version = 1) {
    const arr = this.handlers.get(eventName) ?? [];
    arr.push({ handler, version });
    this.handlers.set(eventName, arr);
    return () => this.off(eventName, handler, version);
  }

  async purgeDLQ(traceId: string, dlqId: string, reason?: string): Promise<boolean> {
    if (!this.store) {
      throw new Error('EventStore is required to purge DLQ items');
    }

    const records = await this.store.load(traceId);
    const dlq = records.find((r) => r.id === dlqId && r.state === EventState.DeadLetter);
    if (!dlq) {
      return false;
    }

    await this.store.delete(traceId, dlqId);
    await safeStoreSave(this.store, {
      context: { originalDlqId: dlqId, purgedAt: now(), purgedReason: reason ?? 'manual_purge' },
      error: null,
      id: genId('purge'),
      name: 'dlq.purge',
      result: null,
      state: EventState.Cancelled,
      timestamp: now(),
      traceId,
      version: 1,
    });

    return true;
  }

  async purgeMultipleDLQ(traceId: string, dlqIds: string[]) {
    const ret: Array<{ error?: string; id: string; success: boolean }> = [];

    for (const id of dlqIds) {
      try {
        const ok = await this.purgeDLQ(traceId, id);
        ret.push({ id, success: ok });
      } catch (err) {
        ret.push({ error: err instanceof Error ? err.message : String(err), id, success: false });
      }
    }

    return ret;
  }

  registerMigrator<K extends keyof EM>(eventName: K, fromVersion: number, migrator: EventMigrator<EM[K]>) {
    if (!this.migrators.has(eventName)) {
      this.migrators.set(eventName, new Map());
    }

    this.migrators.get(eventName)!.set(fromVersion, migrator);
  }

  removeBroadcastAdapter(name: string): void {
    const adapter = this.broadcastAdapters.get(name);
    if (!adapter) {
      return;
    }

    for (const channel of this.subscribedChannels) {
      adapter.unsubscribe(channel).catch((err) => console.warn(`unsubscribe ${channel} failed:`, err));
    }

    if (adapter.disconnect) {
      adapter.disconnect().catch(console.warn);
    }

    this.broadcastAdapters.delete(name);
  }

  removeBroadcastFilter(filter: BroadcastFilter): void {
    const i = this.broadcastFilters.indexOf(filter);
    if (i >= 0) {
      this.broadcastFilters.splice(i, 1);
    }
  }

  async requeueDLQ(traceId: string, dlqId: string, emitOptions?: EmitOptions, taskOptions?: EventTaskOptions) {
    if (!this.store) {
      throw new Error('EventStore is required');
    }

    const records = await this.store.load(traceId);
    const dlq = records.find((r) => r.id === dlqId && r.state === EventState.DeadLetter);
    if (!dlq) {
      throw new Error(`DLQ record ${dlqId} not found`);
    }

    const requeueCount = Number(dlq.context.requeueCount ?? 0);
    const maxRequeue = Number(dlq.context.maxRequeue ?? 5);
    if (requeueCount >= maxRequeue) {
      throw new Error(`DLQ ${dlqId} exceeded max requeue (${maxRequeue})`);
    }

    const ctx: EventContext<any> = {
      ...dlq.context,
      disableAutoDLQ: true,
      parentId: dlq.id,
      requeueCount: requeueCount + 1,
      timestamp: undefined,
      traceId: dlq.traceId,
    };

    const requeueTaskOptions: EventTaskOptions = { retries: 0, ...(taskOptions ?? {}) };

    try {
      const results = await this.emit(dlq.name as keyof EM, ctx, requeueTaskOptions, emitOptions ?? {});
      const hasError = results.some((r) => r.error);
      if (hasError) {
        await safeStoreSave(this.store, {
          context: ctx,
          error: results.find((r) => r.error)?.error,
          id: genId('requeue'),
          name: dlq.name,
          result: null,
          state: EventState.DeadLetter,
          timestamp: now(),
          traceId: dlq.traceId,
          version: dlq.version,
        });
      }

      await this.store.delete?.(traceId, dlqId);
      return results;
    } catch (err) {
      if (requeueCount < maxRequeue) {
        await safeStoreSave(this.store, {
          context: ctx as PlainObject,
          error: err instanceof Error ? err.message : String(err),
          id: genId('requeue_err'),
          name: dlq.name,
          result: null,
          state: EventState.DeadLetter,
          timestamp: now(),
          traceId: dlq.traceId,
          version: dlq.version,
        });
      }

      await this.store.delete?.(traceId, dlqId);
      throw err;
    }
  }

  async requeueMultipleDLQ(traceId: string, dlqIds: string[]) {
    const res: Array<{ error?: string; id: string; success: boolean }> = [];

    for (const id of dlqIds) {
      try {
        await this.requeueDLQ(traceId, id);
        res.push({ id, success: true });
      } catch (err) {
        res.push({ error: err instanceof Error ? err.message : String(err), id, success: false });
      }
    }

    return res;
  }

  async subscribeBroadcast(channels: string | string[], options: { adapter?: string } = {}) {
    const list = Array.isArray(channels) ? channels : [channels];
    const adapters = this.getAdaptersToUse(options.adapter ? [options.adapter] : undefined);

    for (const adapter of adapters) {
      for (const ch of list) {
        if (this.subscribedChannels.has(ch)) {
          continue;
        }

        await adapter
          .subscribe(ch, (message: BroadcastMessage) => this.handleIncomingBroadcast(message))
          .catch((err) => {
            console.warn(`subscribe ${ch} on ${adapter.name} failed:`, err);
          });

        this.subscribedChannels.add(ch);
      }
    }
  }

  async unsubscribeBroadcast(channels: string | string[], adapterName?: string) {
    const list = Array.isArray(channels) ? channels : [channels];
    const adapters = this.getAdaptersToUse(adapterName ? [adapterName] : undefined);

    for (const adapter of adapters) {
      for (const ch of list) {
        await adapter.unsubscribe(ch).catch((err) => console.warn(`unsubscribe ${ch} failed:`, err));
        this.subscribedChannels.delete(ch);
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
    emitOptions?: Required<EmitOptions>,
  ) {
    // create tasks
    const tasks = handlers.map((handler, idx) => ({
      idx,
      task: new EventTask<PlainObject, R>((ctx) => this.runWithMiddlewares(ctx as EventContext<any>, handler), {
        ...taskOptions,
        id: `${context.name}_${idx}`,
      }),
    }));

    const runTask = async ({ idx, task }: { idx: number; task: EventTask<any, R> }) => {
      try {
        const result = await task.run({ ...context, parentId: context.id });
        return { handlerIndex: idx, result, state: task.state, traceId: context.traceId! } as const;
      } catch (err) {
        // DLQ logic: only move to DLQ if non-retryable/exhausted and auto DLQ not disabled
        try {
          const exhausted = task.attempts >= Math.max(1, Math.floor(task.opts.retries));
          const isRetryable = task.opts?.isRetryable ? task.opts.isRetryable(err) : true;
          const disableAutoDLQ = context.disableAutoDLQ === true;
          if ((!isRetryable || exhausted) && !disableAutoDLQ && this.store) {
            const rec: EventRecord = {
              context: context as PlainObject,
              error: err instanceof Error ? err.message : String(err),
              id: `${context.name}_${idx}_${now()}`,
              name: String(context.name),
              result: null,
              state: EventState.DeadLetter,
              timestamp: now(),
              traceId: context.traceId!,
              version: context.version,
            };
            await this.moveToDLQ(rec);
          }
        } catch (dlqErr) {
          console.error('DLQ handling failed:', dlqErr);
        }
        return { error: err, handlerIndex: idx, state: task.state, traceId: context.traceId! } as const;
      }
    };

    // parallel or sequential execution
    if (emitOptions?.parallel) {
      // run all in parallel and return results preserving order via mapping
      const settled = await Promise.allSettled(tasks.map((t) => runTask(t)));
      return settled.map((s) =>
        s.status === 'fulfilled'
          ? s.value
          : { error: s.reason, handlerIndex: -1, state: EventState.Failed, traceId: context.traceId! },
      );
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
  }

  private getAdaptersToUse(adapterNames?: string[]) {
    if (adapterNames && adapterNames.length > 0) {
      return adapterNames.map((n) => this.broadcastAdapters.get(n)).filter((a): a is BroadcastAdapter => !!a);
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

    return arr.reduce((p, c) => (c.version > p.version ? c : p));
  }

  private getMiddlewares<K extends keyof EM>(eventName: K) {
    return this.middlewares.get(eventName) ?? [];
  }

  private async handleIncomingBroadcast(message: BroadcastMessage) {
    try {
      const excludeSelf = message.context.excludeSelf ?? true;
      if (excludeSelf && message.source === this.nodeId) {
        return;
      }

      for (const filter of this.broadcastFilters) {
        try {
          const ok = await filter(message);
          if (!ok) {
            return;
          }
        } catch (err) {
          console.error('broadcast filter error:', err);
        }
      }

      // forward to local emit (preserve context and mark receivedAt)
      await this.emit(message.eventName as keyof EM, {
        ...message.context,
        broadcast: true,
        broadcastId: message.broadcastId,
        broadcastSource: message.source,
        meta: message.context.meta as EM[keyof EM],
        receivedAt: now(),
      });
    } catch (err) {
      console.error('Failed to handle broadcast message:', err);
      await safeStoreSave(this.store, {
        context: message.context,
        error: err instanceof Error ? err.message : String(err),
        id: genId('broadcast_handle_fail'),
        name: `broadcast.handle.${message.eventName}`,
        result: null,
        state: EventState.Failed,
        timestamp: now(),
        traceId: message.traceId,
        version: message.version,
      });
    }
  }

  private migrateContext<K extends keyof EM>(eventName: K, context: EventContext<EM[K]>) {
    let ctx = { ...context };
    const latest = this.getLatestHandler(eventName);
    if (!latest) {
      return ctx;
    }

    while ((ctx.version ?? 1) < latest.version) {
      const migrator = this.migrators.get(eventName)?.get(ctx.version ?? 1);
      if (!migrator) {
        break;
      }

      ctx = migrator(ctx);
      ctx.version = (ctx.version ?? 1) + 1;
    }

    return ctx;
  }

  private async moveToDLQ(record: EventRecord) {
    if (!this.store) {
      return;
    }

    const dlqRecord: EventRecord = {
      ...record,
      id: `dlq_${record.id}_${now()}`,
      name: record.name,
      state: EventState.DeadLetter,
      timestamp: now(),
      traceId: record.traceId,
    };

    try {
      await this.store.save(dlqRecord);
    } catch (err) {
      console.error('Failed to save DLQ record:', err);
    }
  }

  private normalizeContext<K extends keyof EM>(eventName: K, context: EventContext<EM[K]>) {
    return {
      ...context,
      name: context.name ?? String(eventName),
      timestamp: context.timestamp ?? now(),
      traceId: context.traceId ?? genId('trace'),
      version: context.version ?? 1,
    };
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
      }

      return handler(context);
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
  public attempts = 0;

  public readonly id: string;

  public lastError: any = null;

  public readonly name?: string;

  public readonly opts: Required<EventTaskOptions>;

  public state: EventState = EventState.Idle;

  private cancelled = false;

  private readonly handler: EventHandler<Ctx, R>;

  constructor(handler: EventHandler<Ctx, R>, opts?: EventTaskOptions) {
    this.id = opts?.id ?? genId('evt');
    this.name = opts?.name;
    this.handler = handler;
    this.opts = {
      id: this.id,
      isRetryable: opts?.isRetryable ?? (() => true),
      name: this.name ?? this.id,
      onStateChange: opts?.onStateChange ?? (() => {}),
      retries: Number(opts?.retries ?? 1),
      retryBackoff: Number(opts?.retryBackoff ?? 1),
      retryDelay: Number(opts?.retryDelay ?? 200),
      timeout: Number(opts?.timeout ?? 0),
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
      timestamp: context.timestamp ?? now(),
      traceId: context.traceId ?? genId('trace'),
    };

    this._setState(EventState.Running, { context });

    const maxAttempts = Math.max(1, Math.floor(this.opts.retries));
    this.attempts = 0;
    let lastErr: any = null;

    while (this.attempts < maxAttempts && !this.cancelled) {
      this.attempts++;
      try {
        const result = await this._executeOnce(context);
        if (this.cancelled) {
          // noinspection ExceptionCaughtLocallyJS
          throw new EventCancelledError();
        }

        this._setState(EventState.Succeeded, { attempt: this.attempts, result });
        return result;
      } catch (err) {
        lastErr = err;
        this.lastError = err;
        this._setState(EventState.Failed, { attempt: this.attempts, error: err });

        if (!this.opts.isRetryable(err) || this.attempts >= maxAttempts || this.cancelled) {
          break;
        }

        const delay = Math.round(this.opts.retryDelay * Math.pow(this.opts.retryBackoff, this.attempts - 1));
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    if (this.cancelled) {
      throw new EventCancelledError();
    }

    this._setState(lastErr instanceof EventTimeoutError ? EventState.Timeout : EventState.Failed, {
      attempts: this.attempts,
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
      // swallow onStateChange errors
    }
  }
}
