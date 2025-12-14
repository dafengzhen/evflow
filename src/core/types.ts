import type { AbstractEventEmitter } from './abstract-event-emitter.ts';

export interface AbortOptions {
  onCancel: () => void;
  signal?: AbortSignal;
}

export type AbstractConstructor<T = object> = abstract new (...args: any[]) => T;

export interface BaseEventDefinition<P = undefined> {
  payload: P;
}

export interface BaseEventDefinitions {
  [eventName: string]: BaseEventDefinition<unknown>;
}

export type BaseOptions = AbortOptions & LifecycleOptions & RetryOptions & TimeoutOptions;

export interface BuilderOptions {
  [key: string]: unknown;

  middleware?: boolean;
  wildcard?: boolean;
}

export type BuilderState = {
  middleware?: boolean;
  wildcard?: boolean;
};

export type BuiltEmitter<T extends BaseEventDefinitions, O extends BuilderOptions> = AbstractEventEmitter<T> &
  (O['middleware'] extends true ? MiddlewareSupport<T> : object) &
  (O['wildcard'] extends true ? MatchSupport<T> : object);

export type DefaultBaseOptions = {
  maxRetries: 3;
  onCancel: () => void;
  onRetryAttempt: () => void;
  onStateChange: () => void;
  onTimeout: () => void;
  retryDelay: 1000;
  shouldRetry: () => false;
  throwOnError: false;
  timeout: 30000;
};

export type EmitOptions = Partial<BaseOptions>;

export interface EventContext<
  T extends BaseEventDefinitions,
> {
  emitter: AbstractEventEmitter<T>;
  eventName: EventName<T>;
  options?: ExecOptions;
  payload: EventPayload<T, EventName<T>> | undefined;
  state: EventPlainObject;
}

export interface EventEmitter<T extends BaseEventDefinitions> {
  clear(): Promise<void>;

  configure(config: Partial<EventEmitterConfig>): void;

  destroy(): Promise<void>;

  emit<K extends EventName<T>>(eventName: K, payload?: EventPayload<T, K>, options?: EmitOptions): Promise<void>;

  getConfig(): Readonly<EventEmitterConfig>;

  listenerCount(eventName?: EventName<T>): number;

  off<K extends EventName<T>>(eventName: K, listener: EventListener<T, K>): void;

  on<K extends EventName<T>>(eventName: K, listener: EventListener<T, K>, options?: OnOptions): () => void;

  once<K extends EventName<T>>(eventName: K, listener: EventListener<T, K>, options?: OnceOptions): () => void;
}

export interface EventEmitterConfig {
  [key: string]: unknown;

  maxListeners?: number;
}

export type EventListener<T extends BaseEventDefinitions, K extends EventName<T>> = (
  payload: EventPayload<T, K>
) => Promise<void>;

export type EventMiddleware<
  T extends BaseEventDefinitions
> = (ctx: EventContext<T>, next: () => Promise<void>) => Promise<void>;

export type EventName<T extends BaseEventDefinitions> = Extract<keyof T, string>;

export type EventPayload<T extends BaseEventDefinitions, K extends EventName<T>> = T[K]['payload'];

export type EventPlainObject = Record<string, unknown>;

export type EventState = 'cancelled' | 'failed' | 'pending' | 'retrying' | 'running' | 'succeeded' | 'timeout';

export type ExecOptions = BaseOptions;

export interface LifecycleOptions {
  onStateChange: (state: EventState) => void;
  throwOnError: boolean;
}

export interface ListenerEntry<T extends BaseEventDefinitions, K extends EventName<T>> {
  eventName: EventName<T>;
  listener: EventListener<T, K>;
  once?: boolean;
  priority?: number;
}

export interface ListenerOptions {
  once?: boolean;
  priority?: number;
}

export interface MatchSupport<T extends BaseEventDefinitions> {
  match(pattern: string, listener: EventListener<T, any>, options?: OnOptions): () => void;

  matchOnce(pattern: string, listener: EventListener<T, any>, options?: OnceOptions): () => void;

  unmatch(pattern: string, listener: EventListener<T, any>): void;
}

export interface MiddlewareSupport<T extends BaseEventDefinitions> {
  getMiddlewareCount(): number;

  use(middleware: EventMiddleware<T>): () => void;
}

export type OnceOptions = Omit<OnOptions, 'once'>;

export type OnOptions = ListenerOptions;

export interface PatternListenerEntry<T extends BaseEventDefinitions> {
  listener: EventListener<T, any>;
  once?: boolean;
  pattern: string;
  priority?: number;
}

export interface RetryOptions {
  maxRetries: number;
  onRetryAttempt: (attempt: number, error: unknown) => void;
  retryDelay: ((attempt: number) => number) | number;
  shouldRetry: (error: unknown) => boolean;
}

export interface TimeoutOptions {
  onTimeout: (timeout: number) => void;
  timeout: number;
}

export interface WildcardCompileOptions {
  cache?: Map<string, RegExp>;
  flags?: string;
  separator?: string;
}
