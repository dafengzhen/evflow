import { beforeEach, describe, expect, it } from 'vitest';

import type { EventContext } from '../types.ts';

import { MigrationManager } from './migration-manager.ts';

/**
 * MigrationManager.
 *
 * @author dafengzhen
 */
describe('MigrationManager', () => {
  let migration: MigrationManager<{ testEvent: { foo: string } }>;

  beforeEach(() => {
    migration = new MigrationManager({ inactivityThreshold: 1000 });
  });

  it('should register and migrate event context correctly', () => {
    migration.register('testEvent', 1, (ctx) => {
      return { ...ctx, meta: { foo: 'bar' }, version: 2 };
    });

    const ctx: EventContext<{ foo: string }> = { meta: { foo: 'initial' }, version: 1 };
    const migrated = migration.migrate('testEvent', ctx, 2);

    expect(migrated.meta?.foo).toBe('bar');
    expect(migrated.version).toBe(2);
  });

  it('should track usage correctly', () => {
    migration.trackUsage('testEvent');
    const stats = migration.getStats();

    expect(stats.total).toBe(0); // trackUsage does not add migrators
  });

  it('should cleanup unused migrators', () => {
    migration.register('testEvent', 1, (ctx) => ({ ...ctx, version: 2 }));
    migration.trackUsage('testEvent');

    // simulate old lastUsed
    const now = Date.now();
    (migration as any).usage.set('testEvent', { lastUsed: now - 2000, usageCount: 1 });

    migration.cleanup();

    const stats = migration.getStats();
    expect(stats.total).toBe(0);
  });

  it('should throw error if migration fails', () => {
    migration.register('testEvent', 1, () => {
      throw new Error('fail');
    });

    const ctx = { version: 1 };
    expect(() => migration.migrate('testEvent', ctx, 2)).toThrow(/Migration failed/);
  });
});
