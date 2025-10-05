import type {
  EventContext,
  EventHandler,
  EventMap,
  EventMiddleware,
  EventMigrator,
  HandlerUsageStats,
  UsageInfo,
  VersionedHandler,
} from '../types.ts';

import { now } from '../utils.ts';

/**
 * HandlerManager.
 *
 * @author dafengzhen
 */
export class HandlerManager<EM extends EventMap> {
  private handlers = new Map<keyof EM, VersionedHandler<any, any>[]>();

  private handlerUsage = new Map<string, UsageInfo>();

  private middlewares = new Map<keyof EM, EventMiddleware<any, any>[]>();

  private middlewareUsage = new Map<string, UsageInfo>();

  private migrators = new Map<keyof EM, Map<number, EventMigrator<any>>>();

  private migratorUsage = new Map<string, UsageInfo>();

  constructor(
    private maxHandlersPerEvent: number = 100,
    private maxMiddlewarePerEvent: number = 50,
  ) {}

  cleanup(options: {
    handlerInactivityThreshold?: number;
    middlewareInactivityThreshold?: number;
    migratorInactivityThreshold?: number;
  }): void {
    const { handlerInactivityThreshold, middlewareInactivityThreshold, migratorInactivityThreshold } = options;
    const current = now();

    const cleanupMap = (usageMap: Map<string, UsageInfo>, threshold?: number) => {
      if (!threshold) {
        return;
      }

      for (const [key, info] of usageMap.entries()) {
        if (current - info.lastUsed > threshold) {
          usageMap.delete(key);
        }
      }
    };

    cleanupMap(this.handlerUsage, handlerInactivityThreshold);
    cleanupMap(this.middlewareUsage, middlewareInactivityThreshold);
    cleanupMap(this.migratorUsage, migratorInactivityThreshold);
  }

  destroy(): void {
    this.handlers.clear();
    this.middlewares.clear();
    this.migrators.clear();
    this.handlerUsage.clear();
    this.middlewareUsage.clear();
    this.migratorUsage.clear();
  }

  getHandlers<K extends keyof EM>(eventName: K, version: number): EventHandler<EM[K], any>[] {
    return (this.handlers.get(eventName) ?? []).filter((h) => h.version === version).map((h) => h.handler);
  }

  getLatestHandler<K extends keyof EM>(eventName: K): null | VersionedHandler<EM[K], any> {
    const arr = this.handlers.get(eventName);
    if (!arr?.length) {
      return null;
    }
    return arr.reduce((max, cur) => (cur.version > max.version ? cur : max));
  }

  getMiddlewares<K extends keyof EM>(eventName: K): EventMiddleware<EM[K], any>[] {
    return this.middlewares.get(eventName) ?? [];
  }

  getUsageStats(): HandlerUsageStats {
    const summarize = <T>(map: Map<keyof EM, Map<number, T>> | Map<keyof EM, T[]>) => {
      const byEvent: Record<string, number> = {};
      let total = 0;
      for (const [event, value] of map) {
        const count = Array.isArray(value) ? value.length : value.size;
        byEvent[String(event)] = count;
        total += count;
      }
      return { byEvent, total };
    };

    return {
      handlers: summarize(this.handlers),
      middlewares: summarize(this.middlewares),
      migrators: summarize(this.migrators),
    };
  }

  migrateContext<K extends keyof EM>(eventName: K, context: EventContext<EM[K]>): EventContext<EM[K]> {
    let ctx = { ...context };
    const latest = this.getLatestHandler(eventName);
    if (!latest) {
      return ctx;
    }

    const seen = new Set<number>();
    while ((ctx.version ?? 1) < latest.version) {
      const currentVersion = ctx.version ?? 1;
      if (seen.has(currentVersion)) {
        break;
      } // prevent loop
      seen.add(currentVersion);

      const migrator = this.migrators.get(eventName)?.get(currentVersion);
      if (!migrator) {
        break;
      }

      try {
        ctx = migrator(ctx);
        ctx.version = (ctx.version ?? 1) + 1;
      } catch (e) {
        throw new Error(
          `Migration failed for "${String(eventName)}" from v${currentVersion} → v${(ctx.version ?? 1) + 1}: ${e}`,
        );
      }
    }

    return ctx;
  }

