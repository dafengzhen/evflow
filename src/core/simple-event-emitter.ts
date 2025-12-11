import type { BaseEventDefinitions } from './types.ts';

import { AbstractEventEmitter } from './abstract-event-emitter.ts';

/**
 * SimpleEventEmitter.
 *
 * @author dafengzhen
 */
export class SimpleEventEmitter<T extends BaseEventDefinitions>
  extends AbstractEventEmitter<T> {
}