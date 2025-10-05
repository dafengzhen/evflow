import type {
  BroadcastOptions,
  DLQOperationResult,
  EmitOptions,
  EmitResult,
  ErrorType,
  EventBusOptions,
  EventContext,
  EventHandler,
  EventMap,
  EventMiddleware,
  EventMigrator,
  EventRecord,
  EventStore,
  EventTaskOptions,
  HandlerUsageStats,
  HealthCheckResult,
} from '../types.ts';

import { EventTimeoutError } from '../errors.ts';
import { BroadcastManager, DLQManager, HandlerManager, StoreManager } from '../manager/index.ts';
import { DEFAULT_EMIT_OPTIONS, now } from '../utils.ts';
import { ContextNormalizer } from './context-normalizer.ts';
import { ErrorHandler } from './error-handler.ts';
import { HandlerExecutor } from './handler-executor.ts';

/**
 * EventBus.
 *
 * @author dafengzhen
 */
export class EventBus<EM extends EventMap> {
  private readonly broadcastManager: BroadcastManager<EM>;

  private cleanupInterval?: ReturnType<typeof setInterval>;

  private readonly contextNormalizer: ContextNormalizer<EM>;

  private readonly dlqManager: DLQManager<EM>;

  private readonly errorHandler: ErrorHandler<EM>;

  private readonly handlerExecutor: HandlerExecutor<EM>;

  private readonly handlerManager: HandlerManager<EM>;

  private isDestroyed = false;

  private metrics = {
    broadcastMessages: 0,
    dlqOperations: 0,
    eventsFailed: 0,
    eventsProcessed: 0,
    handlersExecuted: 0,
  };

  private readonly nodeId: string;

  private readonly options: Required<EventBusOptions>;

  private readonly storeManager: StoreManager<EM>;

  constructor(store?: EventStore, options: EventBusOptions = {}) {
    this.nodeId = `node_${Math.random().toString(36).slice(2, 9)}_${now()}`;
    this.options = this.initializeOptions(options);

    this.storeManager = new StoreManager(store, this.handleError.bind(this));
    this.broadcastManager = new BroadcastManager(
      this.nodeId,
      this.handleError.bind(this),
      this.options.maxProcessedBroadcasts,
    );
    this.handlerManager = new HandlerManager(this.options.maxHandlersPerEvent, this.options.maxMiddlewarePerEvent);
    this.dlqManager = new DLQManager(this.storeManager, this.handleError.bind(this));

    this.errorHandler = new ErrorHandler(this.options.errorHandler, this.storeManager);
    this.contextNormalizer = new ContextNormalizer();
    this.handlerExecutor = new HandlerExecutor(this.handlerManager, this.dlqManager, this.errorHandler);

    this.broadcastManager.setEmitHandler(this.emit.bind(this));

    if (this.options.cleanupIntervalMs > 0) {
      this.startCleanup();
    }
  }

  addBroadcastAdapter(adapter: any): void {
    this.checkActive();
    this.broadcastManager.addBroadcastAdapter(adapter);
  }

  addBroadcastFilter(filter: any): void {
    this.checkActive();
    this.broadcastManager.addBroadcastFilter(filter);
  }

  async broadcast<K extends keyof EM, R = any>(
    eventName: K,
    context: EventContext<EM[K]> = {} as EventContext<EM[K]>,
    broadcastOptions: BroadcastOptions = {},
    emitOptions: EmitOptions = {},
  ): Promise<EmitResult<R>[]> {
    this.checkActive();
    this.validateEventName(eventName);

    const normalized = this.contextNormalizer.normalize(eventName, context);
    const result = await this.broadcastManager.broadcast(eventName, normalized, broadcastOptions, (evtName, ctx) =>
      this.emit(evtName, ctx, undefined, emitOptions),
    );

    this.metrics.broadcastMessages++;
    return result;
  }

  async destroy(): Promise<void> {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;
    this.stopCleanup();

    await Promise.allSettled([this.broadcastManager.destroy(), this.storeManager.destroy()]);

    this.handlerManager.destroy();
    this.dlqManager.destroy();

    // Reset metrics
    this.metrics = {
      broadcastMessages: 0,
      dlqOperations: 0,
      eventsFailed: 0,
      eventsProcessed: 0,
      handlersExecuted: 0,
    };
  }

