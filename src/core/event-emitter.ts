import type {
  AbstractConstructor,
  BaseEventDefinitions,
  BuilderState,
  BuiltEmitter,
  MatchSupport,
  MiddlewareSupport,
} from './types.ts';

import { AbstractEventEmitter } from './abstract-event-emitter.ts';
import { WithMiddleware } from './with-middleware.ts';
import { WithWildcard } from './with-wildcard.ts';

/**
 * createEventEmitter.
 *
 * @author dafengzhen
 */
export const createEventEmitter = <T extends BaseEventDefinitions, S extends BuilderState = object>(
  options?: S,
): BuiltEmitter<T, S> => {
  const { middleware = false, wildcard = false } = options ?? {};

  let CurrentClass = AbstractEventEmitter as AbstractConstructor<AbstractEventEmitter<T>>;

  if (middleware) {
    CurrentClass = WithMiddleware<T>()(CurrentClass);
  }

  if (wildcard) {
    CurrentClass = WithWildcard<T>()(CurrentClass);
  }

  class CustomEventEmitter extends CurrentClass {}

  return new CustomEventEmitter() as BuiltEmitter<T, S>;
};

/**
 * defineEventEmitterClass.
 *
 * @author dafengzhen
 */
export const defineEventEmitterClass = <T extends BaseEventDefinitions>(
  options: {
    middleware?: boolean;
    wildcard?: boolean;
  } = {},
): AbstractConstructor<AbstractEventEmitter<T> & Partial<MatchSupport<T>> & Partial<MiddlewareSupport<T>>> => {
  const { middleware = false, wildcard = false } = options;

  let CurrentClass = AbstractEventEmitter as AbstractConstructor<AbstractEventEmitter<T>>;

  if (middleware) {
    CurrentClass = WithMiddleware<T>()(CurrentClass);
  }

  if (wildcard) {
    CurrentClass = WithWildcard<T>()(CurrentClass);
  }

  return CurrentClass as AbstractConstructor<
    AbstractEventEmitter<T> & Partial<MatchSupport<T>> & Partial<MiddlewareSupport<T>>
  >;
};
