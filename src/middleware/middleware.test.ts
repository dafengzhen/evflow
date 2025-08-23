import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { MiddlewareContext } from '../types.ts';

import { Event } from '../core/event.ts';
import { MiddlewarePipeline } from './middleware.ts';

describe('MiddlewarePipeline', () => {
  let pipeline: MiddlewarePipeline;
  const baseContext: MiddlewareContext = {
    deps: [],
    event: new Event('test_event'),
  };
  const mockFinal = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    pipeline = new MiddlewarePipeline();
    vi.clearAllMocks();
  });

  describe('core functionality', () => {
    test('use() should accumulate middleware', () => {
      const mw = vi.fn();
      pipeline.use(mw);
      expect(pipeline['middleware']).toHaveLength(1);
    });

    test('clear() should reset middleware', () => {
      pipeline.use(vi.fn());
      pipeline.clear();
      expect(pipeline['middleware']).toHaveLength(0);
    });
  });

  describe('execute() scenarios', () => {
    test('empty pipeline should directly call final', async () => {
      await pipeline.execute(baseContext, mockFinal);
      expect(mockFinal).toHaveBeenCalledWith();
    });

    test('should execute middleware in FILO order', async () => {
      const execOrder: number[] = [];
      const mw1 = vi.fn(async (_, next) => {
        execOrder.push(1);
        await next();
      });
      const mw2 = vi.fn(async (_, next) => {
        execOrder.push(2);
        await next();
      });

      pipeline.use(mw1);
      pipeline.use(mw2);
      await pipeline.execute(baseContext, mockFinal);

      expect(execOrder).toEqual([1, 2]);
    });

    test('should propagate context mutations', async () => {
      const testMw = vi.fn(async (ctx: MiddlewareContext, next) => {
        ctx.attempt = 3;
        ctx.deps.push('new_dep');
        await next();
      });

      pipeline.use(testMw);
      const context = { ...baseContext };

      await pipeline.execute(context, mockFinal);

      expect(context.deps).toEqual(['new_dep']);
    });

    test('should handle error flow', async () => {
      const errorMw = vi.fn(async (ctx, next) => {
        ctx.error = new Error('Simulated failure');
        await next();
      });
      const observerMw = vi.fn(async (ctx, next) => {
        if (ctx.error) {
          ctx.attempt = (ctx.attempt || 0) + 1;
        }
        await next();
      });

      pipeline.use(errorMw);
      pipeline.use(observerMw);
      const context = { ...baseContext };

      await pipeline.execute(context, mockFinal);

      expect(context.error).toEqual(expect.any(Error));
    });

    test('should bubble middleware errors', async () => {
      const error = new Error('Middleware failure');
      const faultyMw = vi.fn(async () => {
        throw error;
      });

      pipeline.use(faultyMw);
      await expect(pipeline.execute(baseContext, mockFinal)).rejects.toThrow(error);
    });

    test('should handle final function errors', async () => {
      const error = new Error('Final failure');
      const badFinal = vi.fn(() => Promise.reject(error));

      await expect(pipeline.execute(baseContext, badFinal)).rejects.toThrow(error);
    });

    test('should support async context mutation', async () => {
      const asyncMw = vi.fn(async (ctx, next) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        ctx.result = { status: 'processed' };
        await next();
      });

      pipeline.use(asyncMw);
      const context = { ...baseContext };

      await pipeline.execute(context, mockFinal);
      expect(context.result).toEqual({ status: 'processed' });
    });

    test('should short-circuit when not calling next()', async () => {
      const blockMw = vi.fn();
      const shouldNotCall = vi.fn();

      pipeline.use(blockMw);
      pipeline.use(shouldNotCall);

      await pipeline.execute(baseContext, mockFinal);

      expect(blockMw).toHaveBeenCalled();
      expect(shouldNotCall).not.toHaveBeenCalled();
      expect(mockFinal).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    test('should handle empty middleware array', async () => {
      pipeline.use(vi.fn());
      pipeline.clear();
      await pipeline.execute(baseContext, mockFinal);
      expect(mockFinal).toHaveBeenCalled();
    });

    test('should handle multiple next() calls', async () => {
      const duplicateNext = vi.fn(async (_, next) => {
        await next();
        await next(); // second call should throw
      });

      pipeline.use(duplicateNext);
      await expect(pipeline.execute(baseContext, mockFinal)).rejects.toThrow('next() called multiple times');
    });
  });
});
