import type { AbstractEventEmitter } from './abstract-event-emitter.ts';
import type {
  BaseEventDefinitions,
  Ctor,
  EmitOptions,
  EventContext,
  EventMiddleware,
  EventName,
  EventPayload,
  ExecOptions,
  MiddlewareSupport
} from './types.ts';

/**
 * WithMiddleware.
 *
 * @author dafengzhen
 */
export function WithMiddleware<
  TEvents extends BaseEventDefinitions,
  TBase extends Ctor<AbstractEventEmitter<TEvents>>,
>(Base: TBase) {
  return class MiddlewareEmitter
    extends Base
    implements MiddlewareSupport<TEvents> {
    private middlewares: EventMiddleware<TEvents>[] = [];

    async emit<K extends EventName<TEvents>>(
      eventName: K,
      payload?: EventPayload<TEvents, K>,
      options?: EmitOptions
    ): Promise<void> {
      await this.initialize();

      const execOptions = options as ExecOptions | undefined;
      const ctx: EventContext<TEvents> = {
        emitter: this as any,
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

    use(middleware: EventMiddleware<TEvents>): () => void {
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

    protected composeMiddlewares(
      middlewares: EventMiddleware<TEvents>[],
      last: () => Promise<void>
    ): (ctx: EventContext<TEvents>) => Promise<void> {
      return (ctx) => {
        let index = -1;

        const dispatch = (i: number): Promise<void> => {
          if (i <= index) {
            return Promise.reject(new Error('next() called multiple times.'));
          }
          index = i;

          let fn: (() => Promise<void>) | EventMiddleware<TEvents> | undefined =
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

    protected override onDestroy(): Promise<void> | void {
      this.middlewares = [];
      if (super.onDestroy) {
        return super.onDestroy();
      }
    }
  };
}
