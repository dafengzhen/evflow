import type { ApiCacheEntry, ApiRequest, ApiResponse, CacheStrategy } from './types.ts';

import { HttpMethod } from './types.ts';

/**
 * DefaultCacheStrategy.
 *
 * @author dafengzhen
 */
export class DefaultCacheStrategy implements CacheStrategy {
  constructor(private readonly defaultTTL: number = 5 * 60 * 1000) {
  }

  generateKey(req: ApiRequest): string {
    const { data, headers, method, params, url } = req;

    const cacheableHeaders = new Set(['accept', 'accept-language', 'authorization']);

    const headerPart = Object.entries(headers ?? {})
      .map(([k, v]) => [k.toLowerCase(), v] as const)
      .filter(([k]) => cacheableHeaders.has(k))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');

    const paramsStr = params ? stableStringify(params) : '';
    const dataStr = data ? stableStringify(data) : '';

    const normUrl = normalizeUrl(url);

    return [
      method,
      normUrl,
      paramsStr,
      dataStr,
      headerPart
    ].join('||');
  }

  getTTL(_req: ApiRequest, res: ApiResponse): number {
    const cacheControl = getHeader(res, 'cache-control');

    if (cacheControl) {
      const cc = cacheControl.toLowerCase();

      if (cc.includes('no-store')) {
        return 0;
      }

      if (cc.includes('no-cache')) {
        return 0;
      }

      if (cc.includes('private')) {
        return 0;
      }

      const sMaxAge = parseCacheSeconds(cc, 's-maxage');
      if (sMaxAge != null) {
        return sMaxAge * 1000;
      }

      const maxAge = parseCacheSeconds(cc, 'max-age');
      if (maxAge != null) {
        return maxAge * 1000;
      }
    }

    const expires = getHeader(res, 'expires');
    if (expires) {
      const exp = Date.parse(expires);
      if (!Number.isNaN(exp)) {
        const ttl = exp - Date.now();
        if (ttl > 0) {
          return ttl;
        }
        return 0;
      }
    }

    switch (res.status) {
      case 200:
      case 203:
      case 204:
      case 206:
        return this.defaultTTL;
      case 301:
      case 308:
        return 24 * 60 * 60 * 1000;
      case 302:
      case 307:
        return 5 * 60 * 1000;
      default:
        return 0;
    }
  }

  shouldCache(req: ApiRequest, res: ApiResponse): boolean {
    if (req.method !== HttpMethod.GET) {
      return false;
    }

    const cacheControl = getHeader(res, 'cache-control')?.toLowerCase();
    if (cacheControl) {
      if (cacheControl.includes('no-store')) {
        return false;
      }
      if (cacheControl.includes('no-cache')) {
        return false;
      }
      if (cacheControl.includes('private')) {
        return false;
      }
    }

    const pragma = getHeader(res, 'pragma')?.toLowerCase();
    if (pragma?.includes('no-cache')) {
      return false;
    }

    return !(res.status < 200 || res.status >= 400);
  }

  shouldInvalidate(_key: string, entry: ApiCacheEntry): boolean {
    const now = Date.now();
    const expires = entry.expires ?? 0;
    const swr = entry.staleWhileRevalidate ?? 0;
    return now > expires + swr;
  }

  shouldRevalidate(_key: string, entry: ApiCacheEntry, _req: ApiRequest): boolean {
    const now = Date.now();
    const expires = entry.expires ?? 0;
    const swr = entry.staleWhileRevalidate ?? 0;

    return now > expires && now <= expires + swr;
  }
}

function getHeader(res: ApiResponse, name: string): string | undefined {
  const target = name.toLowerCase();
  const headers = res.headers ?? ({} as Record<string, any>);
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) {
      return String(v);
    }
  }
  return undefined;
}

function normalizeUrl(url: string): string {
  if (url.length > 1 && url.endsWith('/')) {
    return url.slice(0, -1);
  }
  return url;
}

function parseCacheSeconds(cacheControlLower: string, directive: string): null | number {
  const re = new RegExp(`${directive}\\s*=\\s*(\\d+)`, 'i');
  const m = cacheControlLower.match(re);
  if (!m) {
    return null;
  }
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  const t = typeof value;
  if (t !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();

  const body = keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',');

  return `{${body}}`;
}
 