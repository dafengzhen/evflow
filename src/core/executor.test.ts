import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RetryStrategyOptions } from '../types.ts';

import { executeWithStrategy } from './executor.ts';

describe('executeWithStrategy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('should combine timeout and retry', async () => {
    const mockFn = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('mock error')), 200);
          }),
      )
      .mockResolvedValueOnce('success');

    const options: RetryStrategyOptions = {
      maxRetries: 2,
      onRetry: vi.fn(),
      onTimeout: vi.fn(),
      timeoutMs: 100,
    };

    const resultPromise = executeWithStrategy(mockFn, options);

    await vi.advanceTimersByTimeAsync(100);
    expect(options.onTimeout).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);

    await expect(resultPromise).resolves.toBe('success');
    expect(options.onRetry).toHaveBeenCalledWith(1, new Error('Timeout.'));
  });

  it('should use default timeout and retry settings', async () => {
    const mockFn = vi.fn().mockResolvedValue('ok');
    await expect(executeWithStrategy(mockFn)).resolves.toBe('ok');
  });
});
