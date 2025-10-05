import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DLQManager, HandlerManager } from '../manager/index.ts';
import type { EventContext, EventHandler } from '../types.ts';

import { HandlerExecutor } from './handler-executor.ts';

/**
 * HandlerExecutor.
 *
 * @author dafengzhen
 */
describe('HandlerExecutor', () => {
  let handlerManager: HandlerManager<any>;
  let dlqManager: DLQManager;
  let errorHandler: (err: Error, ctx: any, type: string) => void;
  let executor: HandlerExecutor<any>;

  beforeEach(() => {
    handlerManager = {
      getMiddlewares: vi.fn().mockReturnValue([]),
    } as any;

    dlqManager = {
      moveToDLQ: vi.fn().mockResolvedValue(undefined),
    } as any;

    errorHandler = vi.fn();

    executor = new HandlerExecutor(handlerManager, dlqManager, { handle: errorHandler } as any);
  });

  it('should execute handlers and return results', async () => {
    const handlers: EventHandler[] = [vi.fn(async () => 'result1'), vi.fn(() => 'result2')];
    const context: EventContext = { id: 'id1', name: 'test', traceId: 'trace1' };

    const results = await executor.executeHandlers(handlers, context);

    expect(results).toHaveLength(2);
    expect(results[0].result).toBe('result1');
    expect(results[1].result).toBe('result2');
    expect(handlers[0]).toHaveBeenCalled();
    expect(handlers[1]).toHaveBeenCalled();
  });

  it('should run middlewares in order', async () => {
    const order: string[] = [];
    handlerManager.getMiddlewares = vi.fn().mockReturnValue([
      async (ctx: any, next: any) => {
        order.push('m1');
        const r = await next();
        order.push('m1-end');
        return r;
      },
      async (ctx: any, next: any) => {
        order.push('m2');
        const r = await next();
        order.push('m2-end');
        return r;
      },
    ]);

    const handlers: EventHandler[] = [
      async () => {
        order.push('handler');
        return 'ok';
      },
    ];
    const context: EventContext = { id: 'id2', name: 'test', traceId: 'trace2' };

    const results = await executor.executeHandlers(handlers, context);

    expect(results[0].result).toBe('ok');
    expect(order).toEqual(['m1', 'm2', 'handler', 'm2-end', 'm1-end']);
  });

  it('should move to DLQ on error', async () => {
    const error = new Error('fail');
    const handlers: EventHandler[] = [
      async () => {
        throw error;
      },
    ];
    const context: EventContext = { id: 'id3', name: 'test', traceId: 'trace3' };

    const results = await executor.executeHandlers(handlers, context);

    expect(results[0].error).toBe(error);
    expect(dlqManager.moveToDLQ).toHaveBeenCalled();
  });

  it('should respect parallel limit', async () => {
    const handlers: EventHandler[] = [
      async () => {
        await new Promise((r) => setTimeout(r, 50));
        return 'a';
      },
      async () => {
        await new Promise((r) => setTimeout(r, 50));
        return 'b';
      },
      async () => 'c',
    ];
    const context: EventContext = { id: 'id4', name: 'test', traceId: 'trace4' };

    const start = Date.now();
    const results = await executor.executeHandlers(handlers, context, undefined, {
      maxConcurrency: 2,
      parallel: true,
    } as any);
    const duration = Date.now() - start;

    expect(results.map((r) => r.result)).toEqual(['a', 'b', 'c']);
    expect(duration).toBeGreaterThanOrEqual(50); // concurrency = 2, so ~50ms
    expect(duration).toBeLessThan(100);
  });

  it('should stop on error when stopOnError=true', async () => {
    const handlers: EventHandler[] = [
      async () => 'ok1',
      async () => {
        throw new Error('fail');
      },
      async () => 'ok3',
    ];
    const context: EventContext = { id: 'id5', name: 'test', traceId: 'trace5' };

    const results = await executor.executeHandlers(handlers, context, undefined, {
      parallel: false,
      stopOnError: true,
    } as any);

    expect(results).toHaveLength(2);
    expect(results[0].result).toBe('ok1');
    expect(results[1].error).toBeInstanceOf(Error);
  });
});
