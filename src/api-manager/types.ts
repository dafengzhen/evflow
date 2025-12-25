import type { BaseEventDefinitions, EventWithPayload } from '../core/types.ts';
import type { ApiError } from './api-error.ts';

export enum HttpMethod {
  DELETE = 'DELETE',
  GET = 'GET',
  HEAD = 'HEAD',
  OPTIONS = 'OPTIONS',
  PATCH = 'PATCH',
  POST = 'POST',
  PUT = 'PUT',
}

export interface PendingItem {
  abortedBy?: 'external' | 'timeout' | 'user';
  canceledEmitted?: boolean;
  cancelReason?: string;
  cleanupAbortBindings: () => void;
  controller: AbortController;
  request: ApiRequest;
  startEmitted?: boolean;
}

export interface RequestQueueOptions {
  timeoutMs?: number;
}

export type Waiter = () => void;

export const HttpStatus = {
  BAD_GATEWAY: 502,
  BAD_REQUEST: 400,
  CONFLICT: 409,
  CREATED: 201,
  FORBIDDEN: 403,
  GATEWAY_TIMEOUT: 504,
  INTERNAL_SERVER_ERROR: 500,
  NO_CONTENT: 204,
  NOT_FOUND: 404,
  OK: 200,
  SERVICE_UNAVAILABLE: 503,
  TIMEOUT: 408,
  TOO_MANY_REQUESTS: 429,
  UNAUTHORIZED: 401,
  UNPROCESSABLE_ENTITY: 422
} as const;

export const RETRY_STATUS_CODES = [
  HttpStatus.TIMEOUT,
  HttpStatus.TOO_MANY_REQUESTS,
  HttpStatus.INTERNAL_SERVER_ERROR,
  HttpStatus.BAD_GATEWAY,
  HttpStatus.SERVICE_UNAVAILABLE,
  HttpStatus.GATEWAY_TIMEOUT
] as const;

export type AdapterFactory = ((config: APIConfig) => HttpAdapter) | HttpAdapter;

export interface ApiCacheEntry<T = any> {
  data: T;
  etag?: string;
  expires: number;
  headers: Record<string, string>;
  lastModified?: string;
  staleWhileRevalidate?: number;
  timestamp: number;
}

export interface APIConfig {
  adapter: AdapterFactory;
  baseURL?: string;
  concurrentRequests?: number;
  defaultCacheTTL?: number;
  defaultHeaders?: Record<string, string>;
  enableCache?: boolean;
  enableMetrics?: boolean;
  maxRetries?: number;
  retryDelay?: number;
  retryDelayJitter?: number;
  timeout?: number;
  validateStatus?: (status: number) => boolean;
}

export interface ApiEvents extends BaseEventDefinitions {
  'api:cache:clear': EventWithPayload<void>;
  'api:cache:invalidated': EventWithPayload<{ entry: ApiCacheEntry; key: string }>;
  'api:cache:set': EventWithPayload<{ entry: ApiCacheEntry; key: string }>;
  'api:cache:stale': EventWithPayload<{ entry: ApiCacheEntry; key: string }>;
  'api:connection:error': EventWithPayload<{ error: Error; request: ApiRequest; }>;
  'api:metrics:collect': EventWithPayload<ApiMetrics>;
  'api:request:canceled': EventWithPayload<{ abortedBy?: string; reason: string; request: ApiRequest, }>;
  'api:request:end': EventWithPayload<ApiRequest>;
  'api:request:start': EventWithPayload<ApiRequest>;
  'api:response:cache:hit': EventWithPayload<{ entry: ApiCacheEntry; request: ApiRequest }>;
  'api:response:cache:miss': EventWithPayload<ApiRequest>;
  'api:response:cache:stale': EventWithPayload<{ entry: ApiCacheEntry; request: ApiRequest }>;
  'api:response:error': EventWithPayload<ApiError>;
  'api:response:success': EventWithPayload<ApiResponse>;
  'api:retry:attempt': EventWithPayload<{ attempt: number; delay: number; request: ApiRequest }>;
  'api:retry:failed': EventWithPayload<{ attempt: number; error: ApiError; request: ApiRequest; }>;
}


export interface ApiInterceptor<T = any> {
  id: string;
  onError?: (err: ApiError) => ApiError | false | null | Promise<ApiError>;
  onRequest?: (req: ApiRequest<T>) => ApiRequest<T> | false | null | Promise<ApiRequest<T>>;
  onResponse?: (res: ApiResponse<T>) => ApiResponse<T> | false | null | Promise<ApiResponse<T>>;
  priority?: number;
}

export interface ApiMetrics {
  activeRequests: number;
  cacheHitRatio: number;
  cacheSize: number;
  errorRate: number;
  pendingRequests: number;
  queueLength: number;
  requestCount: number;
  successRate: number;
  timeoutCount: number;
  totalCacheHits: number;
  totalCacheMisses: number;
  totalCacheStales?: number;
  totalErrors: number;
  totalRequests: number;
  totalRetries: number;
  totalSuccess: number;
}

export interface ApiRequest<T = any> {
  _body?: BodyInit;
  abortSignal?: AbortSignal;
  cacheKey?: string;
  cacheOptions?: CacheOptions;
  data?: T;
  headers: Record<string, string>;
  id: string;
  metadata?: Record<string, unknown>;
  method: HttpMethod;
  params?: Record<string, unknown>;
  retryCount?: number;
  timeout?: number;
  timestamp: number;
  url: string;
}

export interface ApiResponse<T = any> {
  cacheTimestamp?: number;
  config: APIConfig;
  data: T;
  duration: number;
  etag?: string;
  fromCache?: boolean;
  headers: Record<string, string>;
  id: string;
  lastModified?: string;
  request: ApiRequest;
  retryCount?: number;
  status: number;
  statusText: string;
  timestamp: number;
}

export interface CacheOptions {
  forceRefresh?: boolean;
  ignoreCache?: boolean;
  revalidateOnStale?: boolean;
  ttl?: number;
}

export interface CacheStrategy {
  generateKey(req: ApiRequest): string;

  getTTL(req: ApiRequest, res: ApiResponse): number;

  shouldCache(req: ApiRequest, res: ApiResponse): boolean;

  shouldInvalidate(key: string, entry: ApiCacheEntry): boolean;

  shouldRevalidate(key: string, entry: ApiCacheEntry, req: ApiRequest): boolean;
}

export interface HttpAdapter {
  send<T>(req: ApiRequest, signal: AbortSignal): Promise<ApiResponse<T>>;
}
