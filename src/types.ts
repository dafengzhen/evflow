import type { EventState } from './enums.ts';

export interface BroadcastAdapter<EM extends EventMap = EventMap> {
  disconnect(): Promise<void>;
  healthCheck(): Promise<BroadcastAdapterStatus>;
  name: string;
  publish<K extends keyof EM>(channel: string, message: BroadcastMessage<EM, K>): Promise<void>;
  subscribe<K extends keyof EM>(channel: string, callback: (message: BroadcastMessage<EM, K>) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
}

export interface BroadcastAdapterStatus {
  error?: string;
  healthy: boolean;
  name: string;
}

export interface BroadcastFilter<EM extends EventMap = EventMap> {
  <K extends keyof EM>(message: BroadcastMessage<EM, K>): boolean | Promise<boolean>;
}

export interface BroadcastMessage<EM extends EventMap = EventMap, K extends keyof EM = keyof EM> {
  broadcastId: string;
  context: EventContext<EM[K]>;
  eventName: K;
  id: string;
  source: string;
  timestamp: number;
  traceId: string;
  version: number;
}

export interface BroadcastOptions {
  adapters?: string[];
  channels?: string[];
  excludeSelf?: boolean;
  persistent?: boolean;
  ttl?: number;
}

export interface DLQOperationResult {
  dlqId: string;
  error?: unknown;
  message?: string;
  success: boolean;
}

export interface EmitOptions {
  globalTimeout?: number;
  maxConcurrency?: number;
  parallel?: boolean;
  stopOnError?: boolean;
}

export interface EmitResult<R = any> {
  error?: Error;
  handlerIndex: number;
  result?: R;
  state: EventState;
  traceId: string;
}

export type ErrorHandler<EM extends EventMap = EventMap, K extends keyof EM = keyof EM> = (
  error: Error,
  context: EventContext<EM[K]>,
  type: ErrorType,
) => void;

export type ErrorType = 'adapter' | 'broadcast' | 'cleanup' | 'handler' | 'middleware' | 'migrator' | 'store';

export interface EventBusOptions {
  cleanupIntervalMs?: number;
  errorHandler?: ErrorHandler;
  handlerInactivityThreshold?: number;
  maxHandlersPerEvent?: number;
  maxMiddlewarePerEvent?: number;
  maxProcessedBroadcasts?: number;
  middlewareInactivityThreshold?: number;
  migratorInactivityThreshold?: number;
}

export interface EventContext<T extends PlainObject = PlainObject> {
  broadcast?: boolean;
  broadcastChannels?: string[];
  broadcastId?: string;
  broadcastSource?: string;
  disableAutoDLQ?: boolean;
  excludeSelf?: boolean;
  id?: string;
  maxRequeue?: number;
  meta?: T;
  name?: string;
  parentId?: string;
  receivedAt?: number;
  requeueCount?: number;
  signal?: AbortSignal;
  timestamp?: number;
  traceId?: string;
  version?: number;
}

export type EventHandler<EM extends EventMap = EventMap, K extends keyof EM = keyof EM, R = unknown> = (
  context: EventContext<EM[K]>,
) => Promise<R> | R;

export interface EventMap {
  [eventName: string]: PlainObject;
}

export type EventMiddleware<EM extends EventMap = EventMap, K extends keyof EM = keyof EM, R = unknown> = (
  context: EventContext<EM[K]>,
  next: () => Promise<R>,
) => Promise<R>;

export type EventMigrator<EM extends EventMap = EventMap, K extends keyof EM = keyof EM> = (
  context: EventContext<EM[K]>,
) => EventContext<EM[K]>;

export interface EventRecord<EM extends EventMap = EventMap, K extends keyof EM = keyof EM> {
  context: EventContext<EM[K]>;
  error?: Error;
  errorStack?: string;
  id: string;
  name: string;
  result?: unknown;
  state: EventState;
  timestamp: number;
  traceId: string;
  version?: number;
}

export interface EventStore {
  clear(): Promise<void>;
  delete(traceId: string, id: string): Promise<void>;
  healthCheck(): Promise<StoreHealthStatus>;
  load(traceId: string): Promise<EventRecord[]>;
  loadAll(): Promise<EventRecord[]>;
  loadByName(name: string): Promise<EventRecord[]>;
  loadByTimeRange(start: number, end: number): Promise<EventRecord[]>;
  save(record: EventRecord): Promise<void>;
  saveErrorRecord?(error: Error, context: PlainObject, type: ErrorType): Promise<void>;
  saveEventResults(context: EventContext, results: EmitResult[]): Promise<void>;
}

export interface EventTaskOptions {
  id?: string;
  isRetryable?: (err: unknown) => boolean;
  name?: string;
  onStateChange?: (state: EventState, info?: PlainObject) => void;
  retries?: number;
  retryBackoff?: number;
  retryDelay?: number;
  timeout?: number;
}

export type HandlerResult<R = any> = EmitResult<R>;

export interface HandlerUsageStats {
  handlers: { byEvent: Record<string, number>; total: number };
  middlewares: { byEvent: Record<string, number>; total: number };
  migrators: { byEvent: Record<string, number>; total: number };
}

export interface HealthCheckResult {
  details: {
    adapters: BroadcastAdapterStatus[];
    metrics: PlainObject;
    store: StoreHealthStatus;
  };
  status: 'degraded' | 'healthy' | 'unhealthy';
}

export type PlainObject = Record<string, unknown>;

export interface StoreHealthStatus {
  details?: PlainObject;
  message?: string;
  status: 'degraded' | 'healthy' | 'not_configured' | 'unhealthy';
}

export interface UsageInfo {
  lastUsed: number;
  usageCount: number;
}

export type VersionedHandler<EM extends EventMap, K extends keyof EM, R = unknown> = {
  handler: EventHandler<EM, K, R>;
  version: number;
};
