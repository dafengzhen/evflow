import type { RetryStrategyOptions } from "../types.ts";

export async function withRetry<T>(
  fn: () => Promise<T>,
  {
    backoffFn = (n: number) => 100 * Math.pow(2, n),
    maxRetries = 3,
    onRetry,
  }: RetryStrategyOptions = {},
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (e) {
      attempt++;
      if (attempt > maxRetries) {
        throw e;
      }
      if (onRetry) {
        await onRetry(attempt, e as Error);
      }
      await new Promise((res) => setTimeout(res, backoffFn(attempt)));
    }
  }
}
