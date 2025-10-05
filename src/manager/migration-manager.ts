import type { EventContext, EventMap, EventMigrator } from '../types.ts';

/**
 * MigrationManager.
 *
 * @author dafengzhen
 */
export class MigrationManager<EM extends EventMap> {
  private migrators = new Map<keyof EM, Map<number, EventMigrator<any>>>();

  private usage = new Map<string, { lastUsed: number; usageCount: number }>();

  constructor(private options: { inactivityThreshold: number }) {}

  cleanup(): void {
    const nowTime = Date.now();

    for (const [eventName, migrators] of this.migrators) {
      const key = String(eventName);
      const usage = this.usage.get(key);

      if (migrators.size === 0 || (usage && nowTime - usage.lastUsed > this.options.inactivityThreshold)) {
        this.migrators.delete(eventName);
        this.usage.delete(key);
      }
    }
  }

  getStats(): { byEvent: Record<string, number>; total: number } {
    const byEvent: Record<string, number> = {};
    let total = 0;

    for (const [eventName, migrators] of this.migrators) {
      const count = migrators.size;
      byEvent[String(eventName)] = count;
      total += count;
    }

    return { byEvent, total };
  }

  migrate<K extends keyof EM>(eventName: K, context: EventContext<EM[K]>, targetVersion: number): EventContext<EM[K]> {
    let ctx = { ...context };
    let currentVersion = ctx.version ?? 1;

    while (currentVersion < targetVersion) {
      const migrator = this.migrators.get(eventName)?.get(currentVersion);
      if (!migrator) {
        break;
      }

      try {
        ctx = migrator(ctx);
        currentVersion = (ctx.version ?? currentVersion) + 1;
      } catch (error) {
        throw new Error(`Migration failed for event ${String(eventName)} from version ${currentVersion}: ${error}`);
      }
    }

    return ctx;
  }

  register<K extends keyof EM>(eventName: K, fromVersion: number, migrator: EventMigrator<EM[K]>): void {
    let migratorMap = this.migrators.get(eventName);
    if (!migratorMap) {
      migratorMap = new Map();
      this.migrators.set(eventName, migratorMap);
    }
    migratorMap.set(fromVersion, migrator);

    const key = String(eventName);
    let usageInfo = this.usage.get(key);
    if (!usageInfo) {
      usageInfo = { lastUsed: Date.now(), usageCount: 0 };
      this.usage.set(key, usageInfo);
    }
  }

  trackUsage<K extends keyof EM>(eventName: K): void {
    const nowTime = Date.now();
    const key = String(eventName);

    const usage = this.usage.get(key) ?? { lastUsed: nowTime, usageCount: 0 };
    usage.lastUsed = nowTime;
    usage.usageCount++;
    this.usage.set(key, usage);
  }
}
