import { describe, expect, it, vi } from 'vitest';

import { EventState } from '../enums.ts';
import { EventCancelledError, EventTimeoutError } from '../errors.ts';
import { EventTask } from './event-task.ts';

/**
 * EventTask.
 *
 * @author dafengzhen
 */
describe('EventTask', () => {
  it('should run a task successfully', async () => {
    const handler = vi.fn().mockResolvedValue('result');
    const task = new EventTask(handler, { retries: 2 });

    const result = await task.run();

    expect(result).toBe('result');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(task.state).toBe(EventState.Succeeded);
    expect(task.attempts).toBe(1);
  });

  it('should retry on failure and eventually succeed', async () => {
    const handler = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValueOnce('success');

    const task = new EventTask(handler, {
      retries: 2,
      retryDelay: 10,
    });

    const result = await task.run();

    expect(result).toBe('success');
    expect(handler).toHaveBeenCalledTimes(2);
    expect(task.state).toBe(EventState.Succeeded);
    expect(task.attempts).toBe(2);
  });

  it('should fail after max retries', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('fail'));
    const task = new EventTask(handler, {
      retries: 1,
      retryDelay: 10,
    });

    await expect(task.run()).rejects.toThrow('fail');
    expect(handler).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
    expect(task.state).toBe(EventState.Failed);
    expect(task.attempts).toBe(2);
  });

  it('should handle cancellation', async () => {
    const handler = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));
    const task = new EventTask(handler, { retries: 0 });

    const promise = task.run();
    task.cancel();

    await expect(promise).rejects.toBeInstanceOf(EventCancelledError);
    expect(task.state).toBe(EventState.Cancelled);
  });

  it('should timeout if handler takes too long', async () => {
    const handler = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));

    const task = new EventTask(handler, { timeout: 20 });

    await expect(task.run()).rejects.toBeInstanceOf(EventTimeoutError);
    expect(task.state).toBe(EventState.Timeout);
  });

  it('should call onStateChange callback on state changes', async () => {
    const onStateChange = vi.fn();
    const handler = vi.fn().mockResolvedValue('ok');

    const task = new EventTask(handler, { onStateChange });

    await task.run();

    expect(onStateChange).toHaveBeenCalled();
    expect(onStateChange.mock.calls.some((c) => c[0] === EventState.Running)).toBe(true);
    expect(onStateChange.mock.calls.some((c) => c[0] === EventState.Succeeded)).toBe(true);
  });

  it('should cleanup the task properly', async () => {
    const onStateChange = vi.fn();
    const handler = vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));

    const task = new EventTask(handler, { onStateChange });

    task.cleanup();

    expect((task as any).isAborted).toBe(true);
    expect((task as any).isDestroyed).toBe(true);

    await expect(task.run()).rejects.toBeInstanceOf(EventCancelledError);
    expect(onStateChange).toHaveBeenCalledWith(EventState.Cancelled, expect.anything());
  });
});