  async emit<K extends keyof EM, R = any>(
    eventName: K,
    context: EventContext<EM[K]> = {} as EventContext<EM[K]>,
    taskOptions?: EventTaskOptions,
    emitOptions: EmitOptions = {},
  ): Promise<EmitResult<R>[]> {
    this.checkActive();
    this.validateEventName(eventName);

    const options = this.validateEmitOptions(emitOptions);
    const normalized = this.contextNormalizer.normalize(eventName, context);

    this.handlerManager.trackHandlerUsage(eventName, normalized.version!);
    this.handlerManager.trackMiddlewareUsage(eventName);

    const migrated = await this.migrateContext(eventName, normalized);

    const handlers = this.handlerManager.getHandlers(eventName, migrated.version!);
    if (handlers.length === 0) {
      return [];
    }

    try {
      const executePromise = this.handlerExecutor.executeHandlers(handlers, migrated, taskOptions, options);

      const rawResults = await this.withGlobalTimeout(executePromise, options.globalTimeout);

      this.metrics.eventsProcessed++;
      this.metrics.handlersExecuted += handlers.length;

      try {
        await this.storeManager.saveEventResults(migrated, rawResults);
      } catch (storeErr) {
        await this.handleError(this.toError(storeErr), migrated, 'store');
      }

      return rawResults;
    } catch (err) {
      this.metrics.eventsFailed++;
      throw err;
    }
  }

  async getDLQStats(
    traceId?: string,
  ): Promise<{ byEvent: Record<string, number>; newest: Date | null; oldest: Date | null; total: number }> {
    return this.dlqManager.getDLQStats(traceId);
  }

  getMetrics() {
    return { ...this.metrics, nodeId: this.nodeId };
  }

  getNodeId(): string {
    return this.nodeId;
  }

  getUsageStats(): HandlerUsageStats {
    return this.handlerManager.getUsageStats();
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const adapterStatus = await this.broadcastManager.checkBroadcastAdapters();
    const storeStatus = await this.storeManager.checkStoreHealth();
    const allHealthy = adapterStatus.every((a) => a.healthy);
    const storeHealthy = ['healthy', 'not_configured'].includes(storeStatus.status);

    return {
      details: {
        adapters: adapterStatus,
        metrics: this.getMetrics(),
        store: storeStatus,
      },
      status: allHealthy && storeHealthy ? 'healthy' : 'degraded',
    };
  }

  async listDLQ(traceId?: string): Promise<EventRecord[]> {
    return this.dlqManager.listDLQ(traceId);
  }

  off<K extends keyof EM>(eventName: K, handler?: EventHandler<EM, K, any>, version?: number): boolean {
    this.checkActive();
    return this.handlerManager.off(eventName, handler, version);
  }

  on<K extends keyof EM>(eventName: K, handler: EventHandler<EM, K, any>, version = 1): () => void {
    this.checkActive();
    return this.handlerManager.on(eventName, handler, version);
  }

  async purgeDLQ(traceId: string, dlqId: string, reason?: string): Promise<boolean> {
    const result = await this.dlqManager.purgeDLQ(traceId, dlqId, reason);
    if (result) {
      this.metrics.dlqOperations++;
    }
    return result;
  }

  async purgeMultipleDLQ(
    traceId: string,
    dlqIds: string[],
  ): Promise<{ error?: string; id: string; success: boolean }[]> {
    const results = await this.dlqManager.purgeMultipleDLQ(traceId, dlqIds);
    this.metrics.dlqOperations += results.filter((r) => r.success).length;
    return results;
  }

  registerMigrator<K extends keyof EM>(eventName: K, fromVersion: number, migrator: EventMigrator<EM, K>): () => void {
    this.checkActive();
    return this.handlerManager.registerMigrator(eventName, fromVersion, migrator);
  }

  removeBroadcastAdapter(name: string): void {
    this.checkActive();
    this.broadcastManager.removeBroadcastAdapter(name);
  }

  removeBroadcastFilter(filter: any): void {
    this.checkActive();
    this.broadcastManager.removeBroadcastFilter(filter);
  }

  async requeueDLQ(
    traceId: string,
    dlqId: string,
    emitOptions?: EmitOptions,
    taskOptions?: EventTaskOptions,
  ): Promise<DLQOperationResult> {
    const result = await this.dlqManager.requeueDLQ(traceId, dlqId, this.emit.bind(this), emitOptions, taskOptions);
    this.metrics.dlqOperations++;
    return result;
  }

