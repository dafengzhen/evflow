import type {
  ApiCacheEntry,
  APIConfig,
  ApiEvents,
  ApiInterceptor,
  ApiMetrics,
  ApiRequest,
  ApiResponse,
  CacheStrategy,
  HttpAdapter,
  PendingItem
} from './types.ts';

import { EventEmitter } from '../core/index.ts';
import { ApiError } from './api-error.ts';
import { ApiRequestBuilder } from './api-request-builder.ts';
import { DefaultCacheStrategy } from './default-cache-strategy.ts';
import { MetricsCollector } from './metrics-collector.ts';
import { RequestQueue } from './request-queue.ts';
import { HttpMethod, RETRY_STATUS_CODES } from './types.ts';

/**
 * APIManager.
 *
 * @author dafengzhen
 */
export class APIManager {
  private readonly adapter: HttpAdapter;

  private readonly cachePolicy: CacheStrategy;

  private readonly cacheStore = new Map<string, ApiCacheEntry>();

  private readonly cleanupHandlers = new Set<() => void>();

  private readonly config: Required<APIConfig>;

  private readonly emitter = new EventEmitter<ApiEvents>();

  private readonly interceptors: ApiInterceptor[] = [];

  private readonly metrics: MetricsCollector;

  private readonly pending = new Map<string, PendingItem>();

  private readonly queue: RequestQueue;

  private readonly revalidating = new Map<string, Promise<void>>();

  constructor(userConfig: APIConfig) {
    this.config = this.mergeConfigs(userConfig);
    this.validateConfig(this.config);

    this.adapter = this.createAdapter(this.config);
    this.queue = new RequestQueue(this.config.concurrentRequests);

    this.cachePolicy = new DefaultCacheStrategy(this.config.defaultCacheTTL);
    this.metrics = new MetricsCollector(this.config.enableMetrics, this.emitter);

    this.setupMetricsCollection();
  }

  abort(requestId: string, reason = 'User cancelled'): boolean {
    const item = this.pending.get(requestId);
    if (!item) {
      return false;
    }

    this.markCanceled(item, 'user', reason, { abortController: true });
    return true;
  }

  abortAll(reason = 'User cancelled'): void {
    for (const item of this.pending.values()) {
      this.markCanceled(item, 'user', reason, { abortController: true });
    }
  }

  clearCache(): void {
    this.cacheStore.clear();
    this.metrics.updateCacheSize(0);
    void this.emitter.emit('api:cache:clear', undefined);
  }

  createRequest<T = any>(): ApiRequestBuilder<T> {
    return new ApiRequestBuilder<T>(this);
  }

  async delete<T = any>(
    url: string,
    params?: Record<string, unknown>,
    options?: Partial<ApiRequest>
  ): Promise<ApiResponse<T>> {
    return this.request({ method: HttpMethod.DELETE, params, url, ...options });
  }

  destroy(): void {
    this.abortAll();
    this.clearCache();

    for (const cleanup of this.cleanupHandlers) {
      cleanup();
    }
    this.cleanupHandlers.clear();
  }

  async get<T = any>(url: string, params?: Record<string, unknown>, options?: Partial<ApiRequest>): Promise<ApiResponse<T>> {
    return this.request({ method: HttpMethod.GET, params, url, ...options });
  }

  getCacheStats(): { entries: Array<{ expires: number; key: string }>; size: number } {
    const entries = Array.from(this.cacheStore.entries()).map(([key, entry]) => ({ expires: entry.expires, key }));
    return { entries, size: this.cacheStore.size };
  }

  getMetrics(): ApiMetrics {
    return this.metrics.getMetrics();
  }

  invalidateCache(key?: string): void {
    if (key) {
      const entry = this.cacheStore.get(key);
      if (entry) {
        void this.emitter.emit('api:cache:invalidated', { entry, key });
      }
      this.removeCacheEntry(key);
      return;
    }

    for (const [k, entry] of this.cacheStore.entries()) {
      if (!this.cachePolicy.shouldInvalidate(k, entry)) {
        continue;
      }
      this.cacheStore.delete(k);
      void this.emitter.emit('api:cache:expired', { entry, key: k });
    }
    this.metrics.updateCacheSize(this.cacheStore.size);
  }

