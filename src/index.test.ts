import { describe, expect, it, vi } from 'vitest';

import { EventCancelledError } from './event-cancelled-error.ts';
import { EventTimeoutError } from './event-timeout-error.ts';
import { EventBus, EventTask } from './index.js';
import { EventState } from './types.ts';

type Events = {
  bar: { x: number };
  foo: { msg: string };
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
