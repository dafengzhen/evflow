import type {
  CloneStrategy,
  DiagnosticEntry,
  EventEntity,
  EventHandler,
  EventOptions,
  LifecycleHook,
  LifecyclePhase,
  LogLevel,
  Middleware,
  MiddlewareContext,
} from '../types.ts';

import { DependencyGraph } from '../dependency/dependency-graph.ts';
import { Injector } from '../dependency/injector.ts';
import { Lifecycle } from '../lifecycle/lifecycle.ts';
import { PubSub } from '../lifecycle/pubsub.ts';
import { MiddlewarePipeline } from '../middleware/middleware.ts';
import { TagManager } from '../tag/tag-manager.ts';
import { Diagnostics } from './diagnostics.ts';
import { Event } from './event.ts';
import { executeWithStrategy } from './executor.ts';

export class Dispatcher {
  private diagnostics = new Diagnostics();

  private eventIdRegistry = new Set<string>();

  private events = new Map<string, Event>();

  private graph = new DependencyGraph();

  private handlers = new Map<string, EventHandler>();

  private injector;

  private lifecycle = new Lifecycle();

  private middleware = new MiddlewarePipeline();

  private pubSub = new PubSub();

  private runLocks = new Map<string, Promise<void>>();

  private tags = new TagManager();

  constructor(options: { cloneStrategy?: CloneStrategy } = {}) {
    this.injector = new Injector({ cloneStrategy: options?.cloneStrategy });
  }

  add(event: EventEntity | EventOptions | string, deps: string[] = [], tags: string[] = []): void {
    const _event =
      event instanceof Event
        ? event
        : typeof event === 'object'
          ? new Event(event as EventOptions)
          : new Event({ id: event });

    const eventId = _event.context.id;

    if (this.eventIdRegistry.has(eventId)) {
      throw new Error(`Event id '${eventId}' is already in use. Event ids must be unique.`);
    }

    this.events.set(eventId, _event);
    this.graph.addNode(eventId);
    deps.forEach((dep) => this.graph.addDependency(eventId, dep));
    this.tags.addTags(eventId, tags);
    this.eventIdRegistry.add(eventId);
  }

  clear(): void {
    this.diagnostics.clear();
    this.eventIdRegistry.clear();
    this.events.clear();
    this.runLocks.clear();
    this.graph.clear();
    this.handlers.clear();
    this.injector.clear();
    this.lifecycle.clear();
    this.middleware.clear();
    this.pubSub.clear();
    this.tags.clear();
  }

  findByTags(tags: string[], matchAll = false): string[] {
    return this.tags.queryByTags(tags, matchAll);
  }

  handle(eventId: string, handler: EventHandler): void {
    this.handlers.set(eventId, handler);
  }

  logs(level?: LogLevel): DiagnosticEntry[] {
    return this.diagnostics.getLogs(level);
  }

  onEvent(eventId: string, phase: LifecyclePhase, hook: LifecycleHook): void {
    const event = this.getEvent(eventId);
    this.lifecycle.registerForEvent(event.context.id, phase, hook);
  }

  onLifecycle(phase: LifecyclePhase, hook: LifecycleHook): void {
    this.lifecycle.registerGlobal(phase, hook);
  }

  async run(eventId: string, options: { reset?: boolean } = { reset: true }): Promise<void> {
    return this.runWithOptions(eventId, options.reset ?? true);
  }

  async runAll(
    eventIds?: string[],
    mode: 'downstream' | 'upstream' = 'upstream',
    options: { ignoreCache?: boolean; reset?: boolean } = { ignoreCache: false, reset: false },
  ): Promise<void> {
    let layers: string[][];

    if (eventIds?.length) {
      eventIds.forEach((id) => {
        if (!this.events.has(id)) {
          throw new Error(`Event ${id} not registered.`);
        }
      });

      layers = this.graph.layeredSubgraphSort(eventIds, mode);
    } else {
      layers = this.graph.layeredTopologicalSort();
    }

    if (options.ignoreCache) {
      const allEventIds = layers.flat();
      allEventIds.forEach((eventId) => {
        const event = this.events.get(eventId);
        if (event && event.state.isTerminal) {
          event.reset();
          this.injector.remove(eventId);
        }
      });
    }

    for (const layer of layers) {
      this.logInfo(`Dispatching event layer: [${layer.join(', ')}].`);
      await Promise.all(
        layer.map((eventId) =>
          this.run(eventId, {
            reset: options.reset || options.ignoreCache,
          }),
        ),
      );
    }
  }

  subscribe(eventId: string, callback: (data: any) => void): void {
    const event = this.getEvent(eventId);
    this.pubSub.subscribe(event.context.id, callback);
  }

  unsubscribe(eventId: string, callback: (data: any) => void): void {
    const event = this.getEvent(eventId);
    this.pubSub.unsubscribe(event.context.id, callback);
  }

  use(middleware: Middleware): void {
    this.middleware.use(middleware);
  }

