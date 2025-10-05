import type { EventContext, EventMap } from '../types.ts';

import { genId, now } from '../utils.ts';

/**
 * ContextNormalizer.
 *
 * @author dafengzhen
 */
export class ContextNormalizer<EM extends EventMap> {
  normalize<K extends keyof EM>(eventName: K, context: EventContext<EM[K]> = {}): EventContext<EM[K]> {
    const { name = String(eventName), timestamp = now(), traceId = genId('trace'), version = 1, ...rest } = context;
    return { name, timestamp, traceId, version, ...rest };
  }
}
