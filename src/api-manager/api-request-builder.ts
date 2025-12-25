import type { APIManager } from './api-manager.ts';
import type { ApiRequest, ApiResponse, CacheOptions, HttpMethod } from './types.ts';

/**
 * ApiRequestBuilder.
 *
 * @author dafengzhen
 */
export class ApiRequestBuilder<T = any> {
  private request: Partial<ApiRequest<T>> = {};

  constructor(private readonly manager: APIManager) {
  }

  build(): ApiRequest<T> {
    return this.manager['buildRequest']({ ...this.request });
  }

  cacheKey(cacheKey: string): this {
    this.request.cacheKey = cacheKey;
    return this;
  }

  cacheOptions(cacheOptions: CacheOptions): this {
    this.request.cacheOptions = cacheOptions;
    return this;
  }

  data(data: T): this {
    this.request.data = data;
    return this;
  }

  async execute<R = any>(): Promise<ApiResponse<R>> {
    return this.manager.request<T, R>({ ...this.request });
  }

  header(key: string, value: string): this {
    this.ensure('headers');
    this.request.headers![key] = value;
    return this;
  }

  headers(headers: Record<string, string>): this {
    this.merge('headers', headers);
    return this;
  }

  metadata(metadata: Record<string, unknown>): this {
    this.merge('metadata', metadata);
    return this;
  }

  method(method: HttpMethod): this {
    this.request.method = method;
    return this;
  }

  param(key: string, value: unknown): this {
    this.ensure('params');
    this.request.params![key] = value;
    return this;
  }

  params(params: Record<string, unknown>): this {
    this.merge('params', params);
    return this;
  }

  retryCount(retryCount: number): this {
    this.request.retryCount = retryCount;
    return this;
  }

  timeout(timeout: number): this {
    this.request.timeout = timeout;
    return this;
  }

  url(url: string): this {
    this.request.url = url;
    return this;
  }

  private ensure<K extends 'headers' | 'metadata' | 'params'>(key: K): void {
    if (!this.request[key]) {
      (this.request as any)[key] = {};
    }
  }

  private merge<K extends 'headers' | 'metadata' | 'params'>(
    key: K,
    value: NonNullable<ApiRequest<T>[K]>
  ): void {
    (this.request as any)[key] = { ...(this.request as any)[key], ...value };
  }
}
