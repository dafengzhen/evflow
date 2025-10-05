import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventContext } from './types.ts';

import { EventState } from './enums.ts';
import { EventCancelledError, EventTimeoutError } from './errors.ts';
import { EventBus, EventTask, InMemoryEventStore } from './index.ts';

type Events = {
  bar: { x: number };
  foo: { msg: string };
};

type MyEvents = {
  userCreated: { age?: number; name: string };
};

/**
 * EventBus.
 *
 * @author dafengzhen
 */
describe('EventBus', () => {
  it('on/off works correctly', async () => {
    const bus = new EventBus<Events>();
    const handler = vi.fn();
    const dispose = bus.on('foo', handler);

    await bus.emit('foo', { meta: { msg: 'hello' } });
    expect(handler).toHaveBeenCalledTimes(1);

    dispose();
    await bus.emit('foo', { meta: { msg: 'world' } });
    expect(handler).toHaveBeenCalledTimes(1);

    // off without handler removes all
    const h2 = vi.fn();
    bus.on('foo', h2);
    bus.off('foo');
    await bus.emit('foo', { meta: { msg: 'x' } });
    expect(h2).not.toHaveBeenCalled();
  });

  it('emit parallel and serial stopOnError', async () => {
    const bus = new EventBus<Events>();

    const ok = vi.fn().mockResolvedValue('ok');
    const fail = vi.fn().mockRejectedValue(new Error('bad'));

    bus.on('foo', ok);
    bus.on('foo', fail);
    bus.on('foo', ok);

    // parallel, errors are collected
    const results1 = await bus.emit('foo', { meta: { msg: 'a' } }, undefined, {
      globalTimeout: 0,
      parallel: true,
      stopOnError: false,
    });
    expect(results1.length).toBe(3);
    expect(results1.some((r) => r.error)).toBe(true);

    // serial, stop on error
    const results2 = await bus.emit('foo', { meta: { msg: 'b' } }, undefined, {
      globalTimeout: 0,
      parallel: false,
      stopOnError: true,
    });
    expect(results2.length).toBeLessThan(3);
  });

  it('withGlobalTimeout triggers timeout', async () => {
    const bus = new EventBus<Events>();
    bus.on('foo', async () => new Promise((res) => setTimeout(res, 50)));

    await expect(bus.emit('foo', { meta: { msg: 'zzz' } }, undefined, { globalTimeout: 10 })).rejects.toBeInstanceOf(
      EventTimeoutError,
    );
  });
});

/**
 * EventBus - Persistence.
 *
 * @author dafengzhen
 */
describe('EventBus - Persistence', () => {
  it('persists events into EventStore', async () => {
    const store = new InMemoryEventStore();
    const bus = new EventBus<Events>(store);

    const handler = vi.fn().mockResolvedValue('ok');
    bus.on('foo', handler);

    await bus.emit('foo', { meta: { msg: 'persist test' } });

    const records = await store.loadByName('foo');
    expect(records.length).toBe(1);
    expect(records[0].context.meta?.msg).toBe('persist test');
    expect(records[0].state).toBe(EventState.Succeeded);
    expect(records[0].result).toBe('ok');
  });

  it('persists failed events with error info', async () => {
    const store = new InMemoryEventStore();
    const bus = new EventBus<Events>(store);

    bus.on('foo', () => {
      throw new Error('fail persist');
    });

    const results = await bus.emit('foo', { meta: { msg: 'fail case' } });
    expect(results[0].error).toBeInstanceOf(Error);
    expect(results[0].error?.message).toBe('fail persist');

    const records = await store.loadByName('foo');
    const failedRecord = records.find((record) => record.state === 'failed');
    expect(failedRecord).toBeDefined();
    expect(failedRecord?.error?.message).toBe('fail persist');
    expect(failedRecord?.state).toBe('failed');

    const dlqRecord = records.find((record) => record.state === 'deadletter');
    expect(dlqRecord).toBeDefined();
  });
});

/**
 * EventBus - Versioning.
 *
 * @author dafengzhen
 */
