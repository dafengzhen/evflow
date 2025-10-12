import type {
  EventBusOptions,
  EventBusPlugin,
  EventContext,
  EventEmitOptions,
  EventEmitResult,
  EventExecutionInfo,
  EventHandler,
  EventMap,
  EventMiddleware,
  EventTaskOptions,
  HandlerWrapper,
  IEventBus,
  InstalledPlugin,
  MiddlewareOptions,
  MiddlewareWrapper,
  PatternMatchingOptions,
  PlainObject,
  StringKeyOf,
} from '../types/types.ts';

import {
  COMMON_WILDCARD_CHARS,
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_PARALLEL,
  DEFAULT_PATTERN_OPTIONS,
  DEFAULT_PRIORITY,
  DEFAULT_STOP_ON_ERROR,
  DEFAULT_THROW_ON_EVENT_ERROR,
} from '../constants.ts';
import { sortByPriorityAsc, sortByPriorityDesc } from '../utils.ts';
import { EventTask } from './event-task.ts';

/**
 * EventBus.
 *
 * @author dafengzhen
 */
export class EventBus<EM extends EventMap = Record<string, never>, GC extends PlainObject = Record<string, never>>
  implements IEventBus<EM, GC>
{
  private readonly globalMiddlewares: Array<MiddlewareWrapper<EM, StringKeyOf<EM>, any, GC>> = [];

  private readonly handlers = new Map<keyof EM, Array<HandlerWrapper<EM, keyof EM, any, GC>>>();

  private readonly installedPlugins: Array<InstalledPlugin<EM, GC>> = [];

  private readonly middlewares = new Map<keyof EM, Array<MiddlewareWrapper<EM, any, any, GC>>>();

  private readonly patternHandlers = new Map<string, Array<HandlerWrapper<EM, keyof EM, any, GC>>>();

  private readonly patternMiddlewares = new Map<string, Array<MiddlewareWrapper<EM, any, any, GC>>>();

  private readonly patternOptions: Required<PatternMatchingOptions>;

  constructor(options?: EventBusOptions<EM, GC> & { patternMatching?: PatternMatchingOptions }) {
    this.patternOptions = { ...DEFAULT_PATTERN_OPTIONS, ...options?.patternMatching };
    this.initialize(options);
  }

  destroy(): void {
    this.uninstallAllPlugins();
    this.handlers.clear();
    this.middlewares.clear();
    this.patternHandlers.clear();
    this.patternMiddlewares.clear();
    this.globalMiddlewares.length = 0;
  }

  async emit<K extends StringKeyOf<EM>, R = unknown>(
    event: K,
    context?: EventContext<EM[K], GC>,
    taskOptions?: EventTaskOptions,
    emitOptions?: EventEmitOptions,
  ): Promise<Array<EventEmitResult<R>>> {
    try {
      const enhancedContext = this.enhanceContext(event, context);
      const allHandlers = this.getAllHandlersForEvent(event);

      if (allHandlers.length === 0) {
        this.handleNoHandlersWarning(event, enhancedContext, emitOptions);
        return [];
      }

      const {
        globalTimeout,
        maxConcurrency = DEFAULT_MAX_CONCURRENCY,
        parallel = DEFAULT_PARALLEL,
        stopOnError = DEFAULT_STOP_ON_ERROR,
        traceId,
      } = emitOptions ?? {};

      const effectiveParallel = stopOnError ? false : parallel;
      const eventMiddlewares = this.getFilteredMiddlewares(event, enhancedContext);

      return await this.processEvent(
        enhancedContext,
        allHandlers,
        eventMiddlewares,
        { effectiveParallel, globalTimeout, maxConcurrency, stopOnError, traceId },
        taskOptions,
        event,
      );
    } catch (error) {
      return [this.createFailedResult<R>(error, emitOptions?.traceId)];
    }
  }

  match<K extends StringKeyOf<EM>, R = unknown>(
    pattern: string,
    handler: EventHandler<EM, K, R, GC>,
    options?: { once?: boolean; priority?: number },
  ): () => void {
    return this.registerHandler(this.patternHandlers, pattern, handler as EventHandler<EM, keyof EM, R, GC>, options);
  }

  off<K extends StringKeyOf<EM>, R = unknown>(event: K, handler?: EventHandler<EM, K, R, GC>): void {
    this.unregisterHandler(this.handlers, event, handler as EventHandler<EM, keyof EM, R, GC> | undefined);
  }

  on<K extends StringKeyOf<EM>, R = unknown>(
    event: K,
    handler: EventHandler<EM, K, R, GC>,
    options?: { once?: boolean; priority?: number },
  ): () => void {
    return this.registerHandler(this.handlers, event, handler as EventHandler<EM, keyof EM, R, GC>, options);
  }

  unmatch<K extends StringKeyOf<EM>, R = unknown>(pattern: string, handler?: EventHandler<EM, K, R, GC>): void {
    this.unregisterHandler(this.patternHandlers, pattern, handler as EventHandler<EM, keyof EM, R, GC>);
  }

  use<K extends StringKeyOf<EM>, R = unknown>(
    event: K,
    middleware: EventMiddleware<EM, K, R, GC>,
    options?: MiddlewareOptions,
  ): () => void {
    const wrapper: MiddlewareWrapper<EM, K, R, GC> = {
      filter: options?.filter,
      middleware,
      priority: options?.priority ?? DEFAULT_PRIORITY,
      throwOnEventError: options?.throwOnEventError ?? DEFAULT_THROW_ON_EVENT_ERROR,
    };

    const eventStr = String(event);
    const targetMap =
      this.patternOptions.wildcard && eventStr.includes(this.patternOptions.wildcard)
        ? this.patternMiddlewares
        : this.middlewares;

    this.addToMapSorted(targetMap, eventStr as any, wrapper as any, sortByPriorityDesc);

    return this.createMiddlewareRemover(event, eventStr, middleware);
  }

  useGlobalMiddleware<R = unknown>(
    middleware: EventMiddleware<EM, StringKeyOf<EM>, R, GC>,
    options?: MiddlewareOptions,
  ): () => void {
    const wrapper: MiddlewareWrapper<EM, StringKeyOf<EM>, R, GC> = {
      filter: options?.filter,
      middleware,
      priority: options?.priority ?? DEFAULT_PRIORITY,
      throwOnEventError: options?.throwOnEventError ?? DEFAULT_THROW_ON_EVENT_ERROR,
    };

    this.globalMiddlewares.push(wrapper);
    this.globalMiddlewares.sort(sortByPriorityDesc);

    return () => {
      const idx = this.globalMiddlewares.findIndex((w) => w.middleware === middleware);
      if (idx !== -1) {
        this.globalMiddlewares.splice(idx, 1);
      }
    };
  }

  usePlugin(plugin: EventBusPlugin<EM, GC>): () => void {
    plugin.install?.(this);
    this.installedPlugins.push({ plugin });
    return () => {
      const idx = this.installedPlugins.findIndex((p) => p.plugin === plugin);
      if (idx !== -1) {
        const [installedPlugin] = this.installedPlugins.splice(idx, 1);
        void this.safeUninstall(installedPlugin.plugin);
      }
    };
  }

  private addToMapSorted<T>(
    map: Map<any, T[]>,
    key: any,
    wrapper: T,
    comparator: (a: T, b: T) => number,
    identity?: (w: T) => unknown,
  ): void {
    let arr = map.get(key);
    if (!arr) {
      arr = [];
      map.set(key, arr);
    }

    if (identity) {
      const id = identity(wrapper);
      if (arr.some((w) => identity(w) === id)) {
        return;
      }
    }

    arr.push(wrapper);
    arr.sort(comparator);
  }

  private cleanupOnceHandlers<K extends StringKeyOf<EM>>(
    event: K,
    handlers: Array<HandlerWrapper<EM, K, any, GC>>,
  ): void {
    const onceHandlers = handlers.filter((h) => h.once);
    if (onceHandlers.length === 0) {
      return;
    }

    for (const handlerWrapper of onceHandlers) {
      this.off(event, handlerWrapper.handler);
      this.unmatchAllHandlers(handlerWrapper.handler);
    }
  }

  private createFailedResult<R>(error: unknown, traceId?: string): EventEmitResult<R> {
    const err = error instanceof Error ? error : new Error(String(error));
    return {
      error: { error: err, message: err.message, stack: err.stack },
      state: 'failed',
      traceId,
    };
  }

  private createHandlerExecutor<R>(
    context: EventContext<any, GC>,
    eventMiddlewares: Array<MiddlewareWrapper<EM, any, any, GC>>,
    options: { globalTimeout?: number; stopOnError: boolean; traceId?: string },
    taskOptions?: EventTaskOptions,
    results?: Array<EventEmitResult<R>>,
    stopFlag?: { value: boolean },
  ) {
    return async (handlerWrapper: HandlerWrapper<EM, any, R, GC>): Promise<void> => {
      if (stopFlag?.value) {
        return;
      }

      try {
        const wrappedHandler = this.createWrappedHandler(handlerWrapper.handler, eventMiddlewares, context);
        const task = new EventTask<R>(context, wrappedHandler, taskOptions);
        const result = await this.executeWithTimeout(task.execute(), options.globalTimeout);

        if (options.traceId) {
          result.traceId = options.traceId;
        }

        results?.push(result);

        if (options.stopOnError && result.error) {
          stopFlag!.value = true;
        }

        if (result.error) {
          await this.handleEventResultError(result, eventMiddlewares, context);
        }
      } catch (err) {
        const failed = this.createFailedResult<R>(err, options.traceId);
        results?.push(failed);

        if (options.stopOnError) {
          stopFlag!.value = true;
        }

        await this.handleEventResultError(failed, eventMiddlewares, context);
      }
    };
  }

  private createMiddlewareRemover<K extends keyof EM>(
    event: K,
    eventStr: string,
    middleware: EventMiddleware<EM, K, any, GC>,
  ): () => void {
    return () => {
      for (const map of [this.middlewares, this.patternMiddlewares]) {
        this.removeFromMapByIdentity(
          map as Map<any, Array<MiddlewareWrapper<EM, any, any, GC>>>,
          eventStr,
          (w) => w.middleware === middleware,
        );
        this.removeFromMapByIdentity(
          map as Map<any, Array<MiddlewareWrapper<EM, any, any, GC>>>,
          event,
          (w) => w.middleware === middleware,
        );
      }
    };
  }

  private createWrappedHandler<K extends keyof EM, R>(
    handler: EventHandler<EM, K, R, GC>,
    middlewares: Array<MiddlewareWrapper<EM, K, R, GC>>,
    context: EventContext<EM[K], GC>,
  ): () => Promise<R> {
    return async (): Promise<R> => {
      let idx = -1;

      const info: EventExecutionInfo<R> = {
        eventName: context.meta?.eventName ?? '<unknown>',
        handlerCount: 1,
        get hasError(): boolean {
          return this.results.some((r) => r.state === 'failed');
        },
        inProgress: true,
        middlewareCount: middlewares.length,
        results: [],
        traceId: context.meta?.traceId as string | undefined,
      };

      const next = async (): Promise<R> => {
        idx++;
        if (idx < middlewares.length) {
          return middlewares[idx].middleware(context, next, info);
        }
        return handler(context) as Promise<R>;
      };

      return next();
    };
  }

  private deduplicateHandlers<K extends keyof EM, R>(
    handlers: Array<HandlerWrapper<EM, K, R, GC>>,
  ): Array<HandlerWrapper<EM, K, R, GC>> {
    const seen = new Set<EventHandler<EM, K, R, GC>>();
    const result: Array<HandlerWrapper<EM, K, R, GC>> = [];

    for (const handler of handlers) {
      if (!seen.has(handler.handler)) {
        seen.add(handler.handler);
        result.push(handler);
      }
    }
    return result;
  }

  private deduplicateMiddlewares<K extends keyof EM, R>(
    middlewares: Array<MiddlewareWrapper<EM, K, R, GC>>,
  ): Array<MiddlewareWrapper<EM, K, R, GC>> {
    const seen = new Set<EventMiddleware<EM, K, R, GC>>();
    const result: Array<MiddlewareWrapper<EM, K, R, GC>> = [];

    for (const middleware of middlewares) {
      if (!seen.has(middleware.middleware)) {
        seen.add(middleware.middleware);
        result.push(middleware);
      }
    }
    return result;
  }

  private enhanceContext<K extends keyof EM>(event: K, context?: EventContext<EM[K], GC>): EventContext<EM[K], GC> {
    return {
      ...context,
      meta: {
        eventName: this.normalizeEventName(event),
        ...context?.meta,
      },
    } as EventContext<EM[K], GC>;
  }

  private async executeHandlers<K extends keyof EM, R>(
    handlers: Array<HandlerWrapper<EM, K, R, GC>>,
    executeHandler: (h: HandlerWrapper<EM, K, R, GC>) => Promise<void>,
    parallel: boolean,
    maxConcurrency: number,
    stopFlag: { value: boolean },
  ): Promise<void> {
    return parallel
      ? this.executeParallel(handlers, executeHandler, maxConcurrency, stopFlag)
      : this.executeSequential(handlers, executeHandler, stopFlag);
  }

  private async executeParallel<K extends keyof EM, R>(
    handlers: Array<HandlerWrapper<EM, K, R, GC>>,
    executeHandler: (h: HandlerWrapper<EM, K, R, GC>) => Promise<void>,
    maxConcurrency: number,
    stopFlag: { value: boolean },
  ): Promise<void> {
    const executing = new Set<Promise<void>>();

    for (const handler of handlers) {
      if (stopFlag.value) {
        break;
      }

      while (executing.size >= maxConcurrency) {
        if (stopFlag.value) {
          break;
        }
        await Promise.race(executing);
      }

      if (stopFlag.value) {
        break;
      }

      const promise = executeHandler(handler);
      const cleanup = () => executing.delete(promise);
      promise.then(cleanup, cleanup);
      executing.add(promise);
    }

    await Promise.all(executing);
  }

  private async executeSequential<K extends keyof EM, R>(
    handlers: Array<HandlerWrapper<EM, K, R, GC>>,
    executeHandler: (h: HandlerWrapper<EM, K, R, GC>) => Promise<void>,
    stopFlag: { value: boolean },
  ): Promise<void> {
    for (const handler of handlers) {
      if (stopFlag.value) {
        break;
      }
      await executeHandler(handler);
    }
  }

  private async executeWithGlobalMiddlewares<R = unknown>(
    context: EventContext<any, GC>,
    finalExecutor: () => Promise<void>,
    info: EventExecutionInfo<R>,
  ): Promise<void> {
    const applicable = this.globalMiddlewares.filter((mw) => !mw.filter || mw.filter(context)).sort(sortByPriorityAsc);

    let idx = -1;
    const next = async (): Promise<void> => {
      idx++;
      if (idx < applicable.length) {
        return applicable[idx].middleware(context, next, info);
      }
      return finalExecutor();
    };

    await next();
  }

  private executeWithTimeout<T>(promise: Promise<T>, timeout?: number): Promise<T> {
    if (!timeout) {
      return promise;
    }

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Operation timed out after ${timeout}ms`)), timeout);
      promise.finally(() => clearTimeout(timer)).then(resolve, reject);
    });
  }

  private getAllHandlersForEvent<K extends keyof EM>(event: K): Array<HandlerWrapper<EM, K, any, GC>> {
    const exactHandlers = (this.handlers.get(event) ?? []) as Array<HandlerWrapper<EM, K, any, GC>>;
    const pattern = this.getMatchingFromMap(this.patternHandlers, String(event));
    return this.deduplicateHandlers([...exactHandlers, ...pattern]);
  }

  private getFilteredMiddlewares<K extends keyof EM>(
    event: K,
    context: EventContext<EM[K], GC>,
  ): Array<MiddlewareWrapper<EM, K, any, GC>> {
    const exact = (this.middlewares.get(event) ?? []) as Array<MiddlewareWrapper<EM, K, any, GC>>;
    const patterns = this.getMatchingFromMap(this.patternMiddlewares, String(event));
    const combined = [...exact, ...patterns];
    return this.deduplicateMiddlewares(combined).filter((mw) => !mw.filter || mw.filter(context));
  }

  private getMatchingFromMap<T>(map: Map<string, T[]>, eventName: string): T[] {
    const out: T[] = [];

    for (const [pattern, list] of map.entries()) {
      if (this.isPatternMatch(eventName, pattern)) {
        out.push(...list);
      }
    }

    out.sort((a: any, b: any) => (b.priority ?? 0) - (a.priority ?? 0));
    return out;
  }

  private async handleEventResultError<R>(
    result: EventEmitResult<R>,
    eventMiddlewares: Array<MiddlewareWrapper<EM, any, any, GC>>,
    context: EventContext<any, GC>,
  ): Promise<void> {
    const error = result.error?.error instanceof Error ? result.error.error : new Error(result.error?.message);
    const applicable = this.globalMiddlewares.filter((mw) => !mw.filter || mw.filter(context)).sort(sortByPriorityAsc);

    const allMiddlewares = [...eventMiddlewares, ...applicable];
    for (const middleware of allMiddlewares) {
      if (middleware.throwOnEventError) {
        throw error;
      }
    }
  }

  private handleNoHandlersWarning<K extends keyof EM>(
    event: K,
    context: EventContext<EM[K], GC>,
    emitOptions?: EventEmitOptions,
  ): void {
    if (!emitOptions?.ignoreNoHandlersWarning) {
      console.trace(`[EventBus] No handlers found for event "${String(event)}".`, 'Context:', context);
    }
  }

  private initialize(options?: EventBusOptions<EM, GC>): void {
    if (options?.globalMiddlewares) {
      this.globalMiddlewares.push(
        ...options.globalMiddlewares.map((mw) => ({
          middleware: mw,
          priority: DEFAULT_PRIORITY,
          throwOnEventError: DEFAULT_THROW_ON_EVENT_ERROR,
        })),
      );
      this.globalMiddlewares.sort(sortByPriorityDesc);
    }

    options?.plugins?.forEach((p) => this.usePlugin(p));
  }

  private isPatternMatch(eventName: string, pattern: string): boolean {
    const { matchMultiple, separator, wildcard } = this.patternOptions;

    if (pattern === wildcard) {
      return true;
    }
    if (matchMultiple && wildcard && pattern === wildcard + wildcard) {
      return true;
    }

    const eventParts = eventName.split(separator);
    const patternParts = pattern.split(separator);

    if (matchMultiple && patternParts.some((p) => wildcard && p === wildcard + wildcard)) {
      return this.matchWithDoubleWildcard(eventParts, patternParts);
    }

    return this.matchSimpleSegments(eventParts, patternParts);
  }

  private matchSimpleSegments(eventParts: string[], patternParts: string[]): boolean {
    const { wildcard } = this.patternOptions;

    if (eventParts.length !== patternParts.length) {
      return false;
    }

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      const eventPart = eventParts[i];

      if (patternPart === wildcard) {
        if (COMMON_WILDCARD_CHARS.has(eventPart)) {
          return false;
        }
        continue;
      }
      if (patternPart !== eventPart) {
        return false;
      }
    }
    return true;
  }

  private matchWithDoubleWildcard(
    eventParts: string[],
    patternParts: string[],
    eventIndex = 0,
    patternIndex = 0,
  ): boolean {
    const { allowZeroLengthDoubleWildcard = false, wildcard } = this.patternOptions;
    const doubleWildcard = wildcard + wildcard;

    if (eventIndex === eventParts.length && patternIndex === patternParts.length) {
      return true;
    }

    if (patternIndex === patternParts.length) {
      return false;
    }

    const currentPattern = patternParts[patternIndex];

    if (currentPattern === doubleWildcard) {
      const hasMorePatterns = patternIndex < patternParts.length - 1;

      if (!hasMorePatterns) {
        return true;
      }

      const startIndex = allowZeroLengthDoubleWildcard ? eventIndex : eventIndex + 1;

      for (let i = startIndex; i <= eventParts.length; i++) {
        if (this.matchWithDoubleWildcard(eventParts, patternParts, i, patternIndex + 1)) {
          return true;
        }
      }
      return false;
    }

    if (eventIndex >= eventParts.length) {
      return false;
    }

    const currentEvent = eventParts[eventIndex];

    if (currentPattern === wildcard) {
      if (COMMON_WILDCARD_CHARS.has(currentEvent)) {
        return false;
      }
    } else if (currentPattern !== currentEvent) {
      return false;
    }

    return this.matchWithDoubleWildcard(eventParts, patternParts, eventIndex + 1, patternIndex + 1);
  }

  private normalizeEventName(event: number | string | symbol): string {
    return String(event);
  }

  private async processEvent<K extends StringKeyOf<EM>, R = unknown>(
    context: EventContext<EM[K], GC>,
    allHandlers: Array<HandlerWrapper<EM, K, any, GC>>,
    eventMiddlewares: Array<MiddlewareWrapper<EM, K, any, GC>>,
    options: {
      effectiveParallel: boolean;
      globalTimeout?: number;
      maxConcurrency: number;
      stopOnError: boolean;
      traceId?: string;
    },
    taskOptions?: EventTaskOptions,
    event?: K,
  ): Promise<Array<EventEmitResult<R>>> {
    const results: Array<EventEmitResult<R>> = [];
    const stopFlag = { value: false };

    const executeHandler = this.createHandlerExecutor<R>(
      context,
      eventMiddlewares,
      options,
      taskOptions,
      results,
      stopFlag,
    );

    try {
      const info: EventExecutionInfo<R> = {
        eventName: context.meta?.eventName ?? '<unknown>',
        handlerCount: allHandlers.length,
        get hasError(): boolean {
          return this.results.some((r) => r.state === 'failed');
        },
        inProgress: true,
        middlewareCount: eventMiddlewares.length,
        results,
        traceId: options.traceId,
      };

      await this.executeWithGlobalMiddlewares(
        context,
        async () => {
          try {
            await this.executeHandlers(
              allHandlers,
              async (handler) => {
                await executeHandler(handler);
                info.inProgress = results.length < info.handlerCount;
              },
              options.effectiveParallel,
              options.maxConcurrency,
              stopFlag,
            );
          } finally {
            info.inProgress = false;
          }
        },
        info,
      );
    } catch (err) {
      results.push(this.createFailedResult<R>(err, options.traceId));
    }

    if (event) {
      this.cleanupOnceHandlers(event, allHandlers);
    }

    return results;
  }

  private registerHandler<R>(
    targetMap: Map<keyof EM | string, Array<HandlerWrapper<EM, keyof EM, R, GC>>>,
    key: keyof EM | string,
    handler: EventHandler<EM, keyof EM, R, GC>,
    options?: { once?: boolean; priority?: number },
  ): () => void {
    const wrapper: HandlerWrapper<EM, keyof EM, R, GC> = {
      handler,
      once: options?.once ?? false,
      priority: options?.priority ?? DEFAULT_PRIORITY,
    };

    this.addToMapSorted(
      targetMap as Map<any, HandlerWrapper<EM, keyof EM, R, GC>[]>,
      key,
      wrapper,
      sortByPriorityDesc,
      (w) => w.handler,
    );

    return () => this.unregisterHandler(targetMap, key, handler);
  }

  private removeFromMapByIdentity<T>(map: Map<any, T[]>, key: any, identity?: (w: T) => boolean): void {
    if (!identity) {
      map.delete(key);
      return;
    }

    const arr = map.get(key);
    if (!arr) {
      return;
    }

    const filtered = arr.filter((w) => !identity(w));
    if (filtered.length === 0) {
      map.delete(key);
    } else {
      map.set(key, filtered);
    }
  }

  private async safeUninstall(plugin: EventBusPlugin<EM, GC>): Promise<void> {
    try {
      const result = plugin.uninstall?.(this);
      if (result instanceof Promise) {
        await result;
      }
    } catch (err) {
      console.error('Error uninstalling plugin:', err);
    }
  }

  private uninstallAllPlugins(): void {
    for (let i = this.installedPlugins.length - 1; i >= 0; i--) {
      void this.safeUninstall(this.installedPlugins[i].plugin);
    }
    this.installedPlugins.length = 0;
  }

  private unmatchAllHandlers(handler: EventHandler<EM, any, any, GC>): void {
    for (const [pattern, list] of Array.from(this.patternHandlers.entries())) {
      const filtered = list.filter((w) => w.handler !== handler);
      if (filtered.length === 0) {
        this.patternHandlers.delete(pattern);
      } else {
        this.patternHandlers.set(pattern, filtered);
      }
    }
  }

  private unregisterHandler<R>(
    targetMap: Map<keyof EM | string, Array<HandlerWrapper<EM, keyof EM, R, GC>>>,
    key: keyof EM | string,
    handler?: EventHandler<EM, keyof EM, R, GC>,
  ): void {
    if (!handler) {
      targetMap.delete(key);
      return;
    }

    this.removeFromMapByIdentity(
      targetMap as Map<any, Array<HandlerWrapper<EM, keyof EM, R, GC>>>,
      key,
      (w) => w.handler === handler,
    );
  }
}
