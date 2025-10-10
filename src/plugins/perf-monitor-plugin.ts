import type { EventBusPlugin, EventMiddleware, IEventBus, PlainObject } from '../types/types.ts';

export interface PerfMetrics {
  avgMs: null | number;
  count: number;
  eventName: string;
  failure: number;
  lastSample?: PerfSample;
  maxMs: null | number;
  minMs: null | number;
  samplesCounted: number;
  success: number;
  totalTimeMs: number;
}

export interface PerfMonitorOptions {
  includeFailedInStats?: boolean;
  maxSamplesPerEvent?: number;
  onReport?: (metrics: PerfMetrics[]) => void;
  reportIntervalMs?: number;
}

export interface PerfSample {
  durationMs: number;
  errorMessage?: string;
  eventName?: string;
  succeeded: boolean;
  timestamp: number;
}

interface EventStats {
  count: number;
  failure: number;
  lastSample?: PerfSample;
  maxMs: null | number;
  minMs: null | number;
  samplesCounted: number;
  success: number;
  totalTimeMs: number;
}

const DEFAULT_MAX_SAMPLES = 500;

const DEFAULT_INCLUDE_FAILED = true;

const INITIAL_STATS: EventStats = Object.freeze({
  count: 0,
  failure: 0,
  lastSample: undefined,
  maxMs: null,
  minMs: null,
  samplesCounted: 0,
  success: 0,
  totalTimeMs: 0,
});

const getCurrentTime = (): number => performance.now?.() ?? Date.now();

/**
 * PerfMonitorPlugin.
 *
 * @author dafengzhen
 */
export class PerfMonitorPlugin<
  EM extends Record<string, PlainObject> = Record<string, any>,
  GC extends PlainObject = PlainObject,
