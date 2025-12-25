import type { APIConfig, ApiRequest, ApiResponse, HttpAdapter } from './types.ts';

import { ApiError } from './api-error.ts';
import { HttpMethod } from './types.ts';

/**
 * XHRAdapter
 *
 * @author dafengzhen
 */
export class XHRAdapter implements HttpAdapter {
  constructor(private readonly config: APIConfig) {
  }

  send<T>(req: ApiRequest, signal: AbortSignal): Promise<ApiResponse<T>> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(this.createAbortError(req));
        return;
      }

      const xhr = new XMLHttpRequest();
      const startTime = performance.now();
      const timeout = req.timeout ?? this.config.timeout ?? 30000;

      const cleanup = () => {
        signal.removeEventListener('abort', onAbort);
      };

      const onAbort = () => {
        xhr.abort();
        cleanup();
        reject(this.createAbortError(req));
      };

      signal.addEventListener('abort', onAbort, { once: true });

      xhr.open(req.method, req.url, true);
      xhr.responseType = 'text';
      xhr.timeout = timeout;

      this.applyHeaders(xhr, req.headers);

      xhr.onload = () => {
        cleanup();

        if (xhr.status === 0) {
          reject(this.createNetworkError(req));
          return;
        }

        const response = this.buildResponse<T>(xhr, req, startTime);

        if (xhr.status < 200 || xhr.status >= 300) {
          reject(
            new ApiError({
              code: `HTTP_${xhr.status}`,
              request: req,
              response,
              status: xhr.status
            })
          );
          return;
        }

        resolve(response);
      };

      xhr.onerror = () => {
        cleanup();
        reject(this.createNetworkError(req));
      };

      xhr.ontimeout = () => {
        cleanup();
        reject(
          new ApiError({
            code: 'TIMEOUT',
            request: req
          })
        );
      };

      try {
        xhr.send(this.resolveBody(req));
      } catch (error) {
        cleanup();
        reject(
          new ApiError({
            cause: error,
            code: 'REQUEST_SEND_FAILED',
            request: req
          })
        );
      }
    });
  }

  private applyHeaders(xhr: XMLHttpRequest, headers?: Record<string, unknown>) {
    if (!headers) {
      return;
    }

    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined && value !== null && value !== '') {
        xhr.setRequestHeader(key, String(value));
      }
    }
  }

  private buildResponse<T>(
    xhr: XMLHttpRequest,
    req: ApiRequest,
    startTime: number
  ): ApiResponse<T> {
    const headers = this.parseHeaders(xhr.getAllResponseHeaders());

    return {
      config: this.config,
      data: this.parseResponse<T>(xhr, headers),
      duration: performance.now() - startTime,
      etag: headers['etag'],
      headers,
      id: req.id,
      lastModified: headers['last-modified'],
      request: req,
      retryCount: req.retryCount,
      status: xhr.status,
      statusText: xhr.statusText,
      timestamp: Date.now()
    };
  }

  private createAbortError(req: ApiRequest) {
    return new ApiError({
      code: 'REQUEST_ABORTED',
      request: req
    });
  }

  private createNetworkError(req: ApiRequest) {
    return new ApiError({
      code: 'NETWORK_ERROR',
      request: req
    });
  }

  private parseHeaders(raw: string): Record<string, string> {
    const headers: Record<string, string> = {};
    if (!raw) {
      return headers;
    }

    raw
      .trim()
      .split(/[\r\n]+/)
      .forEach(line => {
        const index = line.indexOf(':');
        if (index > -1) {
          const key = line.slice(0, index).trim().toLowerCase();
          headers[key] = line.slice(index + 1).trim();
        }
      });

    return headers;
  }

  private parseResponse<T>(
    xhr: XMLHttpRequest,
    headers: Record<string, string>
  ): T {
    const contentType = headers['content-type']?.toLowerCase() ?? '';
    const text = xhr.responseText ?? '';

    if (contentType.includes('json')) {
      if (!text) {
        return undefined as any;
      }
      try {
        return JSON.parse(text);
      } catch {
        return text as any;
      }
    }

    if (contentType.startsWith('text/')) {
      return text as any;
    }

    return (xhr.response as any) ?? (text as any);
  }

  private resolveBody(req: ApiRequest): null | XMLHttpRequestBodyInit {
    if (req.method === HttpMethod.GET || req.method === HttpMethod.HEAD) {
      return null;
    }
    return (req._body ?? null) as null | XMLHttpRequestBodyInit;
  }
}
 