import type { RetryStrategyOptions } from '../types.ts';

import { withRetry } from './with-retry.ts';
import { withTimeout } from './with-timeout.ts';

export async function executeWithStrategy<T>(fn: () => Promise<T>, options: RetryStrategyOptions = {}): Promise<T> {
  const { onTimeout, timeoutMs = 10000, ...retryOptions } = options;
  const fnWithTimeout = () => withTimeout(fn, timeoutMs, onTimeout);
  return withRetry(fnWithTimeout, retryOptions);
}
