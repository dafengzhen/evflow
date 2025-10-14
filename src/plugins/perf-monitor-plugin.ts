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
  eventName: string;
  succeeded: boolean;
  timestamp: number;
}

const DEFAULTS = {
  INCLUDE_FAILED: true,
  MAX_SAMPLES: 500,
};

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

  private readonly stats = new Map<string, PerfMetrics>();

  constructor(options: PerfMonitorOptions = {}) {
    this.includeFailed = options.includeFailedInStats ?? DEFAULTS.INCLUDE_FAILED;
    this.maxSamples = options.maxSamplesPerEvent ?? DEFAULTS.MAX_SAMPLES;
    this.onReport = options.onReport;
    this.reportInterval = options.reportIntervalMs;
  }

  getMetrics(eventName?: string): PerfMetrics[] {
    const events = eventName ? [eventName] : [...this.stats.keys()];
    return events.map((name) => this.stats.get(name)!).filter(Boolean);
  }

  getPercentile(eventName: string, percentile: number): null | number {
    const samples = this.samples.get(eventName);
    if (!samples?.length) {
      return null;
    }
    const sorted = Float64Array.from(samples).sort();
    const index = Math.min(sorted.length - 1, Math.trunc((percentile / 100) * sorted.length));
    return sorted[index];
  }

  install(bus: IEventBus<EM, GC>): void {
    this.removeMiddleware = bus.useGlobalMiddleware(this.monitor(), { priority: 0, throwOnEventError: true });
    if (this.onReport && this.reportInterval) {
      this.startReporting();
    }
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

  uninstall(): void {
    this.removeMiddleware?.();
    this.stopReporting();
    this.reset();
  }

  private monitor(): EventMiddleware<EM, keyof EM, any, GC> {
    return async (_, next, info) => {
      const start = now();
      let succeeded = true;
      let errorMessage: string | undefined;

      try {
        await next();
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

  private record(event: string, duration: number, succeeded: boolean, errorMessage?: string): void {
    const stat = this.stats.get(event) ?? {
      avgMs: null,
      count: 0,
      eventName: event,
      failure: 0,
      maxMs: null,
      minMs: null,
      samplesCounted: 0,
      success: 0,
      totalTimeMs: 0,
    };
    this.stats.set(event, stat);

    stat.count++;
    if (succeeded) {
      stat.success++;
    } else {
      stat.failure++;
    }

    if (succeeded || this.includeFailed) {
      stat.samplesCounted++;
      stat.totalTimeMs += duration;
      stat.minMs = stat.minMs === null ? duration : Math.min(stat.minMs, duration);
      stat.maxMs = stat.maxMs === null ? duration : Math.max(stat.maxMs, duration);
      stat.avgMs = stat.totalTimeMs / stat.samplesCounted;
      this.recordSample(event, duration);
    }

    stat.lastSample = {
      durationMs: duration,
      errorMessage,
      eventName: event,
      succeeded,
      timestamp: Date.now(),
    };
  }

  private recordSample(event: string, duration: number): void {
    const arr = this.samples.get(event) ?? [];
    if (arr.length >= this.maxSamples) {
      arr.shift();
    }
    arr.push(duration);
    this.samples.set(event, arr);
  }

  private startReporting(): void {
    this.reportTimer = setInterval(() => {
      try {
        const metrics = this.getMetrics();
        this.onReport?.(metrics);
      } catch (err) {
        console.error('[PerfMonitorPlugin] report error:', err);
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
