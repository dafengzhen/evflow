import type { EmitOptions, EventRecord, EventStore } from './types.ts';

/**
 * Default emit options used when no options are provided.
 */
export const DEFAULT_EMIT_OPTIONS: Required<EmitOptions> = {
  globalTimeout: 0,
  parallel: true,
  stopOnError: false,
};

/**
 * Returns the current timestamp in milliseconds.
 */
export const now = (): number => Date.now();

/**
 * Generates a unique identifier string.
 *
 * @param prefix - Optional prefix for the generated ID. Defaults to "id".
 * @returns A unique identifier string.
 */
export const genId = (prefix = 'id'): string => `${prefix}_${now()}_${Math.random().toString(36).slice(2, 9)}`;

/**
 * Safely saves an event record into the store.
 * If the store is undefined or the operation fails, it is silently ignored.
 *
 * @param store - The event store implementation.
 * @param rec - The event record to save.
 */
export const safeStoreSave = async (store: EventStore | undefined, rec: EventRecord): Promise<void> => {
  if (!store) {
    return;
  }

  try {
    await store.save(rec);
  } catch (err) {
    console.warn('store.save failed (ignored):', err);
  }
};
