import type { EventBus, EventBusFactory, EventBusOptions, EventMap, PlainObject } from '../types/types.ts';

import { EventBusImpl } from './event-bus.ts';

export const EventBusFactoryImpl: EventBusFactory = {
  create<EM extends EventMap = Record<string, never>, GC extends PlainObject = Record<string, never>>(
    options?: EventBusOptions<EM, GC>,
  ): EventBus<EM, GC> {
    return new EventBusImpl<EM, GC>(options);
  },
};
