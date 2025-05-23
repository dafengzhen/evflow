import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withTimeout } from './with-timeout';

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should resolve if function completes before timeout', async () => {
    const fastFn = () => new Promise((resolve) => setTimeout(() => resolve('success'), 100));
    const result = withTimeout(fastFn, 200);
    vi.advanceTimersByTime(100);
    await expect(result).resolves.toBe('success');
  });

  it('should reject with timeout error and trigger onTimeout', async () => {
    const onTimeout = vi.fn();
    const slowFn = () => new Promise((resolve) => setTimeout(resolve, 200));
    const result = withTimeout(slowFn, 100, onTimeout);
    vi.advanceTimersByTime(100);
    await expect(result).rejects.toThrow('Timeout.');
    expect(onTimeout).toHaveBeenCalled();
  });

  it('should clear timeout if function completes early', async () => {
    const timeoutSpy = vi.spyOn(global, 'clearTimeout');
    const fastFn = () => Promise.resolve('done');
    await withTimeout(fastFn, 100);
    expect(timeoutSpy).toHaveBeenCalled();
  });

  it('should reject with error from onTimeout callback', async () => {
    const error = new Error('onTimeout internal error');
    const onTimeout = vi.fn().mockRejectedValue(error);

    const eternalFn = () => new Promise((resolve) => setTimeout(resolve, 999999));

    const resultPromise = withTimeout(eternalFn, 100, onTimeout);
    vi.advanceTimersByTime(100);

    await expect(resultPromise).rejects.toThrow(error);
    expect(onTimeout).toHaveBeenCalled();
  });

  it('should handle sync errors in onTimeout', async () => {
    const error = new Error('sync error');
    const onTimeout = vi.fn().mockImplementation(() => {
      throw error;
    });

    const resultPromise = withTimeout(() => new Promise((resolve) => setTimeout(resolve, 200)), 100, onTimeout);

    vi.advanceTimersByTime(100);
    await expect(resultPromise).rejects.toThrow(error);
  });
});
