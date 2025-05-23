import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withRetry } from './with-retry';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('should succeed on first attempt', async () => {
    const mockFn = vi.fn().mockResolvedValue('success');
    await expect(withRetry(mockFn)).resolves.toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should retry and succeed', async () => {
    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('failed'))
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValue('success');

    const onRetry = vi.fn();
    const result = withRetry(mockFn, { maxRetries: 3, onRetry });

    await vi.advanceTimersToNextTimerAsync();
    await vi.advanceTimersToNextTimerAsync();

    await expect(result).resolves.toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('should throw after max retries', async () => {
    const error = new Error('persistent error');
    const mockFn = vi.fn().mockRejectedValue(error);
    const onRetry = vi.fn();

    let caughtError: unknown;

    const resultPromise = withRetry(mockFn, { maxRetries: 2, onRetry }).catch((err) => {
      caughtError = err;
    });

    await vi.runAllTimersAsync();

    await resultPromise;

    expect(caughtError).toBe(error);
    expect(mockFn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('should use custom backoff function', async () => {
    const mockBackoff = vi.fn().mockImplementation((n) => n * 100);
    const mockFn = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValue('success');

    void withRetry(mockFn, { backoffFn: mockBackoff });
    await vi.advanceTimersByTimeAsync(100); // 1 * 100
    expect(mockBackoff).toHaveBeenCalledWith(1);
  });
});
