import type { EventMap, EventMiddleware } from '../types.ts';

/**
 * MiddlewareManager.
 *
 * @author dafengzhen
 */
export class MiddlewareManager<EM extends EventMap> {
  private middlewares = new Map<keyof EM, Array<EventMiddleware<any, any>>>();

  private usage = new Map<string, { lastUsed: number; usageCount: number }>();

  constructor(
    private options: {
      inactivityThreshold: number;
      maxMiddlewarePerEvent: number;
    },
  ) {}

  cleanup(): void {
    const nowTime = Date.now();

    for (const [eventName, middlewares] of this.middlewares) {
      const key = String(eventName);
      const usage = this.usage.get(key);

      if (!middlewares.length || (usage && nowTime - usage.lastUsed > this.options.inactivityThreshold)) {
        this.middlewares.delete(eventName);
        this.usage.delete(key);
      }
    }
  }

  getMiddlewares<K extends keyof EM>(eventName: K): EventMiddleware<EM[K], any>[] {
    return this.middlewares.get(eventName) ?? [];
  }

  getStats(): { byEvent: Record<string, number>; total: number } {
    const byEvent: Record<string, number> = {};
    let total = 0;

    for (const [eventName, middlewares] of this.middlewares) {
      const count = middlewares.length;
      byEvent[String(eventName)] = count;
      total += count;
    }

    return { byEvent, total };
  }

  trackUsage<K extends keyof EM>(eventName: K): void {
    const nowTime = Date.now();
    const key = String(eventName);

    const usage = this.usage.get(key);
    if (usage) {
      usage.lastUsed = nowTime;
      usage.usageCount++;
    } else {
      this.usage.set(key, { lastUsed: nowTime, usageCount: 1 });
    }
  }

  use<K extends keyof EM>(eventName: K, middleware: EventMiddleware<EM[K], any>): () => void {
    const arr = this.middlewares.get(eventName) ?? [];
    if (arr.length >= this.options.maxMiddlewarePerEvent) {
      throw new Error(
        `Maximum middleware (${this.options.maxMiddlewarePerEvent}) exceeded for event: ${String(eventName)}`,
      );
    }

    arr.push(middleware);
    this.middlewares.set(eventName, arr);

    if (!this.usage.get(String(eventName))) {
      this.usage.set(String(eventName), { lastUsed: Date.now(), usageCount: 0 });
    }

    return () => {
      const updated = (this.middlewares.get(eventName) ?? []).filter((m) => m !== middleware);
      if (updated.length > 0) {
        this.middlewares.set(eventName, updated);
      } else {
        this.middlewares.delete(eventName);
        this.usage.delete(String(eventName));
      }
    };
  }
}