  private async _runInternal(eventId: string, reset: boolean): Promise<void> {
    const event = this.getEvent(eventId);
    const handler = this.getHandler(eventId);

    if (reset && event.state.isTerminal) {
      event.reset();
      this.injector.remove(eventId);
      this.logInfo(`Resetting event '${eventId}' for re-run.`);
    } else if (!reset && event.state.isTerminal) {
      return;
    }

    const start = performance.now();
    this.logInfo(`Dispatching event '${event.context.id}'.`, {
      phase: 'start',
    });

    try {
      await this.processEventLifecycle(event, handler);
    } catch (err) {
      this.logError(`Event dispatch failed: ${event.context.id}.`, err);
      throw err;
    } finally {
      const duration = performance.now() - start;
      this.logInfo(`Finished event '${event.context.id}'.`, {
        duration: `${duration.toFixed(2)}ms`,
        phase: event.state.current,
      });
    }
  }

  private buildContextPayload(ctx: MiddlewareContext, extra?: Record<string, unknown>): MiddlewareContext {
    return {
      ...ctx,
      ...(ctx.result !== undefined ? { result: ctx.result } : {}),
      ...(extra || {}),
    };
  }

  private getEnvMode() {
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      return import.meta.env.MODE;
    }

    if (typeof process !== 'undefined' && process.env) {
      return process.env.MODE;
    }

    return 'production';
  }

  private getEvent(eventId: string): Event {
    const event = this.events.get(eventId);
    if (!event) {
      throw new Error(`Event not found: ${eventId}.`);
    }
    return event;
  }

  private getHandler(eventId: string): EventHandler {
    const handler = this.handlers.get(eventId);
    if (!handler) {
      throw new Error(`Event handler not found: ${eventId}.`);
    }
    return handler;
  }

  private logError(message: string, error?: any): void {
    this.diagnostics.error(message, error ? { error } : undefined);
  }

  private logInfo(message: string, context?: Record<string, any>): void {
    this.diagnostics.info(message, context);
  }

  private async processEventLifecycle(event: Event, handler: EventHandler): Promise<void> {
    const deps = this.graph.getDependencies(event.context.id);
    this.logInfo(`Processing '${event.context.id}' with dependencies: [${deps.join(', ')}].`);

    if (deps.length) {
      await Promise.all(deps.map((depId) => this.runCached(depId)));
    }

    const depValues = deps.map((depId) => {
      if (!this.injector.has(depId)) {
        throw new Error(`Dependency not resolved: ${depId}.`);
      }

      return this.injector.resolve(depId, { throwIfNotRegistered: false });
    });

    const ctx: MiddlewareContext = { deps: depValues, event };
    const disableRetry = this.getEnvMode() === 'test';

    try {
      event.transition('scheduled');
      await this.lifecycle.trigger(event, 'scheduled', this.buildContextPayload(ctx));
      await this.pubSub.publish(event.context.id, this.buildContextPayload(ctx, { status: 'scheduled' }));

      event.transition('running');
      await this.lifecycle.trigger(event, 'running', this.buildContextPayload(ctx));
      await this.pubSub.publish(event.context.id, this.buildContextPayload(ctx, { status: 'running' }));

      await this.middleware.execute(ctx, async () => {
        ctx.result = await executeWithStrategy(() => handler(event, ...depValues), {
          backoffFn: disableRetry ? () => 0 : (n) => 100 * Math.pow(2, n),
          maxRetries: disableRetry ? 0 : 3,
          onRetry: async (attempt, error) => {
            await this.lifecycle.trigger(
              event,
              'retry',
              this.buildContextPayload(ctx, {
                attempt,
                error,
              }),
            );
            await this.pubSub.publish(
              event.context.id,
              this.buildContextPayload(ctx, {
                attempt,
                error,
                status: 'retrying',
              }),
            );
          },
          onTimeout: async () => {
            await this.lifecycle.trigger(event, 'timeout', ctx);
            await this.pubSub.publish(event.context.id, {
              ...ctx,
              status: 'timeout',
            });
          },
          timeoutMs: 5000,
        });
      });

      this.injector.register(event.context.id, ctx.result);
      event.transition('completed');
      await this.lifecycle.trigger(event, 'completed', this.buildContextPayload(ctx));
      await this.pubSub.publish(event.context.id, this.buildContextPayload(ctx, { status: 'completed' }));
    } catch (error) {
      event.transition('failed');
      await this.lifecycle.trigger(event, 'failed', this.buildContextPayload(ctx, { error }));
      await this.pubSub.publish(event.context.id, this.buildContextPayload(ctx, { error, status: 'failed' }));
      this.logError(`Event failed: ${event.context.id}.`, error);
      throw error;
    }
  }

  private async runCached(eventId: string): Promise<void> {
    return this.runWithOptions(eventId, false);
  }

  private async runWithOptions(eventId: string, reset: boolean): Promise<void> {
    const inflight = this.runLocks.get(eventId);
    if (inflight) {
      return inflight;
    }

    const exec = this._runInternal(eventId, reset);
    this.runLocks.set(eventId, exec);

    try {
      await exec;
    } finally {
      this.runLocks.delete(eventId);
    }
  }
}
