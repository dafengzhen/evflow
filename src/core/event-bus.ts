import type { BaseEventDefinitions, Ctor, EventBusOptions, MatchSupport, MiddlewareSupport } from './types.ts';

import { AbstractEventEmitter } from './abstract-event-emitter.ts';
import { WithMiddleware } from './with-middleware.ts';
import { WithWildcard } from './with-wildcard.ts';

export class EventBus
  extends WithMiddleware(
    WithWildcard<any, any>(
      AbstractEventEmitter as any
    )
  ) {
}

export function createEventBus<T extends BaseEventDefinitions>(
  options: EventBusOptions = {}
): AbstractEventEmitter<T> &
  Partial<MatchSupport<T>> &
  Partial<MiddlewareSupport<T>> {
  let Base: Ctor<AbstractEventEmitter<T>> = AbstractEventEmitter as any;

  if (options.wildcard) {
    Base = WithWildcard<T, typeof Base>(Base as any) as any;
  }
  if (options.middleware) {
    Base = WithMiddleware<T, typeof Base>(Base as any) as any;
  }

  return new Base();
}
