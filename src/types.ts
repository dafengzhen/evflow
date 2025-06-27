import type { StateMachine } from './state/state-machine.ts';

export type Callback = (data: any) => Promise<void> | void;

export type CloneStrategy = (value: unknown, path: string[]) => undefined | unknown;

export interface DiagnosticEntry {
  context?: Record<string, any>;
  level: DiagnosticLevel;
  message: string;
  timestamp: number;
}

export type DiagnosticLevel = 'error' | 'info' | 'warn';

export interface EventContext<TPayload = any, TResult = any> {
  id: string;
  payload?: TPayload;
  result?: TResult;
  status: EventStatus;
  tags?: string[];
}

export interface EventEntity<TPayload = any, TResult = any> {
  context: EventContext<TPayload, TResult>;
  reset(): void;
  state: StateMachine;
  transition(to: EventStatus): void;
}

export type EventHandler<TPayload = any, TResult = any, TDeps extends any[] = any[]> = (
  event: EventEntity<TPayload, TResult>,
  ...dependencies: TDeps
) => Promise<TResult> | TResult;

export interface EventOptions<TPayload = any, TResult = any> {
  id: string;
  payload?: TPayload;
  result?: TResult;
}

export type EventStatus = 'completed' | 'failed' | 'idle' | 'retrying' | 'running' | 'scheduled' | 'timeout';

export type LifecycleHook = (event: EventEntity, context: MiddlewareContext) => Promise<void> | void;

export type LifecyclePhase = 'completed' | 'failed' | 'retry' | 'running' | 'scheduled' | 'timeout';

export type LogLevel = 'error' | 'info' | 'warn';

export type Middleware = (ctx: MiddlewareContext, next: () => Promise<void>) => Promise<void>;

export type MiddlewareContext = {
  attempt?: number;
  deps: any[];
  error?: Error;
  event: EventEntity;
  result?: any;
  status?: EventStatus;
};

export interface RetryStrategyOptions {
  backoffFn?: (attempt: number) => number;
  maxRetries?: number;
  onRetry?: (attempt: number, error: Error) => Promise<void>;
  onTimeout?: () => Promise<void>;
  timeoutMs?: number;
}