describe('EventBus - Versioning', () => {
  it('uses versioned handlers correctly', async () => {
    const bus = new EventBus<Events>();

    const hV1 = vi.fn().mockReturnValue('v1');
    const hV2 = vi.fn().mockReturnValue('v2');

    bus.on('foo', hV1, 1);
    bus.on('foo', hV2, 2);

    // emit v1
    const r1 = await bus.emit('foo', { meta: { msg: 'hello' }, version: 1 });
    expect(hV1).toHaveBeenCalled();
    expect(hV2).not.toHaveBeenCalled();
    expect(r1[0].result).toBe('v1');

    // emit v2
    const r2 = await bus.emit('foo', { meta: { msg: 'world' }, version: 2 });
    expect(hV2).toHaveBeenCalled();
    expect(r2[0].result).toBe('v2');
  });

  it('falls back to version 1 when no version is specified', async () => {
    const bus = new EventBus<Events>();

    const hV1 = vi.fn().mockReturnValue('default v1');
    bus.on('foo', hV1, 1);

    const r = await bus.emit('foo', { meta: { msg: 'no version' } });
    expect(hV1).toHaveBeenCalled();
    expect(r[0].result).toBe('default v1');
  });
});

/**
 * EventBus - Middleware System.
 *
 * @author dafengzhen
 */
describe('EventBus - Middleware System', () => {
  type TestEvent = { testEvent: { payload: any; userRole: string } };
  let bus: EventBus<TestEvent>;
  let logs: string[];

  beforeEach(() => {
    bus = new EventBus<TestEvent>();
    logs = [];
  });

  it('Should execute middleware and event handlers in order', async () => {
    const callOrder: string[] = [];

    bus.use('testEvent', async (ctx, next) => {
      callOrder.push('mw1-before');
      const res = await next();
      callOrder.push('mw1-after');
      return res;
    });

    bus.use('testEvent', async (ctx, next) => {
      callOrder.push('mw2-before');
      const res = await next();
      callOrder.push('mw2-after');
      return res;
    });

    bus.on('testEvent', async () => {
      callOrder.push('handler');
      return 'ok';
    });

    const results = await bus.emit('testEvent', { meta: { payload: {}, userRole: 'admin' } });

    expect(results[0].result).toBe('ok');
    expect(callOrder).toEqual(['mw1-before', 'mw2-before', 'handler', 'mw2-after', 'mw1-after']);
  });

  it('Authorization middleware should block non-admin users', async () => {
    bus.use('testEvent', async (ctx, next) => {
      if (ctx.meta?.userRole !== 'admin') {
        throw new Error('Permission denied');
      }
      return next();
    });

    bus.on('testEvent', async () => 'ok');

    const results = await bus.emit('testEvent', { meta: { payload: {}, userRole: 'guest' } });

    expect(results[0].error).toBeInstanceOf(Error);
    expect(results[0].error?.message).toBe('Permission denied');

    const okResult = await bus.emit('testEvent', { meta: { payload: {}, userRole: 'admin' } });
    expect(okResult[0].result).toBe('ok');
  });

  it('Data transformation middleware should modify payload', async () => {
    bus.use('testEvent', async (ctx, next) => {
      if (ctx.meta?.payload) {
        ctx.meta.payload.transformed = true;
      }
      return next();
    });

    let capturedPayload: any;
    bus.on('testEvent', async (ctx) => {
      capturedPayload = ctx.meta?.payload;
      return 'done';
    });

    await bus.emit('testEvent', { meta: { payload: { foo: 1 }, userRole: 'admin' } });
    expect(capturedPayload).toEqual({ foo: 1, transformed: true });
  });

  it('Logging middleware should record event start and end', async () => {
    const spyLog = vi.fn((msg) => logs.push(msg));

    bus.use('testEvent', async (ctx, next) => {
      spyLog(`[Start] ${ctx.name}`);
      const res = await next();
      spyLog(`[End] ${ctx.name}`);
      return res;
    });

    bus.on('testEvent', async () => 'ok');
    await bus.emit('testEvent', { meta: { payload: {}, userRole: 'admin' } });

    expect(logs).toEqual(['[Start] testEvent', '[End] testEvent']);
  });

  it('Performance middleware should record execution time', async () => {
    const spyPerf = vi.fn();
    bus.use('testEvent', async (ctx, next) => {
      const start = Date.now();
      const res = await next();
      spyPerf(Date.now() - start);
      return res;
    });

    bus.on('testEvent', async () => new Promise((r) => setTimeout(() => r('ok'), 50)));
    await bus.emit('testEvent', { meta: { payload: {}, userRole: 'admin' } });

    expect(spyPerf).toHaveBeenCalled();
    expect(spyPerf.mock.calls[0][0]).toBeGreaterThanOrEqual(50);
  });
});