  off<K extends keyof ApiEvents>(event: K, fn: (p: ApiEvents[K]) => void): void {
    this.emitter.off(event as string, fn as any);
  }

  on<K extends keyof ApiEvents>(event: K, fn: (p: ApiEvents[K]) => void): () => void {
    return this.emitter.on(event as string, fn as any);
  }

  async patch<T = any>(url: string, data?: any, options?: Partial<ApiRequest>): Promise<ApiResponse<T>> {
    return this.request({ data, method: HttpMethod.PATCH, url, ...options });
  }

  async post<T = any>(url: string, data?: any, options?: Partial<ApiRequest>): Promise<ApiResponse<T>> {
    return this.request({ data, method: HttpMethod.POST, url, ...options });
  }

  async put<T = any>(url: string, data?: any, options?: Partial<ApiRequest>): Promise<ApiResponse<T>> {
    return this.request({ data, method: HttpMethod.PUT, url, ...options });
  }

  async request<TReq = any, TRes = any>(reqInit: Partial<ApiRequest<TReq>>): Promise<ApiResponse<TRes>> {
    const request = this.prepareRequest(reqInit);

    const cached = await this.tryServeFromCache<TRes>(request);
    if (cached) {
      return cached;
    }

    if (!request.metadata?.isRevalidate) {
      this.metrics.recordRequestStart();
    }

    return this.runWithRetries<TReq, TRes>(request);
  }

  use(interceptor: ApiInterceptor): () => void {
    this.interceptors.push(interceptor);
    this.interceptors.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    const cleanup = () => {
      const idx = this.interceptors.findIndex(i => i.id === interceptor.id);
      if (idx >= 0) {
        this.interceptors.splice(idx, 1);
      }
      this.cleanupHandlers.delete(cleanup);
    };

    this.cleanupHandlers.add(cleanup);
    return cleanup;
  }

  private applyErrorInterceptors(error: ApiError): ApiError {
    for (const interceptor of [...this.interceptors].reverse()) {
      interceptor.onError?.(error);
    }
    return error;
  }

  private applyRequestInterceptors(request: ApiRequest): ApiRequest {
    for (const interceptor of this.interceptors) {
      interceptor.onRequest?.(request);
    }
    return request;
  }

  private applyResponseInterceptors(response: ApiResponse): ApiResponse {
    for (const interceptor of this.interceptors) {
      interceptor.onResponse?.(response);
    }
    return response;
  }

  private buildFullURL<T>(request: ApiRequest<T>): string {
    const base = request.url.startsWith('http') ? '' : this.config.baseURL;
    const url = new URL(request.url, base);

    for (const [key, value] of Object.entries(request.params!)) {
      if (value === null || value === undefined) {
        continue;
      }

      if (Array.isArray(value)) {
        value.forEach(v => url.searchParams.append(key, String(v)));
      } else if (typeof value === 'object') {
        url.searchParams.set(key, JSON.stringify(value));
      } else {
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }

  private buildRequest<T>(reqInit: Partial<ApiRequest<T>>): ApiRequest<T> {
    const now = Date.now();

    const request: ApiRequest<T> = {
      cacheOptions: reqInit.cacheOptions,
      data: reqInit.data,
      headers: { ...this.config.defaultHeaders, ...reqInit.headers },
      id: this.generateRequestId(),
      metadata: { ...reqInit.metadata, createdAt: now },
      method: reqInit.method ?? HttpMethod.GET,
      params: reqInit.params ?? {},
      retryCount: reqInit.retryCount ?? 0,
      timeout: reqInit.timeout ?? this.config.timeout,
      timestamp: now,
      url: reqInit.url ?? ''
    };

    this.finalizeRequest(request);
    return request;
  }

  private buildRequestBody<T>(request: ApiRequest<T>): BodyInit | undefined {
    const data: any = request.data;
    if (data === undefined || data === null) {
      return undefined;
    }

    const contentType = request.headers['content-type'];

    if (
      data instanceof FormData ||
      data instanceof URLSearchParams ||
      data instanceof Blob ||
      data instanceof ArrayBuffer ||
      typeof data === 'string'
    ) {
      return data;
    }

    if (contentType?.includes('application/x-www-form-urlencoded')) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(data as Record<string, any>)) {
        if (v !== undefined && v !== null) {
          params.append(k, String(v));
        }
      }
      return params;
    }

    if (!contentType) {
      request.headers['content-type'] = 'application/json';
    }

    if (request.headers['content-type']?.includes('application/json')) {
      return JSON.stringify(data);
    }

    return String(data);
  }

