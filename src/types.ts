export enum EventState {
  Cancelled = 'cancelled',
  DeadLetter = 'deadletter',
  Failed = 'failed',
  Idle = 'idle',
  Running = 'running',
  Succeeded = 'succeeded',
  Timeout = 'timeout',
}

export interface BroadcastAdapter<EM extends EventMap = EventMap> {
  disconnect?(): Promise<void>;
  name: string;
  publish(channel: string, message: BroadcastMessage<EM>): Promise<void>;
  subscribe(channel: string, callback: (message: BroadcastMessage<EM>) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
}

export interface BroadcastFilter {
  (message: BroadcastMessage): boolean | Promise<boolean>;
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

export interface EmitOptions {
  globalTimeout?: number;
  parallel?: boolean;
  stopOnError?: boolean;
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
  timestamp?: number;
  traceId?: string;
  version?: number;
}

export type EventHandler<Ctx extends PlainObject = PlainObject, R = any> = (
  context: EventContext<Ctx>,
) => Promise<R> | R;

export interface EventMap {
  [eventName: string]: PlainObject;
}

export type EventMiddleware<Ctx extends PlainObject = PlainObject, R = any> = (
  context: EventContext<Ctx>,
  next: () => Promise<R>,
) => Promise<R>;

export type EventMigrator<Ctx extends PlainObject = PlainObject> = (context: EventContext<Ctx>) => EventContext<Ctx>;

export interface EventRecord {
  context: PlainObject;
  error?: any;
  id: string;
  name: string;
  result?: any;
  state: EventState;
  timestamp: number;
  traceId: string;
  version?: number;
}

export interface EventStore {
  clear(): Promise<void>;
  delete(traceId: string, id: string): Promise<void>;
  load(traceId: string): Promise<EventRecord[]>;
  loadByName(name: string): Promise<EventRecord[]>;
  loadByTimeRange(start: number, end: number): Promise<EventRecord[]>;
  save(record: EventRecord): Promise<void>;
}

export interface EventTaskOptions {
  id?: string;
  isRetryable?: (err: any) => boolean;
  name?: string;
  onStateChange?: (state: EventState, info?: any) => void;
  retries?: number;
  retryBackoff?: number;
  retryDelay?: number;
  timeout?: number;
}

export type PlainObject = Record<string, any>;

export type VersionedHandler<Ctx extends PlainObject, R = any> = {
  handler: EventHandler<Ctx, R>;
  version: number;
};
