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

export type BuilderState = {
  middleware?: boolean;
  wildcard?: boolean;
};

export type BuiltEmitter<T extends BaseEventDefinitions, S extends BuilderState> = AbstractEventEmitter<T> &
  (S['middleware'] extends true ? MiddlewareSupport<T> : object) &
  (S['wildcard'] extends true ? MatchSupport<T> : object);

export interface ConfigurableEventEmitter<T extends BaseEventDefinitions> extends EventEmitter<T> {
  configure(config: Partial<EventEmitterConfig>): void;

  getConfig(): Readonly<EventEmitterConfig>;
}

export type Constructor<T = object> = new (...args: any[]) => T;

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

export interface EventBusOptions {
  middleware?: boolean;
  wildcard?: boolean;
}

export interface EventContext<
  T extends BaseEventDefinitions,
  E extends AbstractEventEmitter<T> = AbstractEventEmitter<T>,
> {
  emitter: E;
  eventName: EventName<T>;
  options?: ExecOptions;
  payload: EventPayload<T, EventName<T>> | undefined;
  state: EventPlainObject;
}

export interface EventEmitter<T extends BaseEventDefinitions> {
  emit<K extends EventName<T>>(eventName: K, payload?: EventPayload<T, K>, options?: EmitOptions): Promise<void>;

  off<K extends EventName<T>>(eventName: K, listener: EventListener<T, K>): void;

  on<K extends EventName<T>>(eventName: K, listener: EventListener<T, K>, options?: OnOptions): () => void;

  once<K extends EventName<T>>(eventName: K, listener: EventListener<T, K>, options?: OnceOptions): () => void;
}

export type EventEmitterConfig = object;

export type EventListener<T extends BaseEventDefinitions, K extends EventName<T>> = (
  payload: EventPayload<T, K>,
) => Promise<void>;

export type EventMiddleware<
  T extends BaseEventDefinitions,
  E extends AbstractEventEmitter<T> = AbstractEventEmitter<T>,
> = (ctx: EventContext<T, E>, next: () => Promise<void>) => Promise<void>;

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

export interface MatchSupport<T extends BaseEventDefinitions> {
  match(pattern: string, listener: EventListener<T, any>, options?: OnOptions): () => void;

  matchOnce(pattern: string, listener: EventListener<T, any>, options?: OnceOptions): () => void;

  unmatch(pattern: string, listener: EventListener<T, any>): void;
}

export type MiddlewareEventEmitter<T extends BaseEventDefinitions> = AbstractEventEmitter<T> & MiddlewareSupport<T>;

export interface MiddlewareSupport<T extends BaseEventDefinitions> {
  use(middleware: EventMiddleware<T, any>): () => void;
}

export type OnceOptions = Omit<OnOptions, 'once'>;

export interface OnOptions {
  once?: boolean;
  priority?: number;
}

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

export type WildcardEventEmitter<T extends BaseEventDefinitions> = AbstractEventEmitter<T> & MatchSupport<T>;
