import type { Middleware, MiddlewareContext } from '../types.ts';

export class MiddlewarePipeline {
  private middleware: Middleware[] = [];

  clear(): void {
    this.middleware = [];
  }

  async execute(ctx: MiddlewareContext, final: () => Promise<void>): Promise<void> {
    let index = this.middleware.length - 1;
    let next = final;

    while (index >= 0) {
      const current = this.middleware[index];
      const prevNext = next;

      next = (() => {
        let called = false;
        return async () => {
          const wrappedNext = async () => {
            if (called) {
              throw new Error('next() called multiple times.');
            }
            called = true;
            return prevNext();
          };

          return current(ctx, wrappedNext);
        };
      })();

      index--;
    }

    await next();
  }

  use(fn: Middleware): void {
    this.middleware.push(fn);
  }
}