  async requeueMultipleDLQ(
    traceId: string,
    dlqIds: string[],
  ): Promise<{ error?: string; id: string; success: boolean }[]> {
    const results = await this.dlqManager.requeueMultipleDLQ(traceId, dlqIds, this.emit.bind(this));
    this.metrics.dlqOperations += results.filter((r) => r.success).length;
    return results;
  }

  startCleanup(): void {
    this.stopCleanup();
    this.cleanupInterval = setInterval(() => this.cleanupInactiveHandlers(), this.options.cleanupIntervalMs);
  }

  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }

  async subscribeBroadcast(channels: string | string[], options: { adapter?: string } = {}): Promise<void> {
    this.checkActive();
    return this.broadcastManager.subscribeBroadcast(channels, options);
  }

  async unsubscribeBroadcast(channels: string | string[], adapterName?: string): Promise<void> {
    this.checkActive();
    return this.broadcastManager.unsubscribeBroadcast(channels, adapterName);
  }

  use<K extends keyof EM>(eventName: K, middleware: EventMiddleware<EM, K, any>): () => void {
    this.checkActive();
    return this.handlerManager.use(eventName, middleware);
  }

  private checkActive(): void {
    if (this.isDestroyed) {
      throw new Error('EventBus has been destroyed');
    }
  }

  private cleanupInactiveHandlers(): void {
    try {
      if (typeof this.handlerManager.cleanup === 'function') {
        this.handlerManager.cleanup({
          handlerInactivityThreshold: this.options.handlerInactivityThreshold,
          middlewareInactivityThreshold: this.options.middlewareInactivityThreshold,
          migratorInactivityThreshold: this.options.migratorInactivityThreshold,
        });
      }
    } catch (err) {
      // Ensure cleanup failures don't crash the interval
      void this.handleError(this.toError(err), {}, 'cleanup');
    }
  }

  private async handleError<K extends keyof EM>(
    error: Error,
    context: EventContext<EM[K]>,
    type: ErrorType,
  ): Promise<void> {
    await this.errorHandler.handle(error, context, type);
  }

  private initializeOptions(options: EventBusOptions): Required<EventBusOptions> {
    return {
      cleanupIntervalMs: options.cleanupIntervalMs === undefined ? 0 : (options.cleanupIntervalMs ?? 300000), // 5 minutes
      errorHandler: options.errorHandler ?? (() => {}),
      handlerInactivityThreshold: options.handlerInactivityThreshold ?? 3600000, // 1 hour
      maxHandlersPerEvent: options.maxHandlersPerEvent ?? 100,
      maxMiddlewarePerEvent: options.maxMiddlewarePerEvent ?? 50,
      maxProcessedBroadcasts: options.maxProcessedBroadcasts ?? 10000,
      middlewareInactivityThreshold: options.middlewareInactivityThreshold ?? 7200000, // 2 hours
      migratorInactivityThreshold: options.migratorInactivityThreshold ?? 86400000, // 24 hours
    };
  }

  private async migrateContext<K extends keyof EM>(
    eventName: K,
    context: EventContext<EM[K]>,
  ): Promise<EventContext<EM[K]>> {
    try {
      const migrated = this.handlerManager.migrateContext(eventName, context);
      this.handlerManager.trackMigratorUsage(eventName);
      return migrated;
    } catch (err) {
      await this.handleError(this.toError(err), context, 'migrator');
      throw err;
    }
  }

  private toError(err: unknown): Error {
    return err instanceof Error ? err : new Error(String(err));
  }

  private validateEmitOptions(options: EmitOptions): Required<EmitOptions> {
    const merged = { ...DEFAULT_EMIT_OPTIONS, ...options };
    if (merged.globalTimeout < 0) {
      throw new Error('globalTimeout must be non-negative');
    }
    if (merged.maxConcurrency && merged.maxConcurrency < 1) {
      throw new Error('maxConcurrency must be ≥ 1');
    }
    return merged;
  }

  private validateEventName<K extends keyof EM>(eventName: K): void {
    if (typeof eventName !== 'string' && typeof eventName !== 'symbol') {
      throw new Error(`Invalid event name: ${String(eventName)}`);
    }
  }

  private withGlobalTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    if (!timeout || timeout <= 0) {
      return promise;
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new EventTimeoutError(`Global emit timeout after ${timeout}ms`));
      }, timeout);

      promise
        .then((v) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timer);
          resolve(v);
        })
        .catch((e) => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timer);
          reject(e);
        });
    });
  }
}
