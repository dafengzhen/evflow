import type {
  EventBusOptions,
  EventBusPlugin,
  EventContext,
  EventEmitOptions,
  EventEmitResult,
  EventError,
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
  DEFAULT_ONCE,
  DEFAULT_PARALLEL,
  DEFAULT_PATTERN_OPTIONS,
  DEFAULT_PRIORITY,
  DEFAULT_STOP_ON_ERROR,
  DEFAULT_THROW_ON_EVENT_ERROR,
} from '../constants.ts';
import { sortByPriorityAsc, sortByPriorityDesc } from '../utils.ts';
import { EventTask } from './event-task.ts';
import { LifecycleManager } from './lifecycle-manager.ts';
import { LifecyclePhase } from '../enums.ts';

/**
 * EventBus.
 *
 * @author dafengzhen
 */
export class EventBus<EM extends EventMap = EventMap, GC extends PlainObject = PlainObject>
  implements IEventBus<EM, GC>
{
  private readonly globalMiddlewares: Array<MiddlewareWrapper<EM, StringKeyOf<EM>, any, GC>> = [];

  private readonly handlers = new Map<string, Array<HandlerWrapper<EM, any, any, GC>>>();

  private readonly middlewares = new Map<string, Array<MiddlewareWrapper<EM, any, any, GC>>>();

  private readonly patternHandlers = new Map<string, Array<HandlerWrapper<EM, any, any, GC>>>();

  private readonly patternMiddlewares = new Map<string, Array<MiddlewareWrapper<EM, any, any, GC>>>();

  private readonly installedPlugins: Array<InstalledPlugin<EM, GC>> = [];

  private readonly patternOptions: Required<PatternMatchingOptions>;

  private readonly lifecycleManager: LifecycleManager<EM, GC>;

  constructor(options?: EventBusOptions<EM, GC>) {
    this.patternOptions = {
      ...DEFAULT_PATTERN_OPTIONS,
      ...options?.patternMatching,
    };
    this.lifecycleManager = new LifecycleManager(options?.lifecycle);
    this.initialize(options);
  }

  destroy(): void {
    void this.lifecycleManager
      .destroy()
      .catch((error) => console.error('Error during lifecycle manager destruction:', error));

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
    const eventName = this.normalizeEventName(event);

    try {
      const enhancedContext = this.enhanceContext(eventName, context);
      enhancedContext.meta = {
        ...enhancedContext.meta,
        startTime: Date.now(),
        lifecyclePhase: LifecyclePhase.BEFORE_EMIT,
      };

      await this.lifecycleManager.beforeEmit(eventName as K, enhancedContext, emitOptions);

      const allHandlers = this.getAllHandlersForEvent(eventName);
      if (allHandlers.length === 0) {
        return await this.handleNoHandlers(eventName as K, enhancedContext, emitOptions);
      }

      const results = await this.processEvent<K, R>(
        eventName as K,
        enhancedContext,
        allHandlers,
        emitOptions,
        taskOptions,
      );

      enhancedContext.meta.lifecyclePhase = LifecyclePhase.AFTER_EMIT;
      enhancedContext.meta.endTime = Date.now();
      await this.lifecycleManager.afterEmit(eventName as K, enhancedContext, results, emitOptions);

      return results;
    } catch (error) {
      return await this.handleEmitError(eventName as K, context, error, emitOptions);
    }
  }

  match<K extends StringKeyOf<EM>, R = unknown>(
    pattern: K,
    handler: EventHandler<EM, K, R, GC>,
    options?: { once?: boolean; priority?: number },
  ): () => void {
    return this.registerHandler(this.patternHandlers, pattern, handler, options);
  }

  off<K extends StringKeyOf<EM>, R = unknown>(event: K, handler?: EventHandler<EM, K, R, GC>): void {
    this.unregisterHandler(this.handlers, event, handler);
  }

  on<K extends StringKeyOf<EM>, R = unknown>(
    event: K,
    handler: EventHandler<EM, K, R, GC>,
    options?: { once?: boolean; priority?: number },
  ): () => void {
    return this.registerHandler(this.handlers, event, handler, options);
  }

  unmatch<K extends StringKeyOf<EM>, R = unknown>(pattern: K, handler?: EventHandler<EM, K, R, GC>): void {
    this.unregisterHandler(this.patternHandlers, pattern, handler);
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
    const targetMap = this.isPatternKey(eventStr) ? this.patternMiddlewares : this.middlewares;

    this.addToMapSorted(targetMap, eventStr, wrapper, sortByPriorityDesc, (w) => w.middleware);

    return () => this.removeFromMapByIdentity(targetMap, eventStr, (w) => w.middleware === middleware);
  }

  useGlobalMiddleware<R = unknown>(
    middleware: EventMiddleware<EM, any, R, GC>,
    options?: MiddlewareOptions,
  ): () => void {
    const wrapper: MiddlewareWrapper<EM, StringKeyOf<EM>, R, GC> = {
      filter: options?.filter,
      middleware,
      priority: options?.priority ?? DEFAULT_PRIORITY,
      throwOnEventError: options?.throwOnEventError ?? DEFAULT_THROW_ON_EVENT_ERROR,
    };

    const idx = this.globalMiddlewares.findIndex((w) => w.middleware === middleware);
    if (idx === -1) {
      this.globalMiddlewares.push(wrapper);
      this.globalMiddlewares.sort(sortByPriorityDesc);
    }

    return () => {
      const i = this.globalMiddlewares.findIndex((w) => w.middleware === middleware);
      if (i !== -1) {
        this.globalMiddlewares.splice(i, 1);
      }
    };
  }

  usePlugin(plugin: EventBusPlugin<EM, GC>): () => void {
    try {
      plugin.install?.(this);
      this.installedPlugins.push({ plugin });
    } catch (error) {
      console.error('Error installing plugin:', error);
    }

    return () => {
      const idx = this.installedPlugins.findIndex((p) => p.plugin === plugin);
      if (idx !== -1) {
        const [installed] = this.installedPlugins.splice(idx, 1);
        void this.safeUninstall(installed.plugin);
      }
    };
  }

  private addToMapSorted<T>(
    map: Map<string, T[]>,
    key: string,
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

  private removeFromMapByIdentity<T>(map: Map<string, T[]>, key: string, identity: (w: T) => boolean): void {
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

  private cleanupOnceHandlers<K extends StringKeyOf<EM>>(
    event: K,
    handlers: Array<HandlerWrapper<EM, K, any, GC>>,
  ): void {
    const onceHandlers = handlers.filter((h) => h.once);
    if (onceHandlers.length === 0) {
      return;
    }

    for (const wrapper of onceHandlers) {
      this.off(event, wrapper.handler as EventHandler<EM, K, any, GC>);
      this.unmatchAllHandlers(wrapper.handler);
    }
  }

  private createFailedResult<R>(error: unknown, traceId?: string): EventEmitResult<R> {
    const normalizedError = this.normalizeError(error);
    return {
      error: normalizedError,
      state: 'failed',
      traceId,
    };
  }

  private createHandlerExecutor<R>(
    context: EventContext<any, GC>,
    eventMiddlewares: Array<MiddlewareWrapper<EM, any, any, GC>>,
    options: {
      globalTimeout?: number;
      stopOnError: boolean;
      traceId?: string;
    },
    taskOptions?: EventTaskOptions,
    results?: Array<EventEmitResult<R>>,
    stopFlag?: { value: boolean },
  ) {
    return async (handlerWrapper: HandlerWrapper<EM, any, R, GC>, handlerIndex: number): Promise<void> => {
      if (stopFlag?.value) {
        return;
      }

      try {
        const wrappedHandler = this.createWrappedHandler(handlerWrapper.handler, eventMiddlewares, context);

        const enhancedTaskOptions: EventTaskOptions = {
          ...taskOptions,
          onTimeout: (timeout: number, phase: string) => {
            taskOptions?.onTimeout?.(timeout, phase);
            context.meta = {
              ...context.meta,
              lifecyclePhase: LifecyclePhase.TIMEOUT,
            };
            void this.lifecycleManager.onTimeout(
              context.meta?.eventName as any,
              context,
              timeout,
              LifecyclePhase.BEFORE_HANDLER,
            );
          },
        };

        const task = new EventTask<R>(context, wrappedHandler, enhancedTaskOptions);
        const result = await this.executeWithTimeout(
          task.execute(),
          options.globalTimeout,
          context.meta?.eventName,
          context,
          LifecyclePhase.BEFORE_HANDLER,
        );

        if (options.traceId) {
          result.traceId = options.traceId;
        }
        results?.push(result);

        await this.lifecycleManager.afterHandler(
          context.meta?.eventName as any,
          context,
          handlerWrapper.handler,
          result,
          handlerIndex,
          results?.length ?? 0,
        );

        if (options.stopOnError && result.error) {
          stopFlag!.value = true;
        }

        if (result.error) {
          await this.handleEventResultError(result, eventMiddlewares, context);
        }
      } catch (error) {
        const failedResult = this.createFailedResult<R>(error, options.traceId);
        results?.push(failedResult);

        await this.lifecycleManager.afterHandler(
          context.meta?.eventName as any,
          context,
          handlerWrapper.handler,
          failedResult,
          handlerIndex,
          results?.length ?? 0,
        );

        if (options.stopOnError) {
          stopFlag!.value = true;
        }

        await this.handleEventResultError(failedResult, eventMiddlewares, context);
      }
    };
  }

  private createWrappedHandler<K extends StringKeyOf<EM>, R>(
    handler: EventHandler<EM, K, R, GC>,
    middlewares: Array<MiddlewareWrapper<EM, K, R, GC>>,
    context: EventContext<EM[K], GC>,
  ): () => Promise<R> {
    return async (): Promise<R> => {
      const info: EventExecutionInfo<R> = {
        eventName: context.meta?.eventName ?? '<unknown>',
        handlerCount: 1,
        get hasError() {
          return this.results.some((r) => r.state === 'failed');
        },
        inProgress: true,
        middlewareCount: middlewares.length,
        results: [],
        traceId: context.meta?.traceId as string | undefined,
        lifecycle: {
          startTime: Date.now(),
          phase: LifecyclePhase.BEFORE_MIDDLEWARE,
          endTime: undefined,
        },
      };

      const executeMiddlewareChain = async (index: number): Promise<R> => {
        if (index < middlewares.length) {
          const middleware = middlewares[index];

          try {
            await this.lifecycleManager.beforeMiddleware(
              context.meta?.eventName as any,
              context,
              middleware.middleware,
              index,
              middlewares.length,
            );

            const result = await middleware.middleware(context, () => executeMiddlewareChain(index + 1), info);

            info.lifecycle!.phase = LifecyclePhase.AFTER_MIDDLEWARE;
            info.lifecycle!.endTime = Date.now();

            await this.lifecycleManager.afterMiddleware(
              context.meta?.eventName as any,
              context,
              middleware.middleware,
              result,
              undefined,
              index,
              middlewares.length,
            );

            return result;
          } catch (error) {
            const eventError = this.normalizeError(error);
            info.lifecycle!.phase = LifecyclePhase.AFTER_MIDDLEWARE;
            info.lifecycle!.endTime = Date.now();

            await this.lifecycleManager.afterMiddleware(
              context.meta?.eventName as any,
              context,
              middleware.middleware,
              undefined,
              eventError,
              index,
              middlewares.length,
            );

            throw error;
          }
        }

        const handlerResult = await handler(context);
        info.lifecycle!.endTime = Date.now();
        return handlerResult;
      };

      return executeMiddlewareChain(0);
    };
  }

  private deduplicateByIdentity<T, I>(arr: T[], identity: (t: T) => I): T[] {
    const seen = new Set<I>();
    const result: T[] = [];

    for (const item of arr) {
      const id = identity(item);
      if (!seen.has(id)) {
        seen.add(id);
        result.push(item);
      }
    }

    return result;
  }

  private deduplicateHandlers<K extends StringKeyOf<EM>, R>(
    handlers: Array<HandlerWrapper<EM, K, R, GC>>,
  ): Array<HandlerWrapper<EM, K, R, GC>> {
    return this.deduplicateByIdentity(handlers, (h) => h.handler);
  }

  private deduplicateMiddlewares<K extends StringKeyOf<EM>, R>(
    middlewares: Array<MiddlewareWrapper<EM, K, R, GC>>,
  ): Array<MiddlewareWrapper<EM, K, R, GC>> {
    return this.deduplicateByIdentity(middlewares, (m) => m.middleware);
  }

  private enhanceContext<K extends StringKeyOf<EM>>(
    event: string,
    context?: EventContext<EM[K], GC>,
  ): EventContext<EM[K], GC> {
    return {
      ...context,
      meta: {
        eventName: event,
        ...context?.meta,
      },
    } as EventContext<EM[K], GC>;
  }

  private async executeHandlers<K extends StringKeyOf<EM>, R>(
    handlers: Array<HandlerWrapper<EM, K, R, GC>>,
    executeHandler: (h: HandlerWrapper<EM, K, R, GC>, index: number) => Promise<void>,
    parallel: boolean,
    maxConcurrency: number,
    stopFlag: { value: boolean },
  ): Promise<void> {
    if (parallel) {
      await this.executeParallel(handlers, executeHandler, maxConcurrency, stopFlag);
    } else {
      await this.executeSequential(handlers, executeHandler, stopFlag);
    }
  }

  private async executeParallel<K extends StringKeyOf<EM>, R>(
    handlers: Array<HandlerWrapper<EM, K, R, GC>>,
    executeHandler: (h: HandlerWrapper<EM, K, R, GC>, index: number) => Promise<void>,
    maxConcurrency: number,
    stopFlag: { value: boolean },
  ): Promise<void> {
    const running = new Set<Promise<void>>();

    for (let i = 0; i < handlers.length; i++) {
      if (stopFlag.value) {
        break;
      }

      while (running.size >= maxConcurrency) {
        if (stopFlag.value) {
          break;
        }
        await Promise.race(running);
      }
      if (stopFlag.value) {
        break;
      }

      const promise = executeHandler(handlers[i], i);
      const cleanup = () => running.delete(promise);
      promise.then(cleanup, cleanup);
      running.add(promise);
    }

    await Promise.all(Array.from(running));
  }

  private async executeSequential<K extends StringKeyOf<EM>, R>(
    handlers: Array<HandlerWrapper<EM, K, R, GC>>,
    executeHandler: (h: HandlerWrapper<EM, K, R, GC>, index: number) => Promise<void>,
    stopFlag: { value: boolean },
  ): Promise<void> {
    for (let i = 0; i < handlers.length; i++) {
      if (stopFlag.value) {
        break;
      }
      await executeHandler(handlers[i], i);
    }
  }

  private async executeWithGlobalMiddlewares<R = unknown>(
    context: EventContext<any, GC>,
    finalExecutor: () => Promise<void>,
    info: EventExecutionInfo<R>,
  ): Promise<void> {
    const applicableMiddlewares = this.globalMiddlewares
      .filter((mw) => !mw.filter || mw.filter(context))
      .sort(sortByPriorityAsc);

    let currentIndex = -1;

    const next = async (): Promise<void> => {
      currentIndex++;
      if (currentIndex < applicableMiddlewares.length) {
        return applicableMiddlewares[currentIndex].middleware(context, next, info);
      }
      return finalExecutor();
    };

    await next();
  }

  private executeWithTimeout<T>(
    promise: Promise<T>,
    timeout?: number,
    event?: string,
    context?: EventContext<any, GC>,
    phase?: LifecyclePhase,
  ): Promise<T> {
    if (!timeout) {
      return promise;
    }

    return new Promise<T>((resolve, reject) => {
      let finished = false;

      const timer = setTimeout(async () => {
        if (finished) {
          return;
        }
        finished = true;

        const timeoutError = new Error(`Operation timed out after ${timeout}ms`);

        if (event && context && phase) {
          context.meta = {
            ...context.meta,
            lifecyclePhase: LifecyclePhase.TIMEOUT,
          };
          try {
            await this.lifecycleManager.onTimeout(event as any, context, timeout, phase);
          } catch (e) {
            console.error('Error in lifecycle onTimeout handler:', e);
          }
        }

        reject(timeoutError);
      }, timeout);

      promise
        .then((res) => {
          if (finished) {
            return;
          }
          finished = true;
          clearTimeout(timer);
          resolve(res);
        })
        .catch((err) => {
          if (finished) {
            return;
          }
          finished = true;
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  private getAllHandlersForEvent<K extends StringKeyOf<EM>>(event: string): Array<HandlerWrapper<EM, K, any, GC>> {
    const exactHandlers = (this.handlers.get(event) ?? []) as Array<HandlerWrapper<EM, K, any, GC>>;
    const patternHandlers = this.getMatchingFromMap(this.patternHandlers, event);
    return this.deduplicateHandlers([...exactHandlers, ...patternHandlers]);
  }

  private getFilteredMiddlewares<K extends StringKeyOf<EM>>(
    event: string,
    context: EventContext<EM[K], GC>,
  ): Array<MiddlewareWrapper<EM, K, any, GC>> {
    const exact = (this.middlewares.get(event) ?? []) as Array<MiddlewareWrapper<EM, K, any, GC>>;
    const pattern = this.getMatchingFromMap(this.patternMiddlewares, event);
    const combined = [...exact, ...pattern];
    return this.deduplicateMiddlewares(combined).filter((mw) => !mw.filter || mw.filter(context));
  }

  private getMatchingFromMap<T extends { priority?: number }>(map: Map<string, T[]>, eventName: string): T[] {
    const result: T[] = [];

    for (const [pattern, items] of map.entries()) {
      if (this.isPatternMatch(eventName, pattern)) {
        result.push(...items);
      }
    }

    result.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    return result;
  }

  private async handleEmitError<K extends StringKeyOf<EM>, R = unknown>(
    event: K,
    context: EventContext<EM[K], GC> | undefined,
    error: unknown,
    emitOptions?: EventEmitOptions,
  ): Promise<Array<EventEmitResult<R>>> {
    const eventError = this.normalizeError(error);
    const enhancedContext = this.enhanceContext(String(event), context);

    enhancedContext.meta = {
      ...enhancedContext.meta,
      lifecyclePhase: LifecyclePhase.ERROR_HANDLING,
      endTime: Date.now(),
    };

    await this.lifecycleManager.onError(event, enhancedContext, eventError, LifecyclePhase.ERROR_HANDLING);

    return [this.createFailedResult<R>(error, emitOptions?.traceId)];
  }

  private async handleEventResultError<R>(
    result: EventEmitResult<R>,
    eventMiddlewares: Array<MiddlewareWrapper<EM, any, any, GC>>,
    context: EventContext<any, GC>,
  ): Promise<void> {
    const error = result.error?.error instanceof Error ? result.error.error : new Error(result.error?.message);

    const applicableGlobal = this.globalMiddlewares
      .filter((mw) => !mw.filter || mw.filter(context))
      .sort(sortByPriorityAsc);

    const allMiddlewares = [...eventMiddlewares, ...applicableGlobal];
    for (const middleware of allMiddlewares) {
      if (middleware.throwOnEventError) {
        throw error;
      }
    }
  }

  private async handleNoHandlers<K extends StringKeyOf<EM>, R = unknown>(
    event: K,
    context: EventContext<EM[K], GC>,
    emitOptions?: EventEmitOptions,
  ): Promise<Array<EventEmitResult<R>>> {
    if (!emitOptions?.ignoreNoHandlersWarning) {
      console.trace(`[EventBus] No handlers found for event "${String(event)}".`, 'Context:', context);
    }

    context.meta = {
      ...context.meta,
      lifecyclePhase: LifecyclePhase.NO_HANDLERS,
      endTime: Date.now(),
    };

    await this.lifecycleManager.noHandlers(event, context);
    return [];
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

    options?.plugins?.forEach((plugin) => this.usePlugin(plugin));
  }

  private isPatternKey(key: string): boolean {
    return !!(this.patternOptions.wildcard && key.includes(this.patternOptions.wildcard));
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
      const hasMore = patternIndex < patternParts.length - 1;
      if (!hasMore) {
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

  private normalizeError(error: unknown): EventError {
    if (error instanceof Error) {
      return {
        error,
        message: error.message,
        stack: error.stack,
      };
    }
    return {
      error,
      message: String(error),
    };
  }

  private normalizeEventName(event: number | string | symbol): string {
    return String(event);
  }

  private async processEvent<K extends StringKeyOf<EM>, R = unknown>(
    event: K,
    context: EventContext<EM[K], GC>,
    allHandlers: Array<HandlerWrapper<EM, K, any, GC>>,
    emitOptions?: EventEmitOptions,
    taskOptions?: EventTaskOptions,
  ): Promise<Array<EventEmitResult<R>>> {
    const {
      globalTimeout,
      maxConcurrency = DEFAULT_MAX_CONCURRENCY,
      parallel = DEFAULT_PARALLEL,
      stopOnError = DEFAULT_STOP_ON_ERROR,
      traceId,
    } = emitOptions ?? {};

    const effectiveParallel = stopOnError ? false : parallel;
    const eventMiddlewares = this.getFilteredMiddlewares(String(event), context);
    const results: Array<EventEmitResult<R>> = [];
    const stopFlag = { value: false };

    const executeHandler = this.createHandlerExecutor<R>(
      context,
      eventMiddlewares,
      { globalTimeout, stopOnError, traceId },
      taskOptions,
      results,
      stopFlag,
    );

    try {
      const executionInfo: EventExecutionInfo<R> = {
        eventName: context.meta?.eventName ?? '<unknown>',
        handlerCount: allHandlers.length,
        get hasError() {
          return this.results.some((r) => r.state === 'failed');
        },
        inProgress: true,
        middlewareCount: eventMiddlewares.length,
        results,
        traceId,
        lifecycle: {
          startTime: Date.now(),
          phase: LifecyclePhase.BEFORE_HANDLER,
          endTime: undefined,
        },
      };

      await this.executeWithGlobalMiddlewares(
        context,
        async () => {
          try {
            await this.executeHandlers(
              allHandlers,
              async (handler, index) => {
                await this.lifecycleManager.beforeHandler(event, context, handler.handler, index, allHandlers.length);
                await executeHandler(handler, index);
                executionInfo.inProgress = results.length < executionInfo.handlerCount;
              },
              effectiveParallel,
              maxConcurrency,
              stopFlag,
            );
          } finally {
            executionInfo.inProgress = false;
            executionInfo.lifecycle!.phase = LifecyclePhase.AFTER_HANDLER;
            executionInfo.lifecycle!.endTime = Date.now();
          }
        },
        executionInfo,
      );
    } catch (error) {
      const eventError = this.normalizeError(error);
      await this.lifecycleManager.onError(event, context, eventError, LifecyclePhase.ERROR_HANDLING);
      results.push(this.createFailedResult<R>(error, traceId));
    }

    this.cleanupOnceHandlers(event, allHandlers);
    return results;
  }

  private registerHandler<K extends StringKeyOf<EM>, R = unknown>(
    targetMap: Map<string, Array<HandlerWrapper<EM, K, R, GC>>>,
    key: K,
    handler: EventHandler<EM, K, R, GC>,
    options?: { once?: boolean; priority?: number },
  ): () => void {
    const wrapper: HandlerWrapper<EM, K, R, GC> = {
      handler,
      once: options?.once ?? DEFAULT_ONCE,
      priority: options?.priority ?? DEFAULT_PRIORITY,
    };

    this.addToMapSorted(targetMap, String(key), wrapper, sortByPriorityDesc, (w) => w.handler);

    return () => this.unregisterHandler(targetMap, key, handler);
  }

  private async safeUninstall(plugin: EventBusPlugin<EM, GC>): Promise<void> {
    try {
      const result = plugin.uninstall?.(this);
      if (result instanceof Promise) {
        await result;
      }
    } catch (error) {
      console.error('Error uninstalling plugin:', error);
    }
  }

  private uninstallAllPlugins(): void {
    for (let i = this.installedPlugins.length - 1; i >= 0; i--) {
      void this.safeUninstall(this.installedPlugins[i].plugin);
    }
    this.installedPlugins.length = 0;
  }

  private unmatchAllHandlers(handler: EventHandler<EM, any, any, GC>): void {
    for (const [pattern, handlers] of Array.from(this.patternHandlers.entries())) {
      const filtered = handlers.filter((w) => w.handler !== handler);
      if (filtered.length === 0) {
        this.patternHandlers.delete(pattern);
      } else {
        this.patternHandlers.set(pattern, filtered);
      }
    }
  }

  private unregisterHandler<K extends StringKeyOf<EM>, R = unknown>(
    targetMap: Map<string, Array<HandlerWrapper<EM, K, R, GC>>>,
    key: K,
    handler?: EventHandler<EM, K, R, GC>,
  ): void {
    if (!handler) {
      targetMap.delete(String(key));
      return;
    }

    this.removeFromMapByIdentity(targetMap, String(key), (w) => w.handler === handler);
  }
}
