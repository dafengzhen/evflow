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
  id?: string; // 事件ID
  meta?: T; // 任意元数据
  name?: string; // 事件名称
  parentId?: string; // 上级事件 ID（支持嵌套链路追踪）
  timestamp?: number; // 触发时间
  traceId?: string; // 链路追踪 ID
}

export type EventHandler<Ctx extends PlainObject = PlainObject, R = any> = (
  context: EventContext<Ctx>,
) => Promise<R> | R;

export interface EventMap<Ctx extends PlainObject = PlainObject> {
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
