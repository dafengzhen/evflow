import { AbstractEventEmitter } from './abstract-event-emitter.ts';
import { WithWildcard } from './with-wildcard.ts';

export class WildcardEventEmitter
  extends WithWildcard(
    AbstractEventEmitter as any
  ) {
}