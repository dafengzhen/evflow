import type { EventEmitter } from '../core/index.ts';
import type { ApiEvents, ApiMetrics } from './types.ts';

/**
 * MetricsCollector.
 *
 * @author dafengzhen
 */
export class MetricsCollector {
  private metrics: ApiMetrics = MetricsCollector.createInitialMetrics();

  constructor(
    private readonly enabled: boolean,
    private readonly emitter: EventEmitter<ApiEvents>
  ) {
  }

  private static createInitialMetrics(): ApiMetrics {
    return {
      activeRequests: 0,
      cacheHitRatio: 0,
      cacheSize: 0,
      errorRate: 0,
      pendingRequests: 0,
      queueLength: 0,
      requestCount: 0,
      successRate: 0,
      timeoutCount: 0,
      totalCacheHits: 0,
      totalCacheMisses: 0,
      totalCacheStales: 0,
      totalErrors: 0,
      totalRequests: 0,
      totalRetries: 0,
      totalSuccess: 0
    };
  }

  getMetrics(): ApiMetrics {
    return typeof structuredClone === 'function'
      ? structuredClone(this.metrics)
      : { ...this.metrics };
  }

  recordActiveRequest(): void {
    if (!this.guard()) {
      return;
    }
    this.metrics.activeRequests++;
  }

  recordActiveRequestEnd(): void {
    if (!this.guard()) {
      return;
    }
    this.metrics.activeRequests = Math.max(0, this.metrics.activeRequests - 1);
  }

  recordCacheHit(): void {
    if (!this.guard()) {
      return;
    }
    this.metrics.totalCacheHits++;
    this.updateCacheRatio();
  }

  recordCacheMiss(): void {
    if (!this.guard()) {
      return;
    }
    this.metrics.totalCacheMisses++;
    this.updateCacheRatio();
  }

  recordCacheStale(): void {
    if (!this.guard()) {
      return;
    }
    this.metrics.totalCacheStales!++;
    this.updateCacheRatio();
  }

  recordError(): void {
    if (!this.guard()) {
      return;
    }
    this.metrics.totalErrors++;
    this.updateRatios();
  }

  recordRequestStart(): void {
    if (!this.guard()) {
      return;
    }
    this.metrics.totalRequests++;
    this.metrics.requestCount++;
  }

  recordRetry(): void {
    if (!this.guard()) {
      return;
    }
    this.metrics.totalRetries++;
  }

  recordSuccess(): void {
    if (!this.guard()) {
      return;
    }
    this.metrics.totalSuccess++;
    this.updateRatios();
  }

  recordTimeout(): void {
    if (!this.guard()) {
      return;
    }
    this.metrics.timeoutCount++;
    this.recordError();
  }

  reset(): void {
    if (!this.guard()) {
      return;
    }
    this.metrics = MetricsCollector.createInitialMetrics();
  }

  updateCacheSize(size: number): void {
    if (!this.guard()) {
      return;
    }
    this.metrics.cacheSize = size;
  }

  updatePendingRequests(count: number): void {
    if (!this.guard()) {
      return;
    }
    this.metrics.pendingRequests = count;
  }

  updateQueueLength(length: number): void {
    if (!this.guard()) {
      return;
    }
    this.metrics.queueLength = length;
  }

  private guard(): boolean {
    return this.enabled;
  }

  private updateCacheRatio(): void {
    const total =
      this.metrics.totalCacheHits +
      this.metrics.totalCacheMisses +
      this.metrics.totalCacheStales!;

    this.metrics.cacheHitRatio = total === 0 ? 0 : this.metrics.totalCacheHits / total;
  }

  private updateRatios(): void {
    const done = this.metrics.totalSuccess + this.metrics.totalErrors;
    this.metrics.successRate = done === 0 ? 0 : this.metrics.totalSuccess / done;
    this.metrics.errorRate = done === 0 ? 0 : this.metrics.totalErrors / done;
  }
}
