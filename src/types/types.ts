export interface EventBusOptions<EM extends EventMap, GC extends PlainObject = Record<string, never>> {
  globalMiddlewares?: EventMiddleware<EM, keyof EM, any, GC>[];
  plugins?: EventBusPlugin<EM, GC>[];
}

export interface EventBusPlugin<EM extends EventMap = EventMap, GC extends PlainObject = Record<string, never>> {
  install(bus: IEventBus<EM, GC>): Promise<void> | void;
  uninstall?(bus: IEventBus<EM, GC>): Promise<void> | void;
}

export interface EventContext<T extends PlainObject = PlainObject, GC extends PlainObject = PlainObject> {
  data: T;
  global?: GC;
  meta?: PlainObject & {
    eventName?: string;
  };
}

export type EventData<EM extends EventMap, K extends keyof EM> = EM[K];

export interface EventEmitOptions {
  globalTimeout?: number;
  ignoreNoHandlersWarning?: boolean;
  maxConcurrency?: number;
  parallel?: boolean;
  stopOnError?: boolean;
  traceId?: string;
}

export interface EventEmitResult<R = unknown> {
  error?: EventError;
  result?: R;
  state: EventState;
  traceId?: string;
}

export interface EventError {
  code?: string;
  error?: unknown;
  message: string;
  stack?: string;
}

export type EventHandler<
  EM extends EventMap = EventMap,
  K extends keyof EM = keyof EM,
  R = unknown,
  GC extends PlainObject = PlainObject,
> = (context: EventContext<EM[K], GC>) => Promise<R> | R;

export type EventHandlerReturnType<H extends EventHandler<any, any, any>> =
  H extends EventHandler<any, any, infer R> ? R : never;

export interface EventMap {
  [eventName: string]: PlainObject;
}

export type EventMiddleware<
  EM extends EventMap = EventMap,
  K extends keyof EM = keyof EM,
  R = unknown,
  GC extends PlainObject = Record<string, never>,
> = (context: EventContext<EM[K], GC>, next: MiddlewareNext<R>) => Promise<R>;

export type EventState = 'cancelled' | 'failed' | 'pending' | 'retrying' | 'running' | 'succeeded' | 'timeout';

export interface EventTaskOptions {
  isRetryable?: (error: EventError) => boolean;
  maxRetries?: number;
  onRetry?: (attempt: number, error: EventError) => void;
  onStateChange?: (state: EventState) => void;
  retryDelay?: number | RetryDelayFunction;
  signal?: AbortSignal;
  timeout?: number;
}

export interface HandlerWrapper<EM extends EventMap, K extends keyof EM, R, GC extends PlainObject> {
  handler: EventHandler<EM, K, R, GC>;
  once: boolean;
  priority: number;
}

export interface IEventBus<
  EM extends EventMap = Record<string, never>,
  GC extends PlainObject = Record<string, never>,
> {
  destroy(): void;
  emit<K extends StringKeyOf<EM>, R = unknown>(
    event: K,
    context: EventContext<EM[K], GC>,
    taskOptions?: EventTaskOptions,
    emitOptions?: EventEmitOptions,
  ): Promise<EventEmitResult<R>[]>;
  match<K extends StringKeyOf<EM>, R = unknown>(
    pattern: string,
    handler: EventHandler<EM, K, R, GC>,
    options?: { once?: boolean; priority?: number },
  ): () => void;
  off<K extends StringKeyOf<EM>, R = unknown>(event: K, handler?: EventHandler<EM, K, R, GC>): void;
  on<K extends StringKeyOf<EM>, R = unknown>(
    event: K,
    handler: EventHandler<EM, K, R, GC>,
    options?: { once?: boolean; priority?: number },
  ): () => void;
  unmatch<K extends StringKeyOf<EM>, R = unknown>(pattern: string, handler?: EventHandler<EM, K, R, GC>): void;
  use<K extends StringKeyOf<EM>, R = unknown>(
    event: K,
    middleware: EventMiddleware<EM, K, R, GC>,
    options?: MiddlewareOptions,
  ): () => void;
  useGlobalMiddleware<R = unknown>(
    middleware: EventMiddleware<EM, StringKeyOf<EM>, R, GC>,
    options?: MiddlewareOptions,
  ): () => void;
  usePlugin(plugin: EventBusPlugin<EM, GC>): () => void;
}

export interface IEventBusFactory {
  create<EM extends EventMap = Record<string, never>, GC extends PlainObject = Record<string, never>>(
    options?: EventBusOptions<EM, GC>,
  ): IEventBus<EM, GC>;
}

export interface IEventTask<R = unknown> {
  execute(): Promise<EventEmitResult<R>>;
}

export interface InstalledPlugin<EM extends EventMap, GC extends PlainObject = Record<string, never>> {
  plugin: EventBusPlugin<EM, GC>;
}

export type MiddlewareNext<R = unknown> = () => Promise<R>;

export interface MiddlewareOptions {
  filter?: (context: EventContext) => boolean;
  priority?: number;
}

export interface MiddlewareWrapper<EM extends EventMap, K extends keyof EM, R, GC extends PlainObject> {
  filter?: (context: EventContext<EM[K], GC>) => boolean;
  middleware: EventMiddleware<EM, K, R, GC>;
  priority: number;
}

export interface PatternMatchingOptions {
  allowZeroLengthDoubleWildcard?: boolean;
  matchMultiple?: boolean;
  separator?: string;
  wildcard?: string;
}

export type PlainObject = Record<string, unknown>;

export type RetryDelayFunction = (attempt: number) => number;

export type StringKeyOf<T> = Extract<keyof T, string>;
