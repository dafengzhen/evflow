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
}

export type EventHandler<Ctx extends PlainObject = PlainObject, R = any> = (
  context: EventContext<Ctx>,
) => Promise<R> | R;

export interface EventMap {
  [eventName: string]: PlainObject;
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
