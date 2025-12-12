import type { AbstractConstructor, BaseEventDefinitions, WildcardEventEmitter } from './types.ts';

import { AbstractEventEmitter } from './abstract-event-emitter.ts';
import { WithWildcard } from './with-wildcard.ts';

export const createWildcardEventEmitter = <T extends BaseEventDefinitions>(): WildcardEventEmitter<T> => {
  class WildcardEventEmitterImpl extends WithWildcard<T>()(
    AbstractEventEmitter as AbstractConstructor<AbstractEventEmitter<T>>,
  ) {}

  return new WildcardEventEmitterImpl();
};

export const defineWildcardEventEmitter = <T extends BaseEventDefinitions>() => {
  return class WildcardEventEmitter extends WithWildcard<T>()(
    AbstractEventEmitter as AbstractConstructor<AbstractEventEmitter<T>>,
  ) {};
};