/**
 * EventBus - Event Version Migration.
 *
 * @author dafengzhen
 */
describe('EventBus - Event Version Migration', () => {
  it('should migrate old version events to new version and execute new version handler', async () => {
    const bus = new EventBus<MyEvents>();

    // v1 handler
    const v1Handler = vi.fn(() => {
      // Should not be called
    });
    bus.on('userCreated', v1Handler, 1);

    // v2 handler
    const v2Handler = vi.fn((ctx: EventContext<MyEvents['userCreated']>) => {
      return ctx.meta?.age;
    });
    bus.on('userCreated', v2Handler, 2);

    // Register migrator v1 -> v2
    bus.registerMigrator('userCreated', 1, (ctx) => ({
      ...ctx,
      meta: { ...ctx.meta!, age: ctx.meta?.age ?? 18 },
    }));

    const results = await bus.emit('userCreated', { meta: { name: 'Alice' }, version: 1 });

    expect(v1Handler).not.toHaveBeenCalled(); // Old version handler should not execute
    expect(v2Handler).toHaveBeenCalledOnce();
    expect(v2Handler.mock.calls[0][0].meta).toEqual({ age: 18, name: 'Alice' });
    expect(results[0].result).toBe(18);
  });

  it('new version events should directly execute corresponding handler', async () => {
    const bus = new EventBus<MyEvents>();

    const v2Handler = vi.fn((ctx: EventContext<MyEvents['userCreated']>) => ctx.meta?.name);
    bus.on('userCreated', v2Handler, 2);

    const results = await bus.emit('userCreated', { meta: { name: 'Bob' }, version: 2 });

    expect(v2Handler).toHaveBeenCalledOnce();
    expect(v2Handler.mock.calls[0][0].meta).toEqual({ name: 'Bob' });
    expect(results[0].result).toBe('Bob');
  });

  it('should execute old version handler when migrator is missing', async () => {
    const bus = new EventBus<MyEvents>();

    const v1Handler = vi.fn((ctx: EventContext<MyEvents['userCreated']>) => ctx.meta?.name);
    bus.on('userCreated', v1Handler, 1);

    const results = await bus.emit('userCreated', { meta: { name: 'Carol' }, version: 1 });

    expect(v1Handler).toHaveBeenCalledOnce();
    expect(results[0].result).toBe('Carol');
  });

  it('supports multi-level migration v1 -> v2 -> v3', async () => {
    type MultiEvents = {
      itemCreated: { category?: string; name: string; quantity?: number };
    };

    const bus = new EventBus<MultiEvents>();

    // v3 handler
    const v3Handler = vi.fn((ctx: EventContext<MultiEvents['itemCreated']>) => ctx.meta);
    bus.on('itemCreated', v3Handler, 3);

    // v1 -> v2
    bus.registerMigrator('itemCreated', 1, (ctx) => ({
      ...ctx,
      meta: { ...ctx.meta!, quantity: ctx.meta?.quantity ?? 1 },
    }));

    // v2 -> v3
    bus.registerMigrator('itemCreated', 2, (ctx) => ({
      ...ctx,
      meta: { ...ctx.meta!, category: 'default' },
    }));

    const results = await bus.emit('itemCreated', { meta: { name: 'Item1' }, version: 1 });

    expect(v3Handler).toHaveBeenCalledOnce();
    expect(v3Handler.mock.calls[0][0].meta).toEqual({
      category: 'default',
      name: 'Item1',
      quantity: 1,
    });
    expect(results[0].result).toEqual({
      category: 'default',
      name: 'Item1',
      quantity: 1,
    });
  });
});

/**
 * EventBus - Dead Letter Queue (DLQ).
 *
 * @author dafengzhen
 */
