import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventContext } from './types.ts';

import { EventCancelledError } from './event-cancelled-error.ts';
import { EventTimeoutError } from './event-timeout-error.ts';
import { InMemoryEventStore } from './in-memory-event-store.js';
import { EventBus, EventTask } from './index.js';
import { EventState } from './types.ts';

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

    const records = await store.loadByName('foo');
    expect(records.length).toBe(1);
    expect(records[0].error.message).toBe('fail persist');
    expect(records[0].state).toBe(EventState.Failed);
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
    expect(results[0].error.message).toBe('Permission denied');

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
    expect(task.state).toBe(EventState.Running);
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
