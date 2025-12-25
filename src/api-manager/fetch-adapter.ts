import type { APIConfig, ApiRequest, ApiResponse, HttpAdapter } from './types.ts';

import { ApiError } from './api-error.ts';
import { HttpMethod } from './types.ts';

/**
 * FetchAdapter.
 *
 * @author dafengzhen
 */
export class FetchAdapter implements HttpAdapter {
  constructor(private readonly config: APIConfig) {
  }

  async send<T>(req: ApiRequest, signal: AbortSignal): Promise<ApiResponse<T>> {
    const start = performance.now();

    try {
      const fetchOptions = this.buildRequestInit(req, signal);

      const response = await fetch(req.url, fetchOptions);
      const duration = performance.now() - start;

      const headers = this.extractHeaders(response);
      const data = await this.parseResponse<T>(response, headers);

      return {
        config: this.config,
        data,
        duration,
        etag: headers['etag'],
        headers,
        id: req.id,
        lastModified: headers['last-modified'],
        request: req,
        retryCount: req.retryCount,
        status: response.status,
        statusText: response.statusText,
        timestamp: Date.now()
      };
    } catch (error: unknown) {
      throw this.wrapError(error, req);
    }
  }

  private buildRequestInit(req: ApiRequest, signal: AbortSignal): RequestInit {
    const method = req.method;
    const headers = this.normalizeHeaders(req.headers);

    const init: RequestInit = {
      cache: 'no-store',
      headers,
      method,
      signal
    };

    if (method !== HttpMethod.GET && method !== HttpMethod.HEAD && req._body !== undefined) {
      if (this.isPlainObject(req._body) && !this.hasHeader(headers, 'content-type')) {
        this.setHeader(headers, 'content-type', 'application/json; charset=utf-8');
        init.body = JSON.stringify(req._body);
      } else {
        init.body = req._body as any;
      }
    }

    return init;
  }

  private extractHeaders(response: Response): Record<string, string> {
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return headers;
  }

  private hasHeader(headers: Headers, key: string): boolean {
    return headers.has(key);
  }

  private isPlainObject(val: unknown): val is Record<string, unknown> {
    if (val === null || typeof val !== 'object') {
      return false;
    }
    const proto = Object.getPrototypeOf(val);
    return proto === Object.prototype || proto === null;
  }

  private normalizeHeaders(input: HeadersInit | undefined): Headers {
    if (input instanceof Headers) {
      return new Headers(input);
    }
    return new Headers(input ?? {});
  }

  private async parseResponse<T>(response: Response, headers: Record<string, string>): Promise<T> {
    if (response.status === 204 || response.status === 205) {
      return undefined as any;
    }

    if (response.status === 304) {
      return undefined as any;
    }

    const contentType = (headers['content-type'] || '').toLowerCase();

    if (contentType.includes('application/json') || /\+json\b/i.test(contentType)) {
      const text = await response.text();
      if (!text) {
        return undefined as any;
      }

      try {
        return JSON.parse(text) as T;
      } catch {
        return text as any;
      }
    }

    if (contentType.startsWith('text/')) {
      return (await response.text()) as any;
    }

    if (contentType.startsWith('multipart/')) {
      return (await response.formData()) as any;
    }

    try {
      return (await response.blob()) as any;
    } catch {
      const cloned = response.clone();
      return (await cloned.arrayBuffer()) as any;
    }
  }

  private setHeader(headers: Headers, key: string, value: string): void {
    headers.set(key, value);
  }

  private wrapError(error: unknown, req: ApiRequest): ApiError {
    const err = error as any;

    const isAbort =
      err?.name === 'AbortError' ||
      err?.code === 20;

    const isNetwork = err?.name === 'TypeError';

    const apiError = new ApiError({
      cause: error,
      code: isAbort ? 'ABORTED' : isNetwork ? 'NETWORK_ERROR' : '',
      request: req
    });

    if (isAbort) {
      apiError.message = 'Request aborted';
    } else if (apiError.code === 'NETWORK_ERROR') {
      apiError.message = 'Network error';
    }

    return apiError;
  }
}
 