describe('EventBus = Dead Letter Queue (DLQ)', () => {
  it('should enter DLQ after event failure and can be requeue / purge with stats', async () => {
    const store = new InMemoryEventStore();
    const bus = new EventBus<any>(store);

    bus.on('order.created', async () => {
      throw new Error('Processing failed');
    });
    const traceId = 'trace_dlq_test';

    // Initial state - no DLQ records
    const initialStats = await bus.getDLQStats(traceId);
    expect(initialStats.total).toBe(0);
    expect(initialStats.byEvent).toEqual({});
    expect(initialStats.oldest).toBeNull();
    expect(initialStats.newest).toBeNull();

    // Trigger event failure
    await bus.emit('order.created', { meta: { orderId: 999 }, traceId }, { retries: 2 });

    // Verify entry into DLQ
    const dlqItems = await bus.listDLQ(traceId);
    expect(dlqItems.length).toBe(1);

    // Verify statistics
    const afterFailureStats = await bus.getDLQStats(traceId);
    expect(afterFailureStats.total).toBe(1);
    expect(afterFailureStats.byEvent).toEqual({
      'order.created': 1,
    });
    expect(afterFailureStats.oldest).toBeInstanceOf(Date);
    expect(afterFailureStats.newest).toBeInstanceOf(Date);
    expect(afterFailureStats.oldest).toEqual(afterFailureStats.newest); // Only one record, same timestamp

    // Requeue DLQ record
    await bus.requeueDLQ(traceId, dlqItems[0].id);

    // Verify DLQ record still exists after requeue
    const afterRequeue = await bus.listDLQ(traceId);
    expect(afterRequeue.length).toBe(1);

    // Verify statistics after requeue
    const afterRequeueStats = await bus.getDLQStats(traceId);
    expect(afterRequeueStats.total).toBe(1);
    expect(afterRequeueStats.byEvent).toEqual({
      'order.created': 1,
    });
    expect(afterRequeueStats.oldest).toBeInstanceOf(Date);
    expect(afterRequeueStats.newest).toBeInstanceOf(Date);

    // The timestamp of the new record should be later than the original record
    expect(afterRequeueStats.newest!.getTime()).toBeGreaterThanOrEqual(afterFailureStats.newest!.getTime());

    // Purge DLQ record
    await bus.purgeDLQ(traceId, afterRequeue[0].id);

    // Verify no DLQ records after purge
    const afterPurge = await bus.listDLQ(traceId);
    expect(afterPurge.length).toBe(0);

    // Verify statistics after purge
    const afterPurgeStats = await bus.getDLQStats(traceId);
    expect(afterPurgeStats.total).toBe(0);
    expect(afterPurgeStats.byEvent).toEqual({});
    expect(afterPurgeStats.oldest).toBeNull();
    expect(afterPurgeStats.newest).toBeNull();

    // Verify global statistics are also correct
    const globalStats = await bus.getDLQStats();
    expect(globalStats.total).toBe(0);
    expect(globalStats.byEvent).toEqual({});
    expect(globalStats.oldest).toBeNull();
    expect(globalStats.newest).toBeNull();
  });

  describe('getDLQStats', () => {
    let store: InMemoryEventStore;
    let bus: EventBus<any>;

    beforeEach(() => {
      store = new InMemoryEventStore();
      bus = new EventBus(store);
    });

    it('should return correct statistics for empty DLQ', async () => {
      const stats = await bus.getDLQStats();

      expect(stats).toEqual({
        byEvent: {},
        newest: null,
        oldest: null,
        total: 0,
      });
    });

    it('should correctly count DLQ records for a single traceId', async () => {
      const traceId = 'trace_test_1';

      // Create some DLQ records
      await store.save({
        context: {},
        error: new Error('Processing failed'),
        id: 'dlq_1',
        name: 'order.created',
        result: null,
        state: EventState.DeadLetter,
        timestamp: Date.now() - 5000,
        traceId,
        version: 1,
      });

      await store.save({
        context: {},
        error: new Error('Cancellation failed'),
        id: 'dlq_2',
        name: 'order.cancelled',
        result: null,
        state: EventState.DeadLetter,
        timestamp: Date.now() - 3000,
        traceId,
        version: 1,
      });

      await store.save({
        context: {},
        error: new Error('Failed again'),
        id: 'dlq_3',
        name: 'order.created',
        result: null,
        state: EventState.DeadLetter,
        timestamp: Date.now() - 1000,
        traceId,
        version: 1,
      });

      const stats = await bus.getDLQStats(traceId);

      expect(stats.total).toBe(3);
      expect(stats.byEvent).toEqual({
        'order.cancelled': 1,
        'order.created': 2,
      });
      expect(stats.oldest).toBeInstanceOf(Date);
      expect(stats.newest).toBeInstanceOf(Date);
      expect(stats.newest!.getTime()).toBeGreaterThan(stats.oldest!.getTime());
    });

    it('should correctly count DLQ records for multiple traceIds', async () => {
      const traceId1 = 'trace_test_1';
      const traceId2 = 'trace_test_2';

      // Create records for the first traceId
      await store.save({
        context: {},
        error: new Error('Processing failed'),
        id: 'dlq_1',
        name: 'order.created',
        result: null,
        state: EventState.DeadLetter,
        timestamp: Date.now() - 5000,
        traceId: traceId1,
        version: 1,
      });

      await store.save({
        context: {},
        error: new Error('Payment failed'),
        id: 'dlq_2',
        name: 'payment.failed',
        result: null,
        state: EventState.DeadLetter,
        timestamp: Date.now() - 3000,
        traceId: traceId1,
        version: 1,
      });

      // Create records for the second traceId
      await store.save({
        context: {},
        error: new Error('Processing failed'),
        id: 'dlq_3',
        name: 'order.created',
        result: null,
        state: EventState.DeadLetter,
        timestamp: Date.now() - 2000,
        traceId: traceId2,
        version: 1,
      });

      // Test statistics for the first traceId
      const stats1 = await bus.getDLQStats(traceId1);
      expect(stats1.total).toBe(2);
      expect(stats1.byEvent).toEqual({
        'order.created': 1,
        'payment.failed': 1,
      });

      // Test statistics for the second traceId
      const stats2 = await bus.getDLQStats(traceId2);
      expect(stats2.total).toBe(1);
      expect(stats2.byEvent).toEqual({
        'order.created': 1,
      });

      // Test global statistics (all traceIds)
      const globalStats = await bus.getDLQStats();
      expect(globalStats.total).toBe(3);
      expect(globalStats.byEvent).toEqual({
        'order.created': 2,
        'payment.failed': 1,
      });
    });

    it('should correctly calculate time range', async () => {
      const traceId = 'trace_time_test';
      const now = Date.now();

      const records = [
        {
          context: {},
          error: new Error('Failure 1'),
          id: 'dlq_oldest',
          name: 'order.created',
          result: null,
          state: EventState.DeadLetter,
          timestamp: now - 5000,
          traceId,
          version: 1,
        },
        {
          context: {},
          error: new Error('Failure 2'),
          id: 'dlq_middle',
          name: 'order.updated',
          result: null,
          state: EventState.DeadLetter,
          timestamp: now - 3000,
          traceId,
          version: 1,
        },
        {
          context: {},
          error: new Error('Failure 3'),
          id: 'dlq_newest',
          name: 'order.cancelled',
          result: null,
          state: EventState.DeadLetter,
          timestamp: now - 1000,
          traceId,
          version: 1,
        },
      ];

      for (const record of records) {
        await store.save(record);
      }

      const stats = await bus.getDLQStats(traceId);

      expect(stats.oldest).toEqual(new Date(now - 5000));
      expect(stats.newest).toEqual(new Date(now - 1000));
    });

    it('should ignore records with non-DLQ states', async () => {
      const traceId = 'trace_mixed_test';

      // DLQ record
      await store.save({
        context: {},
        error: new Error('Processing failed'),
        id: 'dlq_1',
        name: 'order.created',
        result: null,
        state: EventState.DeadLetter,
        timestamp: Date.now(),
        traceId,
        version: 1,
      });

      // Non-DLQ record (should be ignored)
      await store.save({
        context: {},
        error: new Error(),
        id: 'success_1',
        name: 'order.created',
        result: { success: true },
        state: EventState.Succeeded,
        timestamp: Date.now(),
        traceId,
        version: 1,
      });

      await store.save({
        context: {},
        error: new Error('Processing failed'),
        id: 'failed_1',
        name: 'order.created',
        result: null,
        state: EventState.Failed,
        timestamp: Date.now(),
        traceId,
        version: 1,
      });

      const stats = await bus.getDLQStats(traceId);

      expect(stats.total).toBe(1);
      expect(stats.byEvent).toEqual({
        'order.created': 1,
      });
    });

    it('should return empty statistics when there is no store', async () => {
      const busWithoutStore = new EventBus();

      const stats = await busWithoutStore.getDLQStats();

      expect(stats).toEqual({
        byEvent: {},
        newest: null,
        oldest: null,
        total: 0,
      });
    });

    it('should handle storage exceptions correctly', async () => {
      // Create a mock store that throws errors
      const faultyStore = {
        clear: () => Promise.resolve(),
        delete: () => Promise.resolve(),
        load: () => Promise.reject(new Error('Database error')),
        loadByName: () => Promise.resolve([]),
        loadByTimeRange: () => Promise.reject(new Error('Database error')),
        save: () => Promise.resolve(),
      };

      const busWithFaultyStore = new EventBus(faultyStore as any);

      // Should return empty statistics instead of throwing an error
      const stats = await busWithFaultyStore.getDLQStats();

      expect(stats).toEqual({
        byEvent: {},
        newest: null,
        oldest: null,
        total: 0,
      });
    });

    it('should correctly sort records (by timestamp descending)', async () => {
      const traceId = 'trace_sort_test';
      const now = Date.now();

      const records = [
        {
          context: {},
          error: new Error('Failure'),
          id: 'dlq_1',
          name: 'event.old',
          result: null,
          state: EventState.DeadLetter,
          timestamp: now - 10000,
          traceId,
          version: 1,
        },
        {
          context: {},
          error: new Error('Failure'),
          id: 'dlq_2',
          name: 'event.new',
          result: null,
          state: EventState.DeadLetter,
          timestamp: now - 1000,
          traceId,
          version: 1,
        },
        {
          context: {},
          error: new Error('Failure'),
          id: 'dlq_3',
          name: 'event.middle',
          result: null,
          state: EventState.DeadLetter,
          timestamp: now - 5000,
          traceId,
          version: 1,
        },
      ];

      for (const record of records) {
        await store.save(record);
      }

      const stats = await bus.getDLQStats(traceId);

      // Verify statistics
      expect(stats.total).toBe(3);
      expect(stats.oldest).toEqual(new Date(now - 10000));
      expect(stats.newest).toEqual(new Date(now - 1000));
      expect(stats.byEvent).toEqual({
        'event.middle': 1,
        'event.new': 1,
        'event.old': 1,
      });
    });
  });
});

