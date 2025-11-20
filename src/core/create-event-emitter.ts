import type { BaseEventDefinitions } from './event.d.ts';
import { WildcardEventEmitter } from './wildcard-event-emitter.ts';

/**
 * createEventEmitter.
 *
 * @author dafengzhen
 */
export const createEventEmitter = <T extends BaseEventDefinitions>() =>
	new WildcardEventEmitter<T>();
