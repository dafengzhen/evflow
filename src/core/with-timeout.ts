export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = 10000,
  onTimeout?: () => Promise<void>,
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(async () => {
      try {
        if (onTimeout) {
          await onTimeout();
        }

        reject(new Error('Timeout.'));
      } catch (err) {
        reject(err);
      }
    }, timeoutMs);
  });

  try {
    return await Promise.race([fn(), timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}