  private async cacheIfNeeded(req: ApiRequest, res: ApiResponse): Promise<void> {
    if (!this.shouldCacheResponse(req, res)) {
      return;
    }

    const key = req.cacheKey ?? this.cachePolicy.generateKey(req);
    const ttl = req.cacheOptions?.ttl ?? this.cachePolicy.getTTL(req, res);
    if (ttl <= 0) {
      return;
    }

    const now = Date.now();
    const staleWhileRevalidate = this.parseStaleWhileRevalidateMs(res.headers['cache-control']);

    const entry: ApiCacheEntry = {
      data: res.data,
      etag: res.etag,
      expires: now + ttl,
      headers: res.headers,
      lastModified: res.lastModified,
      staleWhileRevalidate,
      timestamp: now
    };

    this.cacheStore.set(key, entry);
    this.metrics.updateCacheSize(this.cacheStore.size);
    void this.emitter.emit('api:cache:set', { entry, key });
  }

  private combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
    const valid = signals.filter(Boolean) as AbortSignal[];
    if (valid.length === 0) {
      return undefined;
    }
    if (valid.length === 1) {
      return valid[0];
    }

    const anyFn = (AbortSignal as any)?.any;
    if (typeof anyFn === 'function') {
      return anyFn(valid);
    }

    const c = new AbortController();
    const onAbort = () => c.abort();

    for (const s of valid) {
      s.addEventListener('abort', onAbort, { once: true });
    }

    c.signal.addEventListener(
      'abort',
      () => {
        for (const s of valid) {
          s.removeEventListener('abort', onAbort);
        }
      },
      { once: true }
    );

