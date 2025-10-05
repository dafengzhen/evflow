import type { EventState } from './enums.ts';

export interface BroadcastAdapter<EM extends EventMap = EventMap> {
  disconnect?(): Promise<void>;
  healthCheck?(): Promise<{ healthy: boolean; message?: string }>;
  name: string;
  publish(channel: string, message: BroadcastMessage<EM>): Promise<void>;
  subscribe(channel: string, callback: (message: BroadcastMessage<EM>) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
}

export interface BroadcastAdapterStatus {
  error?: string;
  healthy: boolean;
  name: string;
}

export interface BroadcastFilter<EM extends EventMap = EventMap> {
  (message: BroadcastMessage<EM>): boolean | Promise<boolean>;
}

export interface BroadcastMessage<EM extends EventMap = EventMap> {
  broadcastId: string;
  context: EventContext<EM[keyof EM]>;
  eventName: keyof EM;
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

export type ErrorHandler = (error: Error, context: PlainObject, type: ErrorType) => void;

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

export type EventHandler<Ctx extends PlainObject = PlainObject, R = unknown> = (
  context: EventContext<Ctx>,
) => Promise<R> | R;

export interface EventMap {
  [eventName: string]: PlainObject;
}

export type EventMiddleware<Ctx extends PlainObject = PlainObject, R = unknown> = (
  context: EventContext<Ctx>,
  next: () => Promise<R>,
) => Promise<R>;

export type EventMigrator<Ctx extends PlainObject = PlainObject> = (context: EventContext<Ctx>) => EventContext<Ctx>;

export interface EventRecord {
  context: PlainObject;
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
  saveErrorRecord?(error: Error, context: PlainObject, type: string): Promise<void>;
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

export type HandlerResult<R> = {
  error?: Error;
  handlerIndex: number;
  result?: R;
  state: EventState;
  traceId: string;
};

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

export type PlainObject = Record<string, any>;

export interface StoreHealthStatus {
  details?: PlainObject;
  message?: string;
  status: 'degraded' | 'healthy' | 'not_configured' | 'unhealthy';
}

export interface UsageInfo {
  lastUsed: number;
  usageCount: number;
}

export type VersionedHandler<Ctx extends PlainObject, R = unknown> = {
  handler: EventHandler<Ctx, R>;
  version: number;
};
