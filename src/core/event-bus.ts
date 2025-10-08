import type {
  EventBusOptions,
  EventBusPlugin,
  EventContext,
  EventEmitOptions,
  EventEmitResult,
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
} from '../types/types.ts';

import {
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_PARALLEL,
  DEFAULT_PATTERN_OPTIONS,
  DEFAULT_PRIORITY,
  DEFAULT_STOP_ON_ERROR,
} from '../constants.ts';
import { sortByPriority } from '../utils.ts';
import { EventTask } from './event-task.ts';

/**
 * EventBus.
 *
 * @author dafengzhen
 */
export class EventBus<EM extends EventMap = Record<string, never>, GC extends PlainObject = Record<string, never>>
  implements IEventBus<EM, GC>
{
  private readonly globalMiddlewares: MiddlewareWrapper<EM, keyof EM, any, GC>[] = [];

  private readonly handlers = new Map<keyof EM, HandlerWrapper<EM, keyof EM, any, GC>[]>();

  private readonly installedPlugins: InstalledPlugin<EM, GC>[] = [];

  private readonly middlewares = new Map<keyof EM, MiddlewareWrapper<EM, any, any, GC>[]>();

  private readonly patternHandlers = new Map<string, HandlerWrapper<EM, keyof EM, any, GC>[]>();

  private readonly patternMiddlewares = new Map<string, MiddlewareWrapper<EM, any, any, GC>[]>();

  private readonly patternOptions: Required<PatternMatchingOptions>;

  constructor(options?: EventBusOptions<EM, GC> & { patternMatching?: PatternMatchingOptions }) {
    this.patternOptions = {
      ...DEFAULT_PATTERN_OPTIONS,
      ...options?.patternMatching,
    };
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

  async emit<K extends keyof EM, R = unknown>(
    event: K,
    context: EventContext<EM[K], GC>,
    taskOptions?: EventTaskOptions,
    emitOptions?: EventEmitOptions,
  ): Promise<EventEmitResult<R>[]> {
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

    return this.processEvent(
      enhancedContext,
      allHandlers,
      eventMiddlewares,
      { effectiveParallel, globalTimeout, maxConcurrency, stopOnError, traceId },
      taskOptions,
      event,
    );
  }

  match<K extends keyof EM, R = unknown>(
    pattern: string,
    handler: EventHandler<EM, K, R, GC>,
    options?: { once?: boolean; priority?: number },
  ): () => void {
    return this.registerHandler(this.patternHandlers, pattern, handler as EventHandler<EM, keyof EM, R, GC>, options);
  }

  off<K extends keyof EM, R = unknown>(event: K, handler?: EventHandler<EM, K, R, GC>): void {
    this.unregisterHandler(this.handlers, event, handler as EventHandler<EM, keyof EM, R, GC> | undefined);
  }

  on<K extends keyof EM, R = unknown>(
    event: K,
    handler: EventHandler<EM, K, R, GC>,
    options?: { once?: boolean; priority?: number },
  ): () => void {
    return this.registerHandler(this.handlers, event, handler as EventHandler<EM, keyof EM, R, GC>, options);
  }

  unmatch<K extends keyof EM, R = unknown>(pattern: string, handler?: EventHandler<EM, K, R, GC>): void {
    this.unregisterHandler(this.patternHandlers, pattern, handler as EventHandler<EM, keyof EM, R, GC>);
  }

  use<K extends keyof EM, R = unknown>(
    event: K,
    middleware: EventMiddleware<EM, K, R, GC>,
    options?: MiddlewareOptions,
  ): () => void {
    const wrapper: MiddlewareWrapper<EM, K, R, GC> = {
      filter: options?.filter,
      middleware,
      priority: options?.priority ?? DEFAULT_PRIORITY,
    };

    const eventStr = event as string;
    const targetMap =
      this.patternOptions.wildcard && eventStr.includes(this.patternOptions.wildcard)
        ? this.patternMiddlewares
        : this.middlewares;

    const middlewares = targetMap.get(eventStr) ?? [];
    middlewares.push(wrapper);
    middlewares.sort(sortByPriority);
    targetMap.set(eventStr, middlewares);

    return this.createMiddlewareRemover(event, eventStr, middleware);
  }

  useGlobalMiddleware<R = unknown>(
    middleware: EventMiddleware<EM, keyof EM, R, GC>,
    options?: MiddlewareOptions,
  ): () => void {
    const wrapper: MiddlewareWrapper<EM, keyof EM, R, GC> = {
      filter: options?.filter,
      middleware,
      priority: options?.priority ?? DEFAULT_PRIORITY,
    };

    this.globalMiddlewares.push(wrapper);
    this.globalMiddlewares.sort(sortByPriority);

    return () => {
      const index = this.globalMiddlewares.findIndex((w) => w.middleware === middleware);
      if (index !== -1) {
        this.globalMiddlewares.splice(index, 1);
      }
    };
  }

  usePlugin(plugin: EventBusPlugin<EM, GC>): () => void {
    plugin.install?.(this);
    this.installedPlugins.push({ plugin });
    return () => {
      const index = this.installedPlugins.findIndex((p) => p.plugin === plugin);
      if (index !== -1) {
        const [installedPlugin] = this.installedPlugins.splice(index, 1);
        void this.safeUninstall(installedPlugin.plugin);
      }
    };
  }

  private cleanupOnceHandlers<K extends keyof EM>(event: K, handlers: HandlerWrapper<EM, K, any, GC>[]): void {
    const onceHandlers = handlers.filter((h) => h.once).map((h) => h.handler);
    if (onceHandlers.length === 0) {
      return;
    }

    onceHandlers.forEach((handler) => {
      this.off(event, handler);
      for (const [pattern, patternHandlers] of this.patternHandlers.entries()) {
        const filtered = patternHandlers.filter((w) => w.handler !== handler);
        if (filtered.length === 0) {
          this.patternHandlers.delete(pattern);
        } else {
          this.patternHandlers.set(pattern, filtered);
        }
      }
    });
  }

  private createFailedResult<R>(error: unknown, traceId?: string): EventEmitResult<R> {
    const err = error instanceof Error ? error : new Error(String(error));
    return {
      error: {
        error: err,
        message: err.message,
        stack: err.stack,
      },
      state: 'failed',
      traceId,
    };
  }

  private createHandlerExecutor<R>(
    context: EventContext<any, GC>,
    eventMiddlewares: MiddlewareWrapper<EM, any, any, GC>[],
    options: { globalTimeout?: number; stopOnError: boolean; traceId?: string },
    taskOptions?: EventTaskOptions,
    results?: EventEmitResult<R>[],
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
      } catch (error) {
        const failedResult = this.createFailedResult<R>(error, options.traceId);
        results?.push(failedResult);

        if (options.stopOnError) {
          stopFlag!.value = true;
        }
      }
    };
  }

  private createMiddlewareRemover<K extends keyof EM>(
    event: K,
    eventStr: string,
    middleware: EventMiddleware<EM, K, any, GC>,
  ): () => void {
    return () => {
      [this.middlewares, this.patternMiddlewares].forEach((map) => {
        const list = map.get(eventStr) || map.get(event);
        if (list) {
          const filtered = list.filter((w) => w.middleware !== middleware);
          if (filtered.length === 0) {
            map.delete(eventStr);
          } else {
            map.set(eventStr, filtered);
          }
        }
      });
    };
  }

  private createWrappedHandler<K extends keyof EM, R>(
    handler: EventHandler<EM, K, R, GC>,
    middlewares: MiddlewareWrapper<EM, K, R, GC>[],
    context: EventContext<EM[K], GC>,
  ): () => Promise<R> {
    return async (): Promise<R> => {
      let middlewareIndex = -1;

      const next = async (): Promise<R> => {
        middlewareIndex++;
        if (middlewareIndex < middlewares.length) {
          return middlewares[middlewareIndex].middleware(context, next);
        }
        return handler(context) as Promise<R>;
      };

      return next();
    };
  }

  private deduplicateHandlers<K extends keyof EM, R>(
    handlers: HandlerWrapper<EM, K, R, GC>[],
  ): HandlerWrapper<EM, K, R, GC>[] {
    const seen = new Set<EventHandler<EM, K, R, GC>>();
    return handlers.filter((wrapper) => {
      if (seen.has(wrapper.handler)) {
        return false;
      }
      seen.add(wrapper.handler);
      return true;
    });
  }

  private deduplicateMiddlewares<K extends keyof EM, R>(
    middlewares: MiddlewareWrapper<EM, K, R, GC>[],
  ): MiddlewareWrapper<EM, K, R, GC>[] {
    const seen = new Set<EventMiddleware<EM, K, R, GC>>();
    return middlewares.filter((wrapper) => {
      if (seen.has(wrapper.middleware)) {
        return false;
      }
      seen.add(wrapper.middleware);
      return true;
    });
  }

  private enhanceContext<K extends keyof EM>(event: K, context: EventContext<EM[K], GC>): EventContext<EM[K], GC> {
    return {
      ...context,
      meta: {
        eventName: event as string,
        ...context.meta,
      },
    };
  }

  private async executeHandlers<K extends keyof EM, R>(
    handlers: HandlerWrapper<EM, K, R, GC>[],
    executeHandler: (handler: HandlerWrapper<EM, K, R, GC>) => Promise<void>,
    parallel: boolean,
    maxConcurrency: number,
    stopFlag: { value: boolean },
  ): Promise<void> {
    return parallel
      ? this.executeParallel(handlers, executeHandler, maxConcurrency, stopFlag)
      : this.executeSequential(handlers, executeHandler, stopFlag);
  }

  private async executeParallel<K extends keyof EM, R>(
    handlers: HandlerWrapper<EM, K, R, GC>[],
    executeHandler: (handler: HandlerWrapper<EM, K, R, GC>) => Promise<void>,
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

      const promise = executeHandler(handler).finally(() => executing.delete(promise));
      executing.add(promise);
    }

    await Promise.all(executing);
  }

  private async executeSequential<K extends keyof EM, R>(
    handlers: HandlerWrapper<EM, K, R, GC>[],
    executeHandler: (handler: HandlerWrapper<EM, K, R, GC>) => Promise<void>,
    stopFlag: { value: boolean },
  ): Promise<void> {
    for (const handler of handlers) {
      if (stopFlag.value) {
        break;
      }
      await executeHandler(handler);
    }
  }

  private async executeWithGlobalMiddlewares(
    context: EventContext<any, GC>,
    finalExecutor: () => Promise<void>,
  ): Promise<void> {
    const applicableMiddlewares = this.globalMiddlewares.filter((mw) => !mw.filter || mw.filter(context));

    let index = -1;
    const next = async (): Promise<void> => {
      index++;
      return index < applicableMiddlewares.length
        ? applicableMiddlewares[index].middleware(context, next as any)
        : finalExecutor();
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

  private getAllHandlersForEvent<K extends keyof EM>(event: K): HandlerWrapper<EM, K, any, GC>[] {
    const exactHandlers = this.handlers.get(event) ?? [];
    const patternHandlers = this.getMatchingPatternHandlers(event as string);
    return this.deduplicateHandlers([...exactHandlers, ...patternHandlers]);
  }

  private getFilteredMiddlewares<K extends keyof EM>(
    event: K,
    context: EventContext<EM[K], GC>,
  ): MiddlewareWrapper<EM, K, any, GC>[] {
    const exactMiddlewares = this.middlewares.get(event) ?? [];
    const patternMiddlewares = this.getMatchingPatternMiddlewares(event as string);
    const allMiddlewares = this.deduplicateMiddlewares([...exactMiddlewares, ...patternMiddlewares]);
    return allMiddlewares.filter((mw) => !mw.filter || mw.filter(context));
  }

  private getMatchingPatternHandlers(eventName: string): HandlerWrapper<EM, any, any, GC>[] {
    const matchingHandlers: HandlerWrapper<EM, any, any, GC>[] = [];

    for (const [pattern, handlers] of this.patternHandlers.entries()) {
      if (this.isPatternMatch(eventName, pattern)) {
        matchingHandlers.push(...handlers);
      }
    }

    return matchingHandlers.sort(sortByPriority);
  }

  private getMatchingPatternMiddlewares(eventName: string): MiddlewareWrapper<EM, any, any, GC>[] {
    const matchingMiddlewares: MiddlewareWrapper<EM, any, any, GC>[] = [];

    for (const [pattern, middlewares] of this.patternMiddlewares.entries()) {
      if (this.isPatternMatch(eventName, pattern)) {
        matchingMiddlewares.push(...middlewares);
      }
    }

    return matchingMiddlewares.sort(sortByPriority);
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
        ...options.globalMiddlewares.map((mw) => ({ middleware: mw, priority: DEFAULT_PRIORITY })),
      );
    }

    options?.plugins?.forEach((plugin) => this.usePlugin(plugin));
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

    if (matchMultiple && patternParts.some((part) => wildcard && part === wildcard + wildcard)) {
      return this.matchWithDoubleWildcard(eventParts, patternParts, 0, 0);
    }

    return this.matchSimpleSegments(eventParts, patternParts);
  }

  private matchSimpleSegments(eventParts: string[], patternParts: string[]): boolean {
    const { wildcard } = this.patternOptions;
    const commonWildcardChars = ['*', '?', '+', '#'];

    if (eventParts.length !== patternParts.length) {
      return false;
    }

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      const eventPart = eventParts[i];

      if (patternPart === wildcard) {
        if (commonWildcardChars.includes(eventPart)) {
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
    eventIndex: number = 0,
    patternIndex: number = 0,
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
    const commonWildcardChars = ['*', '?', '+', '#'];

    if (currentPattern === wildcard) {
      if (commonWildcardChars.includes(currentEvent)) {
        return false;
      }
    } else if (currentPattern !== currentEvent) {
      return false;
    }

    return this.matchWithDoubleWildcard(eventParts, patternParts, eventIndex + 1, patternIndex + 1);
  }

  private async processEvent<K extends keyof EM, R = unknown>(
    context: EventContext<EM[K], GC>,
    allHandlers: HandlerWrapper<EM, K, any, GC>[],
    eventMiddlewares: MiddlewareWrapper<EM, K, any, GC>[],
    options: {
      effectiveParallel: boolean;
      globalTimeout?: number;
      maxConcurrency: number;
      stopOnError: boolean;
      traceId?: string;
    },
    taskOptions?: EventTaskOptions,
    event?: K,
  ): Promise<EventEmitResult<R>[]> {
    const results: EventEmitResult<R>[] = [];
    const stopFlag = { value: false };

    const executeHandler = this.createHandlerExecutor<R>(
      context,
      eventMiddlewares,
      options,
      taskOptions,
      results,
      stopFlag,
    );

    await this.executeWithGlobalMiddlewares(context, () =>
      this.executeHandlers(allHandlers, executeHandler, options.effectiveParallel, options.maxConcurrency, stopFlag),
    );

    if (event) {
      this.cleanupOnceHandlers(event, allHandlers);
    }

    return results;
  }

  private registerHandler<R>(
    targetMap: Map<keyof EM | string, HandlerWrapper<EM, keyof EM, R, GC>[]>,
    key: keyof EM | string,
    handler: EventHandler<EM, keyof EM, R, GC>,
    options?: { once?: boolean; priority?: number },
  ): () => void {
    const wrapper: HandlerWrapper<EM, keyof EM, R, GC> = {
      handler,
      once: options?.once ?? false,
      priority: options?.priority ?? DEFAULT_PRIORITY,
    };

    const handlers = targetMap.get(key) ?? [];
    handlers.push(wrapper);
    handlers.sort(sortByPriority);
    targetMap.set(key, handlers);

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

  private unregisterHandler<R>(
    targetMap: Map<keyof EM | string, HandlerWrapper<EM, keyof EM, R, GC>[]>,
    key: keyof EM | string,
    handler?: EventHandler<EM, keyof EM, R, GC>,
  ): void {
    if (!handler) {
      targetMap.delete(key);
      return;
    }

    const handlers = targetMap.get(key);
    if (handlers) {
      const filtered = handlers.filter((w) => w.handler !== handler);
      if (filtered.length === 0) {
        targetMap.delete(key);
      } else {
        targetMap.set(key, filtered);
      }
    }
  }
}