  off<K extends keyof EM>(eventName: K, handler?: EventHandler<EM[K], any>, version?: number): boolean {
    if (!this.handlers.has(eventName)) {
      return false;
    }

    if (!handler) {
      this.handlers.delete(eventName);
      return true;
    }

    const arr = this.handlers.get(eventName) ?? [];
    const originalLen = arr.length;

    const filtered = arr.filter((h) => {
      if (h.handler !== handler) {
        return true;
      }

      if (version !== undefined && h.version !== version) {
        return true;
      }

      return false;
    });

    if (filtered.length === originalLen) {
      return false;
    }

    if (filtered.length) {
      this.handlers.set(eventName, filtered);
    } else {
      this.handlers.delete(eventName);
    }

    return true;
  }

  on<K extends keyof EM>(eventName: K, handler: EventHandler<EM[K], any>, version = 1): () => void {
    this.ensureValidEventName(eventName);

    const handlers = this.handlers.get(eventName) ?? [];
    if (handlers.length >= this.maxHandlersPerEvent) {
      throw new Error(`Exceeded max handlers (${this.maxHandlersPerEvent}) for event "${String(eventName)}"`);
    }

    handlers.push({ handler, version });
    this.handlers.set(eventName, handlers);
    this.initUsage(this.handlerUsage, `${String(eventName)}_v${version}`);

    return () => this.off(eventName, handler, version);
  }

  registerMigrator<K extends keyof EM>(eventName: K, fromVersion: number, migrator: EventMigrator<EM[K]>): () => void {
    this.ensureValidEventName(eventName);

    let versionMap = this.migrators.get(eventName);
    if (!versionMap) {
      versionMap = new Map();
      this.migrators.set(eventName, versionMap);
    }

    versionMap.set(fromVersion, migrator);
    this.initUsage(this.migratorUsage, String(eventName));

    return () => {
      const map = this.migrators.get(eventName);
      if (!map) {
        return;
      }

      map.delete(fromVersion);
      if (map.size === 0) {
        this.migrators.delete(eventName);
      }
    };
  }

  trackHandlerUsage<K extends keyof EM>(eventName: K, version: number): void {
    const key = `${String(eventName)}_v${version}`;
    this.updateUsage(this.handlerUsage, key);
  }

  trackMiddlewareUsage<K extends keyof EM>(eventName: K): void {
    this.updateUsage(this.middlewareUsage, String(eventName));
  }

  trackMigratorUsage<K extends keyof EM>(eventName: K): void {
    this.updateUsage(this.migratorUsage, String(eventName));
  }

  use<K extends keyof EM>(eventName: K, middleware: EventMiddleware<EM[K], any>): () => void {
    this.ensureValidEventName(eventName);

    const arr = this.middlewares.get(eventName) ?? [];
    if (arr.length >= this.maxMiddlewarePerEvent) {
      throw new Error(`Exceeded max middlewares (${this.maxMiddlewarePerEvent}) for event "${String(eventName)}"`);
    }

    arr.push(middleware);
    this.middlewares.set(eventName, arr);
    this.initUsage(this.middlewareUsage, String(eventName));

    return () => {
      const updated = (this.middlewares.get(eventName) ?? []).filter((m) => m !== middleware);
      this.middlewares.set(eventName, updated);
    };
  }

  private ensureValidEventName<K extends keyof EM>(eventName: K): void {
    if (typeof eventName !== 'string' && typeof eventName !== 'symbol') {
      throw new Error(`Invalid event name type: ${typeof eventName}`);
    }
  }

  private initUsage(map: Map<string, UsageInfo>, key: string): void {
    if (!map.has(key)) {
      map.set(key, { lastUsed: now(), usageCount: 0 });
    }
  }

  private updateUsage(map: Map<string, UsageInfo>, key: string): void {
    const current = now();
    const info = map.get(key) ?? { lastUsed: current, usageCount: 0 };
    info.lastUsed = current;
    info.usageCount++;
    map.set(key, info);
  }
}
