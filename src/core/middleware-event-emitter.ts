import type {
	BaseEventDefinitions,
	EmitOptions,
	EventContext,
	EventMiddleware,
	EventName,
	EventPayload,
	ExecOptions,
	MiddlewareSupport
} from './types.ts';

import { AbstractEventEmitter } from './abstract-event-emitter.ts';

/**
 * MiddlewareEventEmitter.
 *
 * @author dafengzhen
 */
export class MiddlewareEventEmitter<T extends BaseEventDefinitions>
  extends AbstractEventEmitter<T>
  implements MiddlewareSupport<T> {
  private middlewares: EventMiddleware<T>[] = [];

  async emit<K extends EventName<T>>(
    eventName: K,
    payload?: EventPayload<T, K>,
    options?: EmitOptions
  ): Promise<void> {
    await this.initialize();

    const execOptions = options as ExecOptions | undefined;
    const ctx: EventContext<T> = {
      emitter: this,
      eventName,
      options: execOptions,
      payload,
      state: {}
    };

    const runListeners = async () => {
      await this.runAllListeners(eventName, ctx.payload, execOptions);
    };

    const chain = this.middlewares.slice();
    const fn = this.composeMiddlewares(chain, runListeners);
    await fn(ctx);
  }

  use(middleware: EventMiddleware<T>): () => void {
    this.middlewares.push(middleware);

    let disposed = false;
    return () => {
      if (disposed) {
        return;
      }

      disposed = true;

      const idx = this.middlewares.indexOf(middleware);
      if (idx >= 0) {
        this.middlewares.splice(idx, 1);
      }
    };
  }

  protected override onDestroy(): void {
    this.middlewares = [];
  }

  private composeMiddlewares(
    middlewares: EventMiddleware<T>[],
    last: () => Promise<void>
  ): (ctx: EventContext<T>) => Promise<void> {
    return (ctx) => {
      let index = -1;

      const dispatch = (i: number): Promise<void> => {
        if (i <= index) {
          return Promise.reject(new Error('next() called multiple times.'));
        }
        index = i;

        let fn: (() => Promise<void>) | EventMiddleware<T> | undefined =
          middlewares[i];

        if (i === middlewares.length) {
          fn = last;
        }

        if (!fn) {
          return Promise.resolve();
        }

        try {
          if (fn === last) {
            return (fn as () => Promise<void>)();
          }

          return fn(ctx, () => dispatch(i + 1));
        } catch (err) {
          return Promise.reject(err);
        }
      };

      return dispatch(0);
    };
  }
}
