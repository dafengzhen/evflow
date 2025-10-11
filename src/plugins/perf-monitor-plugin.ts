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

const INITIAL_STATS: Readonly<EventStats> = Object.freeze({
  count: 0,
  failure: 0,
  lastSample: undefined,
  maxMs: null,
  minMs: null,
  samplesCounted: 0,
  success: 0,
  totalTimeMs: 0,
});

const now = (): number => performance.now?.() ?? Date.now();

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
  private readonly includeFailed: boolean;

  private readonly maxSamples: number;

  private readonly onReport?: (metrics: PerfMetrics[]) => void;

  private removeMiddleware?: () => void;

  private readonly reportInterval?: number;

  private reportTimer?: ReturnType<typeof setInterval>;

  private readonly samples = new Map<string, number[]>();

  private readonly stats = new Map<string, EventStats>();

  constructor(options: PerfMonitorOptions = {}) {
    this.includeFailed = options.includeFailedInStats ?? DEFAULT_INCLUDE_FAILED;
    this.maxSamples = options.maxSamplesPerEvent ?? DEFAULT_MAX_SAMPLES;
    this.reportInterval = options.reportIntervalMs;
    this.onReport = options.onReport;
  }

  getMetrics(eventName?: string): PerfMetrics[] {
    const names = eventName ? [eventName] : this.getAllEventNames();
    return names.map((name) => this.computeMetrics(name));
  }

  getPercentile(eventName: string, percentile: number): null | number {
    const samples = this.samples.get(eventName);
    if (!samples?.length) {
      return null;
    }
    const sorted = Float64Array.from(samples).sort();
    const idx = Math.min(sorted.length - 1, Math.ceil((percentile / 100) * sorted.length) - 1);
    return sorted[idx];
  }

  install(bus: IEventBus<EM, GC>): void {
    this.removeMiddleware = bus.useGlobalMiddleware(this.monitor(), { priority: 0 });
    this.startReporting();
  }

  reset(eventName?: string): void {
    if (eventName) {
      this.stats.delete(eventName);
      this.samples.delete(eventName);
    } else {
      this.stats.clear();
      this.samples.clear();
    }
  }

  snapshotReport() {
    const metrics = this.getMetrics();
    const percentiles: Record<string, { p50: null | number; p95: null | number; p99: null | number }> = {};
    for (const m of metrics) {
      percentiles[m.eventName] = {
        p50: this.getPercentile(m.eventName, 50),
        p95: this.getPercentile(m.eventName, 95),
        p99: this.getPercentile(m.eventName, 99),
      };
    }
    return { metrics, percentiles };
  }

  uninstall(): void {
    this.removeMiddleware?.();
    this.stopReporting();
    this.reset();
  }

  private computeMetrics(event: string): PerfMetrics {
    const s = this.stats.get(event) ?? INITIAL_STATS;
    const avgMs = s.samplesCounted > 0 ? s.totalTimeMs / s.samplesCounted : null;
    return { eventName: event, ...s, avgMs };
  }

  private getAllEventNames(): string[] {
    const names = new Set([...this.samples.keys(), ...this.stats.keys()]);
    return Array.from(names);
  }

  private monitor(): EventMiddleware<EM, keyof EM, any, GC> {
    return async (ctx, next, info) => {
      const start = now();
      await next();
      const durationMs = now() - start;

      if (!info?.results?.length) {
        return;
      }

      for (const result of info.results) {
        const succeeded = !result.error;
        const errorMessage = result.error?.message;

        this.record(info.eventName, durationMs, succeeded, errorMessage);
      }
    };
  }

  private monitor2(): EventMiddleware<EM, keyof EM, any, GC> {
    return async (ctx, next, info) => {
      const start = now();
      let succeeded = true;
      let errorMessage: string | undefined;

      try {
        return await next();
      } catch (err) {
        succeeded = false;
        errorMessage = (err as Error).message;
        throw err;
      } finally {
        const duration = now() - start;
        this.record(info.eventName, duration, succeeded, errorMessage);
      }
    };
  }

  private record(event: string, durationMs: number, succeeded: boolean, errorMessage?: string): void {
    const stats = this.stats.get(event) ?? { ...INITIAL_STATS };
    this.stats.set(event, stats);

    stats.count++;
    if (succeeded) {
      stats.success++;
    } else {
      stats.failure++;
    }

    if (succeeded || this.includeFailed) {
      stats.totalTimeMs += durationMs;
      stats.samplesCounted++;
      stats.minMs = stats.minMs === null ? durationMs : Math.min(stats.minMs, durationMs);
      stats.maxMs = stats.maxMs === null ? durationMs : Math.max(stats.maxMs, durationMs);

      this.recordSample(event, durationMs);
    }

    stats.lastSample = { durationMs, errorMessage, eventName: event, succeeded, timestamp: Date.now() };
  }

  private recordSample(event: string, durationMs: number): void {
    const samples = this.samples.get(event) ?? [];
    samples.push(durationMs);
    if (samples.length > this.maxSamples) {
      samples.splice(0, samples.length - this.maxSamples);
    }
    this.samples.set(event, samples);
  }

  private startReporting(): void {
    if (!this.reportInterval || !this.onReport) {
      return;
    }
    this.reportTimer = setInterval(() => {
      try {
        const report = this.snapshotReport();
        this.onReport?.(report.metrics);
      } catch (err) {
        console.error('[PerfMonitorPlugin] Report error:', err);
      }
    }, this.reportInterval);
  }

  private stopReporting(): void {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = undefined;
    }
  }
}