/**
 * EventTask.
 *
 * @author dafengzhen
 */
describe('EventTask', () => {
  it('runs successfully', async () => {
    const task = new EventTask(async () => 'done');
    const result = await task.run();
    expect(result).toBe('done');
    expect(task.state).toBe(EventState.Succeeded);
  });

  it('fails without retry', async () => {
    const task = new EventTask(
      () => {
        throw new Error('fail');
      },
      { retries: 1 },
    );
    await expect(task.run()).rejects.toThrow('fail');
    expect(task.state).toBe(EventState.Failed);
  });

  it('retries and succeeds', async () => {
    let attempt = 0;
    const task = new EventTask(
      () => {
        attempt++;
        if (attempt < 2) {
          throw new Error('first fail');
        }
        return 'ok';
      },
      { retries: 2 },
    );

    const result = await task.run();
    expect(result).toBe('ok');
    expect(task.state).toBe(EventState.Succeeded);
  });

  it('timeout inside task', async () => {
    const task = new EventTask(() => new Promise((res) => setTimeout(res, 50)), { timeout: 10 });
    await expect(task.run()).rejects.toBeInstanceOf(EventTimeoutError);
    expect(task.state).toBe(EventState.Timeout);
  });

  it('cancel before run', async () => {
    const task = new EventTask(() => 'never');
    task.cancel();
    await expect(task.run()).rejects.toBeInstanceOf(EventCancelledError);
    expect(task.state).toBe(EventState.Cancelled);
  });

  it('cancel during run', async () => {
    const task = new EventTask(async () => {
      task.cancel();
      return 'x';
    });
    await expect(task.run()).rejects.toBeInstanceOf(EventCancelledError);
    expect(task.state).toBe(EventState.Failed);
  });

  it('onStateChange callback invoked', async () => {
    const cb = vi.fn().mockImplementation(() => {
      throw new Error('ignored');
    });
    const task = new EventTask(() => 'ok', { onStateChange: cb });
    await task.run();
    expect(cb).toHaveBeenCalled();
  });
});
