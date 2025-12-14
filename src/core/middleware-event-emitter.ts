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
export class MiddlewareEventEmitter<T extends BaseEventDefinitions> extends AbstractEventEmitter<T> implements MiddlewareSupport<T> {
  private middlewareCounter = 0;

  private middlewares: EventMiddleware<T>[] = [];

  public override async emit<K extends EventName<T>>(
    eventName: K,
    payload?: EventPayload<T, K>,
    options?: EmitOptions
  ): Promise<void> {
    await this.ensureInitialized();

    const execOptions = options as ExecOptions | undefined;

    const ctx: EventContext<T> = {
      emitter: this,
      eventName,
      options: execOptions,
      payload,
      state: {}
    };

    const middlewareChain = this.createMiddlewareChain(ctx, execOptions);

    await middlewareChain();
  }

  public getMiddlewareCount(): number {
    return this.middlewares.length;
  }

  public use(middleware: EventMiddleware<T>): () => void {
    this.validateMiddleware(middleware);

    this.middlewares.push(middleware);
    ++this.middlewareCounter;

    return () => {
      const index = this.middlewares.findIndex(m => m === middleware);
      if (index !== -1) {
        this.middlewares.splice(index, 1);
      }
    };
  }

  protected override async onClear(): Promise<void> {
    await super.onClear?.();
    this.middlewares = [];
  }

  protected override async onDestroy(): Promise<void> {
    await super.onDestroy?.();
    this.middlewares = [];
    this.middlewareCounter = 0;
  }

  private composeMiddlewares(
    middlewares: EventMiddleware<T>[],
    finalHandler: () => Promise<void>
  ): (ctx: EventContext<T>) => Promise<void> {
    return async (ctx: EventContext<T>) => {
      let index = -1;

      const dispatch = async (i: number): Promise<void> => {
        if (i <= index) {
          throw new Error('next() called multiple times in middleware');
        }

        index = i;

        const fn = i === middlewares.length
          ? finalHandler
          : middlewares[i];

        if (!fn) {
          return Promise.resolve();
        }

        try {
          if (i === middlewares.length) {
            return await (fn as () => Promise<void>)();
          }

          return await (fn as EventMiddleware<T>)(ctx, () => dispatch(i + 1));
        } catch (error) {
          return Promise.reject(error);
        }
      };

      return await dispatch(0);
    };
  }

  private createMiddlewareChain(
    ctx: EventContext<T>,
    execOptions?: ExecOptions
  ): () => Promise<void> {
    const middlewares = [...this.middlewares];

    const executeListeners = async () => {
      await super.executeEmission(ctx.eventName, ctx.payload, (execOptions ?? {}) as ExecOptions);
    };

    const composed = this.composeMiddlewares(middlewares, executeListeners);

    return () => composed(ctx);
  }

  private validateMiddleware(middleware: EventMiddleware<T>): void {
    if (typeof middleware !== 'function') {
      throw new TypeError('Middleware must be a function.');
    }

    if (middleware.length !== 2) {
      throw new TypeError('Middleware must accept exactly 2 parameters (ctx, next).');
    }
  }
}