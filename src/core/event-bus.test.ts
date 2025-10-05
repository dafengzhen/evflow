import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventContext, EventMap, EventStore } from '../types.ts';

import { EventBus } from './event-bus.ts';

interface TestEvents extends EventMap {
  test: { value: number };
}

/**
 * EventBus.
 *
 * @author dafengzhen
 */
describe('EventBus', () => {
  let bus: EventBus<TestEvents>;
  let store: EventStore;

  beforeEach(() => {
    store = {
      clear: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      healthCheck: vi.fn().mockResolvedValue({ status: 'healthy' }),
      load: vi.fn().mockResolvedValue([]),
      loadAll: vi.fn().mockResolvedValue([]),
      loadByName: vi.fn().mockResolvedValue([]),
      loadByTimeRange: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue(undefined),
      saveEventResults: vi.fn().mockResolvedValue(undefined),
    };
    bus = new EventBus(store);
  });

  afterEach(async () => {
    await bus.destroy();
  });

  it('should create an EventBus instance with default options', () => {
    expect(bus.getMetrics()).toHaveProperty('nodeId');
  });

  it('should register and emit events', async () => {
    const handler = vi.fn().mockResolvedValue('ok');
    bus.on('test', handler);

    const results = await bus.emit('test', { meta: { value: 42 } });
    expect(handler).toHaveBeenCalled();
    expect(results[0].result).toBe('ok');
  });

  it('should call middleware in order', async () => {
    const calls: string[] = [];
    bus.use('test', async (ctx, next) => {
      calls.push('a');
      return next();
    });
    bus.use('test', async (ctx, next) => {
      calls.push('b');
      return next();
    });
    bus.on('test', async () => {
      calls.push('handler');
      return 'done';
    });

    const results = await bus.emit('test', { meta: { value: 1 } });
    expect(calls).toEqual(['a', 'b', 'handler']);
    expect(results[0].result).toBe('done');
  });

  it('should handle globalTimeout', async () => {
    bus.on('test', async () => new Promise((resolve) => setTimeout(() => resolve('ok'), 50)));

    const results = await bus.emit('test', { meta: { value: 1 } }, { timeout: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].state).toBe('timeout');
    expect(results[0].error).toBeInstanceOf(Error);
    expect(results[0].error?.message).toContain('timed out');
  });

  it('should destroy the bus', async () => {
    const handler = vi.fn();
    bus.on('test', handler);
    await bus.destroy();
    await expect(bus.emit('test', { meta: { value: 1 } })).rejects.toThrow('EventBus has been destroyed');
  });

  it('should add and remove broadcast adapters', () => {
    const adapter = { name: 'mock', publish: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() };
    bus.addBroadcastAdapter(adapter);
    expect(() => bus.removeBroadcastAdapter('mock')).not.toThrow();
  });

  it('should manage DLQ operations', async () => {
    vi.spyOn(bus as any, 'dlqManager', 'get').mockReturnValue({
      destroy: vi.fn().mockResolvedValue(undefined),
      getDLQStats: vi.fn().mockResolvedValue({ byEvent: {}, newest: null, oldest: null, total: 0 }),
      listDLQ: vi.fn().mockResolvedValue([]),
      purgeDLQ: vi.fn().mockResolvedValue(true),
      purgeMultipleDLQ: vi.fn().mockResolvedValue([{ id: '1', success: true }]),
      requeueDLQ: vi.fn().mockResolvedValue({ dlqId: '1', success: true }),
      requeueMultipleDLQ: vi.fn().mockResolvedValue([{ id: '1', success: true }]),
    } as any);

    expect(await bus.purgeDLQ('t', '1')).toBe(true);
    expect(await bus.purgeMultipleDLQ('t', ['1'])).toEqual([{ id: '1', success: true }]);
    expect(await bus.requeueDLQ('t', '1')).toEqual({ dlqId: '1', success: true });
    expect(await bus.requeueMultipleDLQ('t', ['1'])).toEqual([{ id: '1', success: true }]);
    expect(await bus.listDLQ('t')).toEqual([]);
    expect(await bus.getDLQStats()).toEqual({ byEvent: {}, newest: null, oldest: null, total: 0 });
  });

  it('should validate event names', async () => {
    await expect(() => (bus as any).emit(123, {})).rejects.toThrow('Invalid event name: 123');
  });

  it('should validate emit options', () => {
    expect(() => (bus as any).validateEmitOptions({ globalTimeout: -1 })).toThrow('globalTimeout must be non-negative');
    expect(() => (bus as any).validateEmitOptions({ maxConcurrency: -5 })).toThrow('maxConcurrency must be ≥ 1');
  });

  it('should track handler usage', async () => {
    const handler = vi.fn();
    bus.on('test', handler);
    await bus.emit('test', { meta: { value: 1 } });
    const stats = bus.getUsageStats();
    expect(stats.handlers.total).toBeGreaterThan(0);
  });

  it('should handle healthCheck', async () => {
    const health = await bus.healthCheck();
    expect(health.status).toBe('healthy');
    expect(health.details.adapters).toBeInstanceOf(Array);
    expect(health.details.store).toHaveProperty('status');
  });

  it('should allow on/off for handlers', () => {
    const handler = vi.fn();
    bus.on('test', handler);
    expect(bus.off('test', handler)).toBe(true);
  });

  it('should start and stop cleanup interval', () => {
    bus.startCleanup();
    expect((bus as any).cleanupInterval).toBeDefined();
    bus.stopCleanup();
    expect((bus as any).cleanupInterval).toBeUndefined();
  });

  it('should register and use migrators', () => {
    const migrator = (ctx: EventContext) => ({ ...ctx, migrated: true }) as any;
    const unregister = bus.registerMigrator('test', 1, migrator);
    expect(typeof unregister).toBe('function');
  });
});
