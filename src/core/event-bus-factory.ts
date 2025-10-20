import type {
	EventBusOptions,
	EventMap,
	IEventBus,
	IEventBusFactory,
	PlainObject,
} from '../types/types.ts';

import { EventBus } from './event-bus.ts';

/**
 * EventBusFactory.
 *
 * @author dafengzhen
 */
export const EventBusFactory: IEventBusFactory = {
	create<EM extends EventMap = EventMap, GC extends PlainObject = PlainObject>(
		options?: EventBusOptions<EM, GC>,
	): IEventBus<EM, GC> {
		return new EventBus<EM, GC>(options);
	},
};