> implements EventBusPlugin<EM, GC>
{
  private readonly eventStats = new Map<string, EventStats>();

  private readonly includeFailed: boolean;

  private readonly maxSamplesPerEvent: number;

  private readonly onReport?: (metrics: PerfMetrics[]) => void;

  private readonly reportIntervalMs?: number;

  private reportTimer?: ReturnType<typeof setInterval>;

  private readonly samples = new Map<string, number[]>();

  private uninstallMiddlewareFn?: () => void;

  constructor(options: PerfMonitorOptions = {}) {
    this.maxSamplesPerEvent = options.maxSamplesPerEvent ?? DEFAULT_MAX_SAMPLES;
    this.includeFailed = options.includeFailedInStats ?? DEFAULT_INCLUDE_FAILED;
    this.reportIntervalMs = options.reportIntervalMs;
    this.onReport = options.onReport;
  }

  public getMetrics(eventName?: string): PerfMetrics[] {
    return eventName
      ? [this.computeMetrics(eventName)]
      : Array.from(this.getAllEventNames(), (name) => this.computeMetrics(name));
  }

  public getPercentile(eventName: string, percentile: number): null | number {
    return this.calculatePercentile(eventName, percentile);
  }

  install(bus: IEventBus<EM, GC>): void {
    this.uninstallMiddlewareFn = bus.useGlobalMiddleware(this.createMonitoringMiddleware(), { priority: 0 });
    this.setupReporting();
  }

  public reset(eventName?: string): void {
    if (eventName) {
      this.samples.delete(eventName);
      this.eventStats.delete(eventName);
    } else {
      this.samples.clear();
      this.eventStats.clear();
    }
  }

  public snapshotReport(): {
    metrics: PerfMetrics[];
    percentiles: Record<string, { p50: null | number; p95: null | number; p99: null | number }>;
  } {
    const metrics = this.getMetrics();
    const percentiles = Object.create(null);

    for (const metric of metrics) {
      percentiles[metric.eventName] = {
        p50: this.calculatePercentile(metric.eventName, 50),
        p95: this.calculatePercentile(metric.eventName, 95),
        p99: this.calculatePercentile(metric.eventName, 99),
      };
    }

    return { metrics, percentiles };
  }

  uninstall(): void {
    this.cleanupMiddleware();
    this.cleanupReporting();
    this.reset();
  }

  private calculatePercentile(eventName: string, percentile: number): null | number {
    const samples = this.samples.get(eventName);
    if (!samples?.length) {
      return null;
    }

    // Use typed array for better performance with large sample sets
    const sortedSamples = new Float64Array(samples).sort();
    const index = Math.ceil((percentile / 100) * sortedSamples.length) - 1;
    const clampedIndex = Math.max(0, Math.min(index, sortedSamples.length - 1));

    return sortedSamples[clampedIndex];
  }

  private cleanupMiddleware(): void {
    this.uninstallMiddlewareFn?.();
    this.uninstallMiddlewareFn = undefined;
  }

  private cleanupReporting(): void {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = undefined;
    }
  }

  private computeMetrics(eventName: string): PerfMetrics {
    const stats = this.eventStats.get(eventName) ?? { ...INITIAL_STATS };
    const avgMs = stats.count > 0 ? stats.totalTimeMs / stats.count : null;

    return {
      eventName,
      ...stats,
      avgMs,
    };
  }

  private createMonitoringMiddleware(): EventMiddleware<EM, keyof EM, any, GC> {
    return async (context, next, info) => {
      const startTime = getCurrentTime();
      const result = await next();
      const durationMs = getCurrentTime() - startTime;

      this.processExecutionResults(info, durationMs);

      return result;
    };
  }

  private getAllEventNames(): Set<string> {
    return new Set([...this.eventStats.keys(), ...this.samples.keys()]);
  }

  private processExecutionResults(info: any, durationMs: number): void {
    if (!info.results?.length) {
      return;
    }

    for (const res of info.results) {
      const succeeded = !res.error;
      const errorMessage = res.error?.message;
      this.recordSample(info.eventName, durationMs, succeeded, errorMessage);
    }
  }

  private recordSample(eventName: string, durationMs: number, succeeded: boolean, errorMessage?: string): void {
    this.updateEventStats(eventName, durationMs, succeeded, errorMessage);

    if (succeeded || this.includeFailed) {
      this.storeSampleData(eventName, durationMs);
    }
  }

  private setupReporting(): void {
    if (!this.reportIntervalMs || !this.onReport) {
      return;
    }

    this.reportTimer = setInterval(() => {
      try {
        const snapshot = this.snapshotReport();
        this.onReport?.(snapshot.metrics);
      } catch (error) {
        console.error('[PerfMonitorPlugin] Report error:', error);
      }
    }, this.reportIntervalMs);
  }

  private storeSampleData(eventName: string, durationMs: number): void {
    let eventSamples = this.samples.get(eventName);

    if (!eventSamples) {
      eventSamples = [];
      this.samples.set(eventName, eventSamples);
    }

    eventSamples.push(durationMs);

    // Maintain sample size limit efficiently
    if (eventSamples.length > this.maxSamplesPerEvent) {
      eventSamples.shift(); // Remove oldest sample
    }
  }

  private updateEventStats(eventName: string, durationMs: number, succeeded: boolean, errorMessage?: string): void {
    let stats = this.eventStats.get(eventName);

    if (!stats) {
      stats = { ...INITIAL_STATS };
      this.eventStats.set(eventName, stats);
    }

    // Update basic counters
    stats.count++;
    if (succeeded) {
      stats.success++;
    } else {
      stats.failure++;
    }

    // Update timing statistics for relevant samples
    if (succeeded || this.includeFailed) {
      stats.totalTimeMs += durationMs;
      stats.samplesCounted++;

      // Update min/max efficiently
      if (stats.minMs === null || durationMs < stats.minMs) {
        stats.minMs = durationMs;
      }
      if (stats.maxMs === null || durationMs > stats.maxMs) {
        stats.maxMs = durationMs;
      }
    }

    // Store last sample
    stats.lastSample = {
      durationMs,
      errorMessage,
      eventName,
      succeeded,
      timestamp: Date.now(),
    };
  }
}
