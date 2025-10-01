export enum EventState {
  Cancelled = 'cancelled',
  Failed = 'failed',
  Idle = 'idle',
  Running = 'running',
  Succeeded = 'succeeded',
  Timeout = 'timeout',
}

export interface EmitOptions {
  globalTimeout?: number;
  parallel?: boolean;
  stopOnError?: boolean;
}

export interface EventContext<T extends PlainObject = PlainObject> {
  id?: string;
  meta?: T;
  name?: string;
  parentId?: string;
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
  load(traceId: string): Promise<EventRecord[]>;
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