    return c.signal;
  }

  private createAdapter(config: APIConfig): HttpAdapter {
    if (typeof config.adapter === 'function') {
      return config.adapter(config);
    }
    return config.adapter;
  }

  private createCachedResponse<T>(request: ApiRequest, entry: ApiCacheEntry): ApiResponse<T> {
    return {
      cacheTimestamp: entry.timestamp,
      config: this.config,
      data: entry.data as T,
      duration: 0,
      etag: entry.etag,
      fromCache: true,
      headers: entry.headers,
      id: request.id,
      lastModified: entry.lastModified,
      request,
      status: 200,
      statusText: 'OK (cache)',
      timestamp: Date.now()
    };
  }

  private emitCacheHit(entry: ApiCacheEntry, request: ApiRequest): void {
    this.metrics.recordCacheHit();
    void this.emitter.emit('api:response:cache:hit', { entry, request });
  }

  private emitCacheMiss(request: ApiRequest): void {
    this.metrics.recordCacheMiss();
    void this.emitter.emit('api:response:cache:miss', request);
  }

  private emitCanceledOnce(item: PendingItem): void {
    if (item.canceledEmitted) {
      return;
    }

    item.canceledEmitted = true;
    void this.emitter.emit('api:request:canceled', {
      abortedBy: item.abortedBy ?? 'external',
      reason: item.cancelReason ?? 'Canceled',
      request: item.request
    });
  }

  private ensureRevalidate(key: string, request: ApiRequest): void {
    if (this.revalidating.has(key)) {
      return;
    }

    const revalidateReq: ApiRequest = {
      ...request,
      abortSignal: undefined,
      cacheOptions: { ...request.cacheOptions, forceRefresh: true },
      id: this.generateRequestId(),
      metadata: { ...request.metadata, createdAt: Date.now(), isRevalidate: true },
      retryCount: 0,
      timestamp: Date.now()
    };

    const p = this.runWithRetries<any, any>(revalidateReq)
      .then(() => void 0)
      .catch(() => void 0)
      .finally(() => {
        this.revalidating.delete(key);
      });

    this.revalidating.set(key, p);
  }

  private finalizeRequest<T>(request: ApiRequest<T>): void {
    request.url = this.buildFullURL(request);
    request.headers = this.normalizeHeaders(request.headers);
    request._body = this.buildRequestBody(request);
    request.cacheKey = request.cacheKey ?? this.cachePolicy.generateKey(request);
  }

  private generateRequestId(): string {
    if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) {
      return (crypto as any).randomUUID();
    }

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  private getRetryDelayMs(retryCount: number): number {
    const base = this.config.retryDelay * Math.pow(2, retryCount - 1);
    const jitter = base * this.config.retryDelayJitter * (Math.random() * 2 - 1);
    return Math.max(0, base + jitter);
  }

  private isEntryStale(entry: ApiCacheEntry): boolean {
    const now = Date.now();
    return now > entry.expires && now <= entry.expires + (entry.staleWhileRevalidate || 0);
  }

  private makeTimeoutSignal(timeoutMs: number): AbortSignal {
    const hasTimeout = typeof (AbortSignal as any)?.timeout === 'function';
    if (hasTimeout) {
      return (AbortSignal as any).timeout(timeoutMs);
    }

    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    c.signal.addEventListener('abort', () => clearTimeout(t), { once: true });
    return c.signal;
  }

  private markCanceled(
    item: PendingItem,
    abortedBy: 'external' | 'user',
    reason: string,
    opts?: { abortController?: boolean; emitIfStarted?: boolean }
  ): void {
    if (item.abortedBy) {
      return;
    }

    item.abortedBy = abortedBy;
    item.cancelReason = reason;

    const abortController = opts?.abortController ?? false;
    const emitIfStarted = opts?.emitIfStarted ?? true;

    if (abortController) {
      item.controller.abort();
    }

    if (emitIfStarted && item.startEmitted) {
      this.emitCanceledOnce(item);
    }
  }

  private mergeConfigs(userConfig: APIConfig): Required<APIConfig> {
    const defaults: Required<Omit<APIConfig, 'adapter'> & { validateStatus: (status: number) => boolean }> = {
      baseURL: '',
      concurrentRequests: 10,
      defaultCacheTTL: 5 * 60 * 1000,
      defaultHeaders: {
        accept: 'application/json',
        'content-type': 'application/json'
      },
      enableCache: true,
      enableMetrics: false,
      maxRetries: 3,
      retryDelay: 1000,
      retryDelayJitter: 0.3,
      timeout: 30000,
      validateStatus: status => status >= 200 && status < 300
    };

    const base = { ...defaults, defaultHeaders: { ...defaults.defaultHeaders } };

    return {
      ...base,
      ...userConfig,
      defaultHeaders: { ...base.defaultHeaders, ...userConfig.defaultHeaders }
    } as Required<APIConfig>;
  }

  private normalizeHeaders(headers: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (v !== undefined && v !== null) {
        out[k.toLowerCase()] = String(v);
      }
    }
    return out;
  }

  private parseStaleWhileRevalidateMs(cacheControl?: string): number | undefined {
    if (!cacheControl) {
      return undefined;
    }
    const m = cacheControl.match(/stale-while-revalidate=(\d+)/);
    if (!m) {
      return undefined;
    }
    return parseInt(m[1], 10) * 1000;
  }

  private prepareRequest<T>(reqInit: Partial<ApiRequest<T>>): ApiRequest<T> {
    return this.applyRequestInterceptors(this.buildRequest(reqInit));
  }

  private registerPending(request: ApiRequest, controller: AbortController): void {
    const item: PendingItem = {
      canceledEmitted: false,
      cleanupAbortBindings: () => {
      },
      controller,
      request,
      startEmitted: false
    };

    this.pending.set(request.id, item);
    this.metrics.updatePendingRequests(this.pending.size);

    const external = request.abortSignal;
    if (!external) {
      return;
    }

    const externalAbort = () => {
      this.markCanceled(item, 'external', 'External abort', { abortController: true });
    };

    if (external.aborted) {
      externalAbort();
      return;
    }

    external.addEventListener('abort', externalAbort, { once: true });
    item.cleanupAbortBindings = () => external.removeEventListener('abort', externalAbort);
  }

  private removeCacheEntry(key: string): void {
    this.cacheStore.delete(key);
    this.metrics.updateCacheSize(this.cacheStore.size);
  }

  private async runOnce<TReq, TRes>(request: ApiRequest<TReq>): Promise<ApiResponse<TRes>> {
    const controller = new AbortController();
    this.registerPending(request, controller);

    let acquired = false;

    try {
      await this.queue.acquire(controller.signal);
      acquired = true;

      if (!request.metadata?.isRevalidate) {
        this.metrics.recordActiveRequest();
      }
      this.metrics.updateQueueLength(this.queue.getQueueLength());

      const item = this.pending.get(request.id);
      if (item) {
        item.startEmitted = true;
      }

      void this.emitter.emit('api:request:start', request);

      if (item?.abortedBy && !item.canceledEmitted) {
        item.controller.abort();
        this.emitCanceledOnce(item);
        throw new ApiError({ code: 'CANCELED', request });
      }

      const response = await this.sendAndProcess<TRes>(request, controller);

      if (!request.metadata?.isRevalidate) {
        this.metrics.recordSuccess();
      }
      void this.emitter.emit('api:response:success', response);

      await this.cacheIfNeeded(request, response);
      return response;
    } catch (e) {
      let finalErr: ApiError = e instanceof ApiError ? e : new ApiError({ cause: e, code: 'NETWORK_ERROR', request });

      const aborted = controller.signal.aborted;
      const isTimeout = finalErr.code === 'TIMEOUT';

      if (!isTimeout && aborted) {
        finalErr = new ApiError({ code: 'CANCELED', request });
      }

      const isCanceled = finalErr.code === 'CANCELED';

      if (isTimeout) {
        this.metrics.recordTimeout();
      } else if (!isCanceled) {
        if (!request.metadata?.isRevalidate) {
          this.metrics.recordError();
        }
      }

      if (!isCanceled) {
        finalErr = this.applyErrorInterceptors(finalErr);
        void this.emitter.emit('api:response:error', finalErr);
      }

      throw finalErr;
    } finally {
      if (acquired) {
        this.queue.release();
        if (!request.metadata?.isRevalidate) {
          this.metrics.recordActiveRequestEnd();
        }
      }

      this.unregisterPending(request.id);
      this.metrics.updateQueueLength(this.queue.getQueueLength());
      void this.emitter.emit('api:request:end', request);
    }
  }

  private async runWithRetries<TReq, TRes>(request: ApiRequest<TReq>): Promise<ApiResponse<TRes>> {
    while (true) {
      try {
        return await this.runOnce<TReq, TRes>(request);
      } catch (e) {
        const error = e as ApiError;
        if (!this.shouldRetry(request, error)) {
          throw error;
        }

        request.retryCount = (request.retryCount ?? 0) + 1;

        const delayMs = this.getRetryDelayMs(request.retryCount);
        this.metrics.recordRetry();
        void this.emitter.emit('api:retry:attempt', { attempt: request.retryCount, delay: delayMs, request });
        await this.sleep(delayMs);
      }
    }
  }

  private async sendAndProcess<T>(request: ApiRequest, controller: AbortController): Promise<ApiResponse<T>> {
    const timeoutSignal = this.makeTimeoutSignal(request.timeout!);
    const combined = this.combineSignals(controller.signal, timeoutSignal)!;

    try {
      const rawResponse = await this.adapter.send<T>(request, combined);
      const response: ApiResponse<T> = { ...rawResponse };

      this.applyResponseInterceptors(response);

      if (!this.config.validateStatus(response.status)) {
        throw new ApiError({
          code: `HTTP_${response.status}`,
          request,
          response,
          status: response.status
        });
      }

      return response;
    } catch (e) {
      if (timeoutSignal.aborted) {
        const item = this.pending.get(request.id);
        if (item && !item.abortedBy) {
          item.abortedBy = 'timeout';
        }
        throw new ApiError({ code: 'TIMEOUT', request });
      }

      if (controller.signal.aborted) {
        throw new ApiError({ code: 'CANCELED', request });
      }

      throw e;
    }
  }

  private setupMetricsCollection(): void {
    if (!this.config.enableMetrics) {
      return;
    }

    const intervalId = setInterval(() => {
      const metrics = this.metrics.getMetrics();
      void this.emitter.emit('api:metrics:collect', metrics);
    }, 30000);

    this.cleanupHandlers.add(() => clearInterval(intervalId));
  }

  private shouldCacheResponse(req: ApiRequest, res: ApiResponse): boolean {
    if (!this.config.enableCache) {
      return false;
    }
    if (req.method !== HttpMethod.GET) {
      return false;
    }
    if (req.cacheOptions?.ignoreCache) {
      return false;
    }
    if (!this.cachePolicy.shouldCache(req, res)) {
      return false;
    }
    if (res.status < 200 || res.status >= 300) {
      return false;
    }

    const cc = res.headers['cache-control'];
    return !(cc?.includes('no-store') || cc?.includes('no-cache'));
  }

  private shouldCheckCache(request: ApiRequest): boolean {
    if (!this.config.enableCache) {
      return false;
    }
    if (request.method !== HttpMethod.GET) {
      return false;
    }
    if (request.cacheOptions?.ignoreCache) {
      return false;
    }
    return !request.cacheOptions?.forceRefresh;
  }

  private shouldRetry(req: ApiRequest, err: ApiError): boolean {
    if ((req.retryCount ?? 0) >= this.config.maxRetries) {
      return false;
    }
    if (err.code === 'TIMEOUT') {
      return true;
    }

    if (err.status && RETRY_STATUS_CODES.includes(err.status as 408 | 429 | 500 | 502 | 503 | 504)) {
      return true;
    }

    return !err.status && err.code === 'NETWORK_ERROR';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
  }

  private async tryServeFromCache<T>(request: ApiRequest): Promise<ApiResponse<T> | null> {
    if (!this.shouldCheckCache(request)) {
      this.emitCacheMiss(request);
      return null;
    }

    const key = request.cacheKey!;
    const entry = this.cacheStore.get(key);

    if (!entry) {
      this.emitCacheMiss(request);
      return null;
    }

    if (this.cachePolicy.shouldInvalidate(key, entry)) {
      this.removeCacheEntry(key);
      void this.emitter.emit('api:cache:expired', { entry, key });
      this.emitCacheMiss(request);
      return null;
    }

    if (this.isEntryStale(entry)) {
      this.metrics.recordCacheStale();
      void this.emitter.emit('api:response:cache:stale', { entry, request });
      void this.emitter.emit('api:cache:stale', { entry, key });

      const revalidate = request.cacheOptions?.revalidateOnStale !== false;
      if (revalidate && this.cachePolicy.shouldRevalidate(key, entry, request)) {
        this.ensureRevalidate(key, request);
      }
    }

    this.emitCacheHit(entry, request);
    return this.createCachedResponse(request, entry);
  }

  private unregisterPending(requestId: string): void {
    const item = this.pending.get(requestId);
    if (!item) {
      return;
    }

    item.cleanupAbortBindings();
    this.pending.delete(requestId);
    this.metrics.updatePendingRequests(this.pending.size);
  }

  private validateConfig(config: Required<APIConfig>): void {
    if (!config.adapter) {
      throw new Error('Adapter is required');
    }
    if (config.concurrentRequests <= 0) {
      throw new Error('concurrentRequests must be greater than 0');
    }
    if (config.timeout <= 0) {
      throw new Error('timeout must be greater than 0');
    }
    if (config.maxRetries < 0) {
      throw new Error('maxRetries must be non-negative');
    }
    if (config.retryDelayJitter && (config.retryDelayJitter < 0 || config.retryDelayJitter > 1)) {
      throw new Error('retryDelayJitter must be between 0 and 1');
    }
  }
}
