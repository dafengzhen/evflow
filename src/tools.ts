import type { EmitOptions, EventContext, EventContextKeys, EventRecord, EventStore, PlainObject } from './types.ts';

/**
 * Standard keys that belong to the EventContext object.
 * Any property outside this set is treated as a custom property.
 */
export const EVENT_CONTEXT_STANDARD_KEYS: Set<EventContextKeys> = new Set([
  'broadcast',
  'broadcastChannels',
  'broadcastId',
  'broadcastSource',
  'disableAutoDLQ',
  'excludeSelf',
  'id',
  'maxRequeue',
  'meta',
  'name',
  'parentId',
  'receivedAt',
  'requeueCount',
  'timestamp',
  'traceId',
  'version',
]);

/**
 * Checks if a given key is a standard EventContext key.
 *
 * @param key - The property name to check.
 * @returns True if the key is part of EventContext, otherwise false.
 */
export const isStandardContextKey = (key: string): key is EventContextKeys => {
  return EVENT_CONTEXT_STANDARD_KEYS.has(key as EventContextKeys);
};

/**
 * Separates standard EventContext properties from custom ones.
 * Custom properties are merged into the `meta` field.
 *
 * @param context - The input event context.
 * @returns A normalized EventContext object containing standard properties and merged meta.
 */
export const separateContextProperties = <T extends PlainObject>(context: EventContext<T>): EventContext<T> => {
  if (!context || typeof context !== 'object') {
    return { meta: {} as T };
  }

  const standardProps: Partial<EventContext<T>> = {};
  const customProps: PlainObject = {};

  for (const [key, value] of Object.entries(context)) {
    if (isStandardContextKey(key)) {
      (standardProps as any)[key] = value;
    } else {
      customProps[key] = value;
    }
  }

  if (Object.keys(customProps).length > 0) {
    standardProps.meta = {
      ...(standardProps.meta ?? {}),
      ...customProps,
    } as T;
  }

  return standardProps as EventContext<T>;
};

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
