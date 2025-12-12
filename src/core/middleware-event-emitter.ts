import type { AbstractConstructor, BaseEventDefinitions, MiddlewareEventEmitter } from './types.ts';

import { AbstractEventEmitter } from './abstract-event-emitter.ts';
import { WithMiddleware } from './with-middleware.ts';

export const createMiddlewareEventEmitter = <T extends BaseEventDefinitions>(): MiddlewareEventEmitter<T> => {
  class MiddlewareEventEmitterImpl extends WithMiddleware<T>()(
    AbstractEventEmitter as AbstractConstructor<AbstractEventEmitter<T>>
  ) {
  }

  return new MiddlewareEventEmitterImpl();
};

export const defineMiddlewareEventEmitter = <T extends BaseEventDefinitions>() => {
  return class MiddlewareEventEmitter extends WithMiddleware<T>()(
    AbstractEventEmitter as AbstractConstructor<AbstractEventEmitter<T>>
  ) {
  };
};
