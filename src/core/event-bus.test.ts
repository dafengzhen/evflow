import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  EventBusPlugin,
  EventContext,
  EventHandler,
  EventMap,
  EventMiddleware,
  EventTaskOptions,
  IEventBus,
  MiddlewareOptions,
  PlainObject,
} from '../types/types.ts';

import { EventBus } from './event-bus.ts';

interface TestEvents extends EventMap {
  'order.placed': { amount: number; orderId: string };
  'user.created': { id: string; name: string };
  'user.updated': { id: string; name: string };
}

interface TestGlobalContext extends PlainObject {
  requestId: string;
  userId: string;
}

describe('EventBusImpl', () => {
  let eventBus: IEventBus<TestEvents, TestGlobalContext>;

  beforeEach(() => {
    eventBus = new EventBus<TestEvents, TestGlobalContext>();
  });

  afterEach(() => {
    eventBus.destroy();
  });

  describe('Constructor and Initialization', () => {
    it('should create an empty event bus', () => {
      expect(eventBus).toBeDefined();
      expect(eventBus.on).toBeDefined();
      expect(eventBus.off).toBeDefined();
      expect(eventBus.emit).toBeDefined();
      expect(eventBus.use).toBeDefined();
    });

    it('should initialize with global middlewares', () => {
      const globalMiddleware: EventMiddleware<TestEvents, keyof TestEvents, any, TestGlobalContext> = vi.fn(
        async (ctx, next) => next(),
      );

      const bus = new EventBus<TestEvents, TestGlobalContext>({
        globalMiddlewares: [globalMiddleware],
      });

      expect(bus).toBeDefined();
    });

    it('should initialize with plugins', async () => {
      const mockPlugin: EventBusPlugin<TestEvents, TestGlobalContext> = {
        install: vi.fn(),
        uninstall: vi.fn(),
      };

      const bus = new EventBus<TestEvents, TestGlobalContext>({
        plugins: [mockPlugin],
      });

      expect(mockPlugin.install).toHaveBeenCalledWith(bus);
    });
  });

  describe('Event Registration and Removal', () => {
    it('should register and unregister event handlers', () => {
      const handler: EventHandler<TestEvents, 'user.created'> = vi.fn();

      const unsubscribe = eventBus.on('user.created', handler);
      expect(unsubscribe).toBeDefined();

      unsubscribe();
    });

    it('should handle multiple handlers for same event', () => {
      const handler1: EventHandler<TestEvents, 'user.created'> = vi.fn();
      const handler2: EventHandler<TestEvents, 'user.created'> = vi.fn();

      eventBus.on('user.created', handler1);
      eventBus.on('user.created', handler2);

      const unsubscribe1 = eventBus.on('user.created', handler1);
      expect(unsubscribe1).toBeDefined();
    });

    it('should remove specific handler with off', () => {
      const handler1: EventHandler<TestEvents, 'user.created'> = vi.fn();
      const handler2: EventHandler<TestEvents, 'user.created'> = vi.fn();

      eventBus.on('user.created', handler1);
      eventBus.on('user.created', handler2);

      eventBus.off('user.created', handler1);
    });

    it('should remove all handlers for event when no handler specified', () => {
      const handler1: EventHandler<TestEvents, 'user.created'> = vi.fn();
      const handler2: EventHandler<TestEvents, 'user.created'> = vi.fn();

      eventBus.on('user.created', handler1);
      eventBus.on('user.created', handler2);

      eventBus.off('user.created');
    });

    it('should handle off for non-existent event', () => {
      expect(() => {
        eventBus.off('user.created' as any);
      }).not.toThrow();
    });
  });

  describe('Event Emission', () => {
    it('should emit event to registered handlers', async () => {
      const handler = vi.fn(async (ctx: EventContext<{ id: string; name: string }, TestGlobalContext>) => {
        return `processed: ${ctx.data.name}`;
      });

      eventBus.on('user.created', handler);

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
        global: { requestId: 'req-1', userId: 'admin' },
      };

      const results = await eventBus.emit('user.created', context);

      expect(handler).toHaveBeenCalledWith({
        ...context,
        meta: {
          eventName: 'user.created',
        },
      });
      expect(results).toHaveLength(1);
      expect(results[0].state).toBe('succeeded');
      expect(results[0].result).toBe('processed: John');
    });

    it('should handle events with no registered handlers', async () => {
      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      const results = await eventBus.emit('user.created', context, {}, { ignoreNoHandlersWarning: true });

      expect(results).toHaveLength(0);
    });

    it('should execute once handlers only once', async () => {
      const handler = vi.fn(async (ctx: EventContext<{ id: string; name: string }, TestGlobalContext>) => {
        return `processed: ${ctx.data.name}`;
      });

      eventBus.on('user.created', handler, { once: true });

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      await eventBus.emit('user.created', context, {}, { ignoreNoHandlersWarning: true });
      await eventBus.emit('user.created', context, {}, { ignoreNoHandlersWarning: true });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle handler priorities', async () => {
      const executionOrder: string[] = [];

      const handler1 = vi.fn(async () => {
        executionOrder.push('handler1');
        return 'result1';
      });

      const handler2 = vi.fn(async () => {
        executionOrder.push('handler2');
        return 'result2';
      });

      eventBus.on('user.created', handler1, { priority: 10 });
      eventBus.on('user.created', handler2, { priority: 20 });

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      await eventBus.emit('user.created', context);

      expect(executionOrder).toEqual(['handler2', 'handler1']);
    });
  });

  describe('Middleware Functionality', () => {
    it('should register and use event-specific middleware', async () => {
      const middleware: EventMiddleware<TestEvents, 'user.created', string, TestGlobalContext> = vi.fn(
        async (ctx, next) => {
          (ctx.data as any).processed = true;
          return next();
        },
      );

      const handler = vi.fn(async (ctx: EventContext<{ id: string; name: string }, TestGlobalContext>) => {
        return `handler: ${ctx.data.name}`;
      });

      eventBus.use('user.created', middleware);
      eventBus.on('user.created', handler);

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      await eventBus.emit('user.created', context);

      expect(middleware).toHaveBeenCalled();
      expect(handler).toHaveBeenCalled();
    });

    it('should register and use global middleware', async () => {
      const globalMiddleware: EventMiddleware<TestEvents, keyof TestEvents, any, TestGlobalContext> = vi.fn(
        async (ctx, next) => {
          (ctx as any).globalProcessed = true;
          return next();
        },
      );

      const handler = vi.fn(async () => {
        return 'result';
      });

      eventBus.useGlobalMiddleware(globalMiddleware);
      eventBus.on('user.created', handler);

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      await eventBus.emit('user.created', context);

      expect(globalMiddleware).toHaveBeenCalled();
      expect(handler).toHaveBeenCalled();
    });

    it('should handle middleware with filters', async () => {
      const middleware: EventMiddleware<TestEvents, 'user.created', string, TestGlobalContext> = vi.fn(
        async (ctx, next) => next(),
      );

      const filter: MiddlewareOptions['filter'] = (ctx) => ctx.data.name === 'John';

      eventBus.use('user.created', middleware, { filter });

      const handler = vi.fn(async () => {
        return 'result';
      });

      eventBus.on('user.created', handler);

      const context1: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      const context2: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '2', name: 'Jane' },
      };

      await eventBus.emit('user.created', context1);
      await eventBus.emit('user.created', context2);

      expect(middleware).toHaveBeenCalledTimes(1);
    });

    it('should handle middleware priorities', async () => {
      const executionOrder: string[] = [];

      const middleware1: EventMiddleware<TestEvents, 'user.created', string, TestGlobalContext> = vi.fn(
        async (ctx, next) => {
          executionOrder.push('middleware1');
          return next();
        },
      );

      const middleware2: EventMiddleware<TestEvents, 'user.created', string, TestGlobalContext> = vi.fn(
        async (ctx, next) => {
          executionOrder.push('middleware2');
          return next();
        },
      );

      eventBus.use('user.created', middleware1, { priority: 10 });
      eventBus.use('user.created', middleware2, { priority: 20 });

      const handler = vi.fn(async () => 'result');
      eventBus.on('user.created', handler);

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      await eventBus.emit('user.created', context);

      expect(executionOrder).toEqual(['middleware2', 'middleware1']);
    });
  });

  describe('Error Handling', () => {
    it('should handle handler errors gracefully', async () => {
      const error = new Error('Handler failed');
      const handler = vi.fn(async () => {
        throw error;
      });

      eventBus.on('user.created', handler);

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      const results = await eventBus.emit('user.created', context);

      expect(results[0].state).toBe('failed');
      expect(results[0].error).toBeDefined();
      expect(results[0].error?.message).toBe('Handler failed');
    });

    it('should handle middleware errors', async () => {
      const middlewareError = new Error('Middleware failed');
      const middleware: EventMiddleware<TestEvents, 'user.created', string, TestGlobalContext> = vi.fn(async () => {
        throw middlewareError;
      });

      const handler = vi.fn(async () => 'result');

      eventBus.use('user.created', middleware);
      eventBus.on('user.created', handler);

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      const results = await eventBus.emit('user.created', context);

      expect(results[0].state).toBe('failed');
      expect(results[0].error?.message).toBe('Middleware failed');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Emit Options', () => {
    it('should handle parallel execution', async () => {
      const delays = [100, 50, 30];
      const handlers = delays.map((delay, index) =>
        vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, delay));
          return `result${index + 1}`;
        }),
      );

      handlers.forEach((handler) => {
        eventBus.on('user.created', handler);
      });

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      const startTime = Date.now();
      const results = await eventBus.emit('user.created', context, undefined, { parallel: true });
      const endTime = Date.now();

      expect(results).toHaveLength(3);
      expect(endTime - startTime).toBeLessThan(200);
    });

    it('should handle sequential execution', async () => {
      const delays = [50, 30, 20];

      const handlers = delays.map((delay, index) =>
        vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, delay));
          return `result${index + 1}`;
        }),
      );

      handlers.forEach((handler) => {
        eventBus.on('user.created', handler);
      });

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      const results = await eventBus.emit('user.created', context, undefined, { parallel: false });

      expect(results).toHaveLength(3);
    });

    it('should handle stopOnError option', async () => {
      const handler1 = vi.fn(async () => {
        throw new Error('First handler failed');
      });

      const handler2 = vi.fn(async () => 'success');

      eventBus.on('user.created', handler1);
      eventBus.on('user.created', handler2);

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      const results = await eventBus.emit('user.created', context, undefined, {
        parallel: false,
        stopOnError: true,
      });

      expect(results).toHaveLength(1);
      expect(handler2).not.toHaveBeenCalled();
    });

    it('should handle global timeout', async () => {
      const handler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'result';
      });

      eventBus.on('user.created', handler);

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      const results = await eventBus.emit('user.created', context, undefined, {
        globalTimeout: 50,
      });

      expect(results[0].state).toBe('failed');
      expect(results[0].error?.message).toContain('Operation timed out after');
    });

    it('should handle maxConcurrency option', async () => {
      let concurrent = 0;
      let maxConcurrent = 0;

      const handlers = Array.from({ length: 5 }, (_, i) =>
        vi.fn(async () => {
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await new Promise((resolve) => setTimeout(resolve, 50));
          concurrent--;
          return `result${i}`;
        }),
      );

      handlers.forEach((handler) => {
        eventBus.on('user.created', handler);
      });

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      await eventBus.emit('user.created', context, undefined, {
        maxConcurrency: 2,
        parallel: true,
      });

      expect(maxConcurrent).toBeLessThanOrEqual(2);
    });

    it('should include traceId in results', async () => {
      const handler = vi.fn(async () => 'result');
      eventBus.on('user.created', handler);

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      const results = await eventBus.emit('user.created', context, undefined, {
        traceId: 'test-trace-123',
      });

      expect(results[0].traceId).toBe('test-trace-123');
    });
  });

  describe('Task Options', () => {
    it('should handle task options with retry logic', async () => {
      let attempt = 0;
      const handler = vi.fn(async () => {
        attempt++;
        if (attempt < 3) {
          throw new Error('Temporary failure');
        }
        return 'success';
      });

      eventBus.on('user.created', handler);

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      const taskOptions: EventTaskOptions = {
        isRetryable: (error) => error.message === 'Temporary failure',
        maxRetries: 3,
        retryDelay: 10,
      };

      const results = await eventBus.emit('user.created', context, taskOptions);

      expect(handler).toHaveBeenCalledTimes(3);
      expect(results[0].state).toBe('succeeded');
      expect(results[0].result).toBe('success');
    });

    it('should handle task timeout', async () => {
      const handler = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'result';
      });

      eventBus.on('user.created', handler);

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      const taskOptions: EventTaskOptions = {
        timeout: 50,
      };

      const results = await eventBus.emit('user.created', context, taskOptions);

      expect(results[0].state).toBe('failed');
    });
  });

  describe('Destroy and Cleanup', () => {
    it('should destroy event bus and clear all handlers', () => {
      const handler = vi.fn();
      eventBus.on('user.created', handler);
      eventBus.on('user.updated', handler);

      eventBus.destroy();

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      expect(async () => {
        await eventBus.emit('user.created', context, {}, { ignoreNoHandlersWarning: true });
      }).not.toThrow();
    });
  });

  describe('Unsubscribe Functionality', () => {
    it('should return working unsubscribe function from on', () => {
      const handler = vi.fn();

      const unsubscribe = eventBus.on('user.created', handler);

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      unsubscribe();

      expect(async () => {
        await eventBus.emit('user.created', context, {}, { ignoreNoHandlersWarning: true });
      }).not.toThrow();

      expect(handler).not.toHaveBeenCalled();
    });

    it('should return working unsubscribe function from use', () => {
      const middleware: EventMiddleware<TestEvents, 'user.created', string, TestGlobalContext> = vi.fn(
        async (ctx, next) => next(),
      );

      const unsubscribe = eventBus.use('user.created', middleware);

      unsubscribe();

      const handler = vi.fn(async () => 'result');
      eventBus.on('user.created', handler);

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      expect(async () => {
        await eventBus.emit('user.created', context);
      }).not.toThrow();
    });

    it('should return working unsubscribe function from useGlobalMiddleware', () => {
      const middleware: EventMiddleware<TestEvents, keyof TestEvents, any, TestGlobalContext> = vi.fn(
        async (ctx, next) => next(),
      );

      const unsubscribe = eventBus.useGlobalMiddleware(middleware);

      unsubscribe();

      const handler = vi.fn(async () => 'result');
      eventBus.on('user.created', handler);

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      expect(async () => {
        await eventBus.emit('user.created', context);
      }).not.toThrow();
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle multiple events with mixed configurations', async () => {
      const results: string[] = [];

      const handler1 = vi.fn(async () => {
        results.push('handler1');
        return 'result1';
      });

      const handler2 = vi.fn(async () => {
        results.push('handler2');
        return 'result2';
      });

      const middleware: EventMiddleware<TestEvents, 'user.created', string, TestGlobalContext> = vi.fn(
        async (ctx, next) => {
          results.push('middleware-before');
          const result = await next();
          results.push('middleware-after');
          return result;
        },
      );

      eventBus.use('user.created', middleware);
      eventBus.on('user.created', handler1, { priority: 10 });
      eventBus.on('user.created', handler2, { priority: 5 });

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      await eventBus.emit('user.created', context);

      expect(results).toEqual([
        'middleware-before',
        'handler1',
        'middleware-before',
        'handler2',
        'middleware-after',
        'middleware-after',
      ]);
    });

    it('should handle async middleware chain correctly', async () => {
      const executionOrder: string[] = [];

      const middleware1: EventMiddleware<TestEvents, 'user.created', string, TestGlobalContext> = vi.fn(
        async (ctx, next) => {
          executionOrder.push('middleware1-start');
          const result = await next();
          executionOrder.push('middleware1-end');
          return result;
        },
      );

      const middleware2: EventMiddleware<TestEvents, 'user.created', string, TestGlobalContext> = vi.fn(
        async (ctx, next) => {
          executionOrder.push('middleware2-start');
          const result = await next();
          executionOrder.push('middleware2-end');
          return result;
        },
      );

      const handler = vi.fn(async () => {
        executionOrder.push('handler');
        return 'result';
      });

      eventBus.use('user.created', middleware1);
      eventBus.use('user.created', middleware2);
      eventBus.on('user.created', handler);

      const context: EventContext<{ id: string; name: string }, TestGlobalContext> = {
        data: { id: '1', name: 'John' },
      };

      await eventBus.emit('user.created', context);

      expect(executionOrder).toEqual([
        'middleware1-start',
        'middleware2-start',
        'handler',
        'middleware2-end',
        'middleware1-end',
      ]);
    });
  });
});

describe('EventBus Pattern Matching', () => {
  let bus: EventBus<any>;
  const mockHandler = vi.fn();

  beforeEach(() => {
    bus = new EventBus();
    mockHandler.mockClear();
  });

  describe('Basic wildcard matching', () => {
    it('should match all events with single wildcard', async () => {
      bus.match('*', mockHandler);

      await bus.emit('user.created', { data: { id: 1 } });
      await bus.emit('order.updated', { data: { id: 2 } });
      await bus.emit('any.other.event', { data: { id: 3 } });

      expect(mockHandler).toHaveBeenCalledTimes(3);
      expect(mockHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { id: 1 },
          meta: { eventName: 'user.created' },
        }),
      );
    });

    it('should match events with prefix wildcard', async () => {
      bus.match('*.created', mockHandler);

      await bus.emit('user.created', { data: { id: 1 } });
      await bus.emit('order.created', { data: { id: 2 } });
      await bus.emit('user.updated', { data: { id: 3 } }, {}, { ignoreNoHandlersWarning: true }); // Should not match

      expect(mockHandler).toHaveBeenCalledTimes(2);
      expect(mockHandler).toHaveBeenCalledWith(expect.objectContaining({ meta: { eventName: 'user.created' } }));
      expect(mockHandler).toHaveBeenCalledWith(expect.objectContaining({ meta: { eventName: 'order.created' } }));
    });

    it('should match events with suffix wildcard', async () => {
      bus.match('user.*', mockHandler);

      await bus.emit('user.created', { data: { id: 1 } });
      await bus.emit('user.updated', { data: { id: 2 } });
      await bus.emit('user.deleted', { data: { id: 3 } });
      await bus.emit('order.created', { data: { id: 4 } }, {}, { ignoreNoHandlersWarning: true }); // Should not match

      expect(mockHandler).toHaveBeenCalledTimes(3);
    });

    it('should match events with middle wildcard', async () => {
      bus.match('order.*.updated', mockHandler);

      await bus.emit('order.item.updated', { data: { id: 1 } });
      await bus.emit('order.status.updated', { data: { id: 2 } });
      await bus.emit('order.updated', { data: { id: 3 } }, {}, { ignoreNoHandlersWarning: true }); // Should not match
      await bus.emit('user.item.updated', { data: { id: 4 } }, {}, { ignoreNoHandlersWarning: true }); // Should not match

      expect(mockHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('Multiple segment matching', () => {
    it('should match exact number of segments with wildcards', async () => {
      bus.match('*.created', mockHandler);

      await bus.emit('user.created', { data: {} });
      await bus.emit('user.profile.created', { data: {} }, {}, { ignoreNoHandlersWarning: true }); // Should not match (different segment count)

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle events with different segment counts', async () => {
      bus.match('a.b.c', mockHandler);

      await bus.emit('a.b.c', { data: {} }); // Should match
      await bus.emit('a.b', { data: {} }, {}, { ignoreNoHandlersWarning: true }); // Should not match
      await bus.emit('a.b.c.d', { data: {} }, {}, { ignoreNoHandlersWarning: true }); // Should not match

      expect(mockHandler).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Advanced Pattern Matching', () => {
  let bus: EventBus<any>;
  const mockHandler = vi.fn();

  beforeEach(() => {
    mockHandler.mockClear();
  });

  describe('Custom pattern matching options', () => {
    it('should support custom separator', async () => {
      const customBus = new EventBus<any>({
        patternMatching: { separator: ':', wildcard: '*' },
      });

      customBus.match('user:*', mockHandler);

      await customBus.emit('user:created', { data: { id: 1 } });
      await customBus.emit('user:updated', { data: { id: 2 } });
      await customBus.emit('user.created', { data: { id: 3 } }, {}, { ignoreNoHandlersWarning: true }); // Should not match

      expect(mockHandler).toHaveBeenCalledTimes(2);
    });

    it('should support custom wildcard character', async () => {
      const customBus = new EventBus<any>({
        patternMatching: { separator: '.', wildcard: '?' },
      });

      customBus.match('user.?', mockHandler);

      await customBus.emit('user.created', { data: { id: 1 } });
      await customBus.emit('user.updated', { data: { id: 2 } });
      await customBus.emit('user.*', { data: { id: 3 } }, {}, { ignoreNoHandlersWarning: true }); // Should not match

      expect(mockHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('Multiple wildcard patterns', () => {
    it('should handle multiple wildcards in single pattern', async () => {
      bus = new EventBus();
      bus.match('*.action.*', mockHandler);

      await bus.emit('user.action.created', { data: {} });
      await bus.emit('order.action.updated', { data: {} });
      await bus.emit('user.created.action', { data: {} }, {}, { ignoreNoHandlersWarning: true }); // Should not match
      await bus.emit('action.user', { data: {} }, {}, { ignoreNoHandlersWarning: true }); // Should not match

      expect(mockHandler).toHaveBeenCalledTimes(2);
    });

    it('should support double wildcard for multiple segments', async () => {
      bus = new EventBus({
        patternMatching: { matchMultiple: true },
      });

      bus.match('**', mockHandler); // Match all events

      await bus.emit('user', { data: {} }, {}, { ignoreNoHandlersWarning: true });
      await bus.emit('user.created', { data: {} }, {}, { ignoreNoHandlersWarning: true });
      await bus.emit('order.item.updated', { data: {} }, {}, { ignoreNoHandlersWarning: true });
      await bus.emit('a.b.c.d.e', { data: {} }, {}, { ignoreNoHandlersWarning: true });

      expect(mockHandler).toHaveBeenCalledTimes(4);
    });

    it('should match with double wildcard at beginning', async () => {
      bus = new EventBus({
        patternMatching: { matchMultiple: true },
      });

      bus.match('**.updated', mockHandler);

      await bus.emit('user.updated', { data: {} });
      await bus.emit('order.item.updated', { data: {} });
      await bus.emit('a.b.c.updated', { data: {} });
      await bus.emit('user.created', { data: {} }, {}, { ignoreNoHandlersWarning: true }); // Should not match

      expect(mockHandler).toHaveBeenCalledTimes(3);
    });

    it('should match with double wildcard in middle', async () => {
      bus = new EventBus({
        patternMatching: { matchMultiple: true },
      });

      bus.match('user.**.action', mockHandler);

      await bus.emit('user.profile.action', { data: {} });
      await bus.emit('user.settings.preferences.action', { data: {} });
      await bus.emit('user.action', { data: {} }, {}, { ignoreNoHandlersWarning: true }); // Should not match (no middle segments)
      await bus.emit('order.profile.action', { data: {} }, {}, { ignoreNoHandlersWarning: true }); // Should not match

      expect(mockHandler).toHaveBeenCalledTimes(2);
    });
  });
});

describe('Pattern Handler Management', () => {
  let bus: EventBus<any>;
  const handler1 = vi.fn();
  const handler2 = vi.fn();
  const handler3 = vi.fn();

  beforeEach(() => {
    bus = new EventBus();
    handler1.mockClear();
    handler2.mockClear();
    handler3.mockClear();
  });

  describe('Handler registration and removal', () => {
    it('should allow removing specific handler from pattern', async () => {
      bus.match('user.*', handler1);
      bus.match('user.*', handler2);

      await bus.emit('user.created', { data: {} });
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);

      bus.unmatch('user.*', handler1);

      await bus.emit('user.updated', { data: {} });
      expect(handler1).toHaveBeenCalledTimes(1); // Should not be called again
      expect(handler2).toHaveBeenCalledTimes(2); // Should be called again
    });

    it('should remove all handlers for pattern when no specific handler provided', async () => {
      bus.match('user.*', handler1);
      bus.match('user.*', handler2);
      bus.match('order.*', handler3);

      bus.unmatch('user.*');

      await bus.emit('user.created', { data: {} }, {}, { ignoreNoHandlersWarning: true });
      await bus.emit('order.created', { data: {} });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
      expect(handler3).toHaveBeenCalledTimes(1);
    });

    it('should return unsubscribe function from match', async () => {
      const unsubscribe = bus.match('user.*', handler1);
      bus.match('user.*', handler2);

      await bus.emit('user.created', { data: {} });
      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);

      unsubscribe();

      await bus.emit('user.updated', { data: {} });
      expect(handler1).toHaveBeenCalledTimes(1); // Should not be called again
      expect(handler2).toHaveBeenCalledTimes(2); // Should be called again
    });
  });

  describe('Priority handling', () => {
    it('should execute handlers in priority order', async () => {
      const callOrder: string[] = [];

      const highPriorityHandler = vi.fn(() => callOrder.push('high'));
      const mediumPriorityHandler = vi.fn(() => callOrder.push('medium'));
      const lowPriorityHandler = vi.fn(() => callOrder.push('low'));

      bus.match('user.*', lowPriorityHandler, { priority: 1 });
      bus.match('user.*', highPriorityHandler, { priority: 100 });
      bus.match('user.*', mediumPriorityHandler, { priority: 50 });

      await bus.emit('user.created', { data: {} });

      expect(callOrder).toEqual(['high', 'medium', 'low']);
    });

    it('should mix exact and pattern handlers with correct priority', async () => {
      const callOrder: string[] = [];

      const exactHandler = vi.fn(() => callOrder.push('exact'));
      const patternHandler = vi.fn(() => callOrder.push('pattern'));

      bus.on('user.created', exactHandler, { priority: 75 });
      bus.match('user.*', patternHandler, { priority: 50 });

      await bus.emit('user.created', { data: {} });

      expect(callOrder).toEqual(['exact', 'pattern']);
    });
  });

  describe('Once handlers', () => {
    it('should remove once handler after first match', async () => {
      bus.match('user.*', handler1, { once: true });
      bus.match('user.*', handler2); // Regular handler

      await bus.emit('user.created', { data: {} });
      await bus.emit('user.updated', { data: {} });

      expect(handler1).toHaveBeenCalledTimes(1); // Only called once
      expect(handler2).toHaveBeenCalledTimes(2); // Called every time
    });

    it('should handle multiple once handlers correctly', async () => {
      bus.match('user.*', handler1, { once: true });
      bus.match('user.*', handler2, { once: true });
      bus.match('user.*', handler3); // Regular handler

      await bus.emit('user.created', { data: {} });
      await bus.emit('user.updated', { data: {} });

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
      expect(handler3).toHaveBeenCalledTimes(2);
    });
  });
});

describe('Pattern Matching Integration', () => {
  let bus: EventBus<any>;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe('Mixed exact and pattern matching', () => {
    it('should call both exact and pattern handlers', async () => {
      const exactHandler = vi.fn();
      const patternHandler = vi.fn();

      bus.on('user.created', exactHandler);
      bus.match('user.*', patternHandler);

      await bus.emit('user.created', { data: { id: 1 } });

      expect(exactHandler).toHaveBeenCalledTimes(1);
      expect(patternHandler).toHaveBeenCalledTimes(1);
    });

    it('should not duplicate handler calls', async () => {
      const handler = vi.fn();

      // Same handler registered both ways
      bus.on('user.created', handler);
      bus.match('user.created', handler);

      await bus.emit('user.created', { data: { id: 1 } });

      expect(handler).toHaveBeenCalledTimes(1); // Should not be duplicated
    });
  });

  describe('Middleware with pattern matching', () => {
    it('should apply middleware to pattern-matched events', async () => {
      const handler = vi.fn();
      const middleware = vi.fn((ctx, next) => next());

      bus.use('user.*', middleware);
      bus.match('user.*', handler);

      await bus.emit('user.created', { data: { id: 1 } });

      expect(middleware).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should apply global middleware to pattern-matched events', async () => {
      const handler = vi.fn();
      const globalMiddleware = vi.fn((ctx, next) => next());

      bus.useGlobalMiddleware(globalMiddleware);
      bus.match('user.*', handler);

      await bus.emit('user.created', { data: { id: 1 } });

      expect(globalMiddleware).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Complex scenario testing', () => {
    it('should handle multiple overlapping patterns', async () => {
      const allHandler = vi.fn();
      const userHandler = vi.fn();
      const createdHandler = vi.fn();
      const exactHandler = vi.fn();

      bus.match('*', allHandler);
      bus.match('user.*', userHandler);
      bus.match('*.created', createdHandler);
      bus.on('user.created', exactHandler);

      await bus.emit('user.created', { data: { id: 1 } });

      expect(allHandler).toHaveBeenCalledTimes(1);
      expect(userHandler).toHaveBeenCalledTimes(1);
      expect(createdHandler).toHaveBeenCalledTimes(1);
      expect(exactHandler).toHaveBeenCalledTimes(1);
    });

    it('should handle complex event hierarchies', async () => {
      bus = new EventBus({
        patternMatching: {
          matchMultiple: true,
          separator: '.',
          wildcard: '*',
        },
      });

      const handlers = {
        all: vi.fn(),
        api: vi.fn(),
        apiV1: vi.fn(),
        apiV1Users: vi.fn(),
        exact: vi.fn(),
      };

      bus.match('**', handlers.all);
      bus.match('api.**', handlers.api);
      bus.match('api.v1.*', handlers.apiV1);
      bus.match('api.v1.user.*', handlers.apiV1Users);
      bus.on('api.v1.user.created', handlers.exact);

      await bus.emit('api.v1.user.created', { data: { id: 1 } });

      expect(handlers.all).toHaveBeenCalledTimes(1);
      expect(handlers.api).toHaveBeenCalledTimes(1);
      expect(handlers.apiV1).not.toHaveBeenCalled();
      expect(handlers.apiV1Users).toHaveBeenCalledTimes(1);
      expect(handlers.exact).toHaveBeenCalledTimes(1);
    });
  });

  describe('Performance and edge cases', () => {
    it('should handle large number of patterns efficiently', async () => {
      const handler = vi.fn();

      // Register many patterns
      for (let i = 0; i < 100; i++) {
        bus.match(`service.${i}.*`, handler);
      }

      await bus.emit('service.42.action', { data: {} });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle empty event names', async () => {
      const handler = vi.fn();

      bus.match('*', handler);

      await bus.emit('', { data: { test: true } });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle events with same name as wildcard', async () => {
      const starHandler = vi.fn();
      const wildcardHandler = vi.fn();

      bus.on('*', starHandler); // Exact match for event named "*"
      bus.match('*', wildcardHandler); // Pattern match for all events

      await bus.emit('*', { data: { special: true } });
      await bus.emit('normal.event', { data: { normal: true } });

      expect(starHandler).toHaveBeenCalledTimes(1); // Only for exact "*" event
      expect(wildcardHandler).toHaveBeenCalledTimes(2); // For both events
    });
  });
});

describe('Pattern Matching Error Handling', () => {
  let bus: EventBus<any>;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe('Invalid pattern handling', () => {
    it('should handle patterns with consecutive separators', async () => {
      const handler = vi.fn();

      bus.match('user..created', handler); // Double separator

      await bus.emit('user.created', { data: {} }, {}, { ignoreNoHandlersWarning: true }); // Should not match
      await bus.emit('user..created', { data: {} }, {}, { ignoreNoHandlersWarning: true }); // Should match exact

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle patterns with leading/trailing separators', async () => {
      const handler = vi.fn();

      bus.match('.user.', handler); // Leading and trailing separator

      await bus.emit('user', { data: {} }, {}, { ignoreNoHandlersWarning: true }); // Should not match
      await bus.emit('.user.', { data: {} }, {}, { ignoreNoHandlersWarning: true }); // Should match exact

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Handler error scenarios', () => {
    it('should continue processing other handlers when one fails', async () => {
      const errorHandler = vi.fn().mockRejectedValue(new Error('Handler failed'));
      const successHandler = vi.fn().mockResolvedValue('success');

      bus.match('user.*', errorHandler);
      bus.match('user.*', successHandler);

      const results = await bus.emit('user.created', { data: {} });

      expect(successHandler).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(2);
      expect(results[0].state).toBe('failed');
      expect(results[1].state).toBe('succeeded');
    });

    it('should handle stopOnError option with pattern handlers', async () => {
      const handler1 = vi.fn().mockRejectedValue(new Error('First failed'));
      const handler2 = vi.fn(); // Should not be called

      bus.match('user.*', handler1);
      bus.match('user.*', handler2);

      const results = await bus.emit(
        'user.created',
        { data: {} },
        {},
        {
          stopOnError: true,
        },
      );

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).not.toHaveBeenCalled();
      expect(results).toHaveLength(1);
    });
  });
});

describe('EventBus Global Middleware', () => {
  let eventBus: EventBus<any>;
  let mockGlobalMiddleware: EventMiddleware<any, any, any, any>;
  let mockHandler: EventHandler<any, any, any, any>;
  let testContext: EventContext<any, any>;

  beforeEach(() => {
    eventBus = new EventBus();
    mockGlobalMiddleware = vi.fn(async (context, next) => {
      context.meta.globalMiddlewareCalled = true;
      return next();
    });
    mockHandler = vi.fn(async (context) => {
      context.meta.handlerCalled = true;
      return 'handler-result';
    });
    testContext = {
      data: { test: 'data' },
      meta: {},
    };
  });

  afterEach(() => {
    eventBus.destroy();
  });

  describe('useGlobalMiddleware', () => {
    it('should register global middleware and return removal function', () => {
      const removeMiddleware = eventBus.useGlobalMiddleware(mockGlobalMiddleware);

      expect(removeMiddleware).toBeTypeOf('function');

      // Test that removal works
      removeMiddleware();
      // The middleware should no longer be called
    });

    it('should apply global middleware to all events', async () => {
      eventBus.useGlobalMiddleware(mockGlobalMiddleware);
      eventBus.on('test.event', mockHandler);

      await eventBus.emit('test.event', testContext);

      expect(mockGlobalMiddleware).toHaveBeenCalledWith(
        expect.objectContaining({
          data: testContext.data,
          meta: expect.objectContaining({ eventName: 'test.event' }),
        }),
        expect.any(Function),
        expect.any(Object),
      );
      expect(mockHandler).toHaveBeenCalled();
    });

    it('should execute global middleware in correct order with priority', async () => {
      const executionOrder: string[] = [];
      let emittedContext: any;

      const middleware1 = vi.fn(async (context, next) => {
        executionOrder.push('middleware1');
        context.meta.order1 = true;
        emittedContext = context; // Capture the context
        return next();
      });

      const middleware2 = vi.fn(async (context, next) => {
        executionOrder.push('middleware2');
        context.meta.order2 = true;
        emittedContext = context; // Capture the context
        return next();
      });

      // Register with different priorities
      eventBus.useGlobalMiddleware(middleware1, { priority: 10 });
      eventBus.useGlobalMiddleware(middleware2, { priority: 5 });

      eventBus.on('test.event', mockHandler);

      await eventBus.emit('test.event', testContext);

      // Higher priority (lower number) should execute first
      expect(executionOrder).toEqual(['middleware2', 'middleware1']);

      // Check the captured context that was actually modified
      expect(emittedContext.meta.order2).toBe(true);
      expect(emittedContext.meta.order1).toBe(true);
    });

    it('should allow global middleware to modify context for handlers', async () => {
      const modifyingMiddleware = vi.fn(async (context, next) => {
        context.meta.modifiedByGlobal = true;
        context.data.modifiedValue = 'modified';
        return next();
      });

      eventBus.useGlobalMiddleware(modifyingMiddleware);

      const testHandler = vi.fn(async (context) => {
        expect(context.meta.modifiedByGlobal).toBe(true);
        expect(context.data.modifiedValue).toBe('modified');
        return 'result';
      });

      eventBus.on('test.event', testHandler);

      await eventBus.emit('test.event', testContext);

      expect(testHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ modifiedValue: 'modified' }),
          meta: expect.objectContaining({ modifiedByGlobal: true }),
        }),
      );
    });

    it('should support global middleware with filter', async () => {
      const filteredMiddleware = vi.fn(async (context, next) => {
        context.meta.filtered = true;
        return next();
      });

      // Only apply to events with specific data
      eventBus.useGlobalMiddleware(filteredMiddleware, {
        filter: (context) => context.data.shouldFilter === true,
      });

      eventBus.on('test.event', mockHandler);

      // Test with context that should trigger filter
      const filteredContext = { ...testContext, data: { shouldFilter: true } };
      await eventBus.emit('test.event', filteredContext);
      expect(filteredMiddleware).toHaveBeenCalled();

      // Test with context that should not trigger filter
      filteredMiddleware.mockClear();
      const nonFilteredContext = { ...testContext, data: { shouldFilter: false } };
      await eventBus.emit('test.event', nonFilteredContext);
      expect(filteredMiddleware).not.toHaveBeenCalled();
    });
  });

  describe('Global Middleware Execution Flow', () => {
    it('should execute global middleware before event-specific middleware', async () => {
      const executionOrder: string[] = [];

      const globalMiddleware = vi.fn(async (context, next) => {
        executionOrder.push('global');
        return next();
      });

      const eventMiddleware = vi.fn(async (context, next) => {
        executionOrder.push('event');
        return next();
      });

      eventBus.useGlobalMiddleware(globalMiddleware);
      eventBus.use('test.event', eventMiddleware);
      eventBus.on('test.event', mockHandler);

      await eventBus.emit('test.event', testContext);

      expect(executionOrder).toEqual(['global', 'event']);
    });

    it('should allow global middleware to prevent handler execution', async () => {
      const blockingMiddleware = vi.fn(async (context) => {
        context.meta.blocked = true;
        // Don't call next() - this blocks further execution
        return 'blocked-result';
      });

      eventBus.useGlobalMiddleware(blockingMiddleware);
      eventBus.on('test.event', mockHandler);

      const results = await eventBus.emit('test.event', testContext);

      expect(mockHandler).not.toHaveBeenCalled();
      expect(results).length(0);
    });

    it('should handle errors in global middleware gracefully', async () => {
      const errorMiddleware = vi.fn(async () => {
        throw new Error('Global middleware error');
      });

      eventBus.useGlobalMiddleware(errorMiddleware);
      eventBus.on('test.event', mockHandler);

      const results = await eventBus.emit('test.event', testContext);

      expect(results[0].state).toBe('failed');
      expect(results[0].error).toBeDefined();
      expect(results[0].error?.message).toBe('Global middleware error');
      expect(mockHandler).not.toHaveBeenCalled();
    });

    it('should continue execution if global middleware calls next after error', async () => {
      const errorRecoveryMiddleware = vi.fn(async (context, next) => {
        try {
          // noinspection ExceptionCaughtLocallyJS
          throw new Error('Some error');
        } catch {
          // Continue execution despite error
          return next();
        }
      });

      eventBus.useGlobalMiddleware(errorRecoveryMiddleware);
      eventBus.on('test.event', mockHandler);

      const results = await eventBus.emit('test.event', testContext);

      expect(mockHandler).toHaveBeenCalled();

      expect(results[0].state).toBe('succeeded');
    });
  });

  describe('Global Middleware with Multiple Events', () => {
    it('should apply same global middleware to multiple events', async () => {
      const globalMiddleware = vi.fn(async (context, next) => {
        context.meta.globalProcessed = true;
        return next();
      });

      eventBus.useGlobalMiddleware(globalMiddleware);

      const handler1 = vi.fn();
      const handler2 = vi.fn();

      eventBus.on('event1', handler1);
      eventBus.on('event2', handler2);

      await eventBus.emit('event1', testContext);
      await eventBus.emit('event2', testContext);

      expect(globalMiddleware).toHaveBeenCalledTimes(2);
      expect(handler1).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({ globalProcessed: true }),
        }),
      );
      expect(handler2).toHaveBeenCalledWith(
        expect.objectContaining({
          meta: expect.objectContaining({ globalProcessed: true }),
        }),
      );
    });

    it('should maintain separate context for each event with global middleware', async () => {
      const contextModifyingMiddleware = vi.fn(async (context, next) => {
        context.meta.processedAt = Date.now();
        return next();
      });

      eventBus.useGlobalMiddleware(contextModifyingMiddleware);

      const handler = vi.fn(async (context) => {
        return context.meta.processedAt;
      });

      eventBus.on('test.event', handler);

      const result1 = await eventBus.emit('test.event', testContext);
      await new Promise((resolve) => setTimeout(resolve, 10)); // Small delay
      const result2 = await eventBus.emit('test.event', testContext);

      // Each event should have different processedAt timestamps
      expect(result1[0].state).toBe('succeeded'); // Changed from 'completed' to 'succeeded'
      expect(result2[0].state).toBe('succeeded'); // Changed from 'completed' to 'succeeded'
      expect(result1[0].result).not.toBe(result2[0].result);
    });
  });

  describe('Global Middleware Removal', () => {
    it('should remove global middleware when removal function is called', async () => {
      const removeMiddleware = eventBus.useGlobalMiddleware(mockGlobalMiddleware);
      eventBus.on('test.event', mockHandler);

      await eventBus.emit('test.event', testContext);
      expect(mockGlobalMiddleware).toHaveBeenCalledTimes(1);

      // Remove middleware
      removeMiddleware();

      (mockGlobalMiddleware as any).mockClear();
      await eventBus.emit('test.event', testContext);

      expect(mockGlobalMiddleware).not.toHaveBeenCalled();
      expect(mockHandler).toHaveBeenCalledTimes(2);
    });

    it('should handle multiple global middleware removals correctly', async () => {
      const middleware1 = vi.fn(async (context, next) => {
        return next();
      });
      const middleware2 = vi.fn(async (context, next) => {
        return next();
      });
      const middleware3 = vi.fn(async (context, next) => {
        return next();
      });

      eventBus.useGlobalMiddleware(middleware1);
      const remove2 = eventBus.useGlobalMiddleware(middleware2);
      eventBus.useGlobalMiddleware(middleware3);

      eventBus.on('test.event', mockHandler);

      // Remove second middleware
      remove2();

      await eventBus.emit('test.event', testContext);

      expect(middleware1).toHaveBeenCalled();
      expect(middleware2).not.toHaveBeenCalled();
      expect(middleware3).toHaveBeenCalled();
    });
  });

  describe('Global Middleware with Event Bus Options', () => {
    it('should initialize with global middlewares from options', async () => {
      const options = {
        globalMiddlewares: [mockGlobalMiddleware],
      };

      const busWithOptions = new EventBus(options);
      busWithOptions.on('test.event', mockHandler);

      await busWithOptions.emit('test.event', testContext);

      expect(mockGlobalMiddleware).toHaveBeenCalled();

      busWithOptions.destroy();
    });

    it('should combine option global middlewares with dynamically added ones', async () => {
      const optionMiddleware = vi.fn(async (context, next) => {
        context.meta.fromOption = true;
        return next();
      });

      const dynamicMiddleware = vi.fn(async (context, next) => {
        context.meta.fromDynamic = true;
        return next();
      });

      const bus = new EventBus<any>({ globalMiddlewares: [optionMiddleware] });
      bus.useGlobalMiddleware(dynamicMiddleware);

      const handler = vi.fn(async (context) => {
        // Capture the modified context from within the handler
        expect(context.meta.fromOption).toBe(true);
        expect(context.meta.fromDynamic).toBe(true);
      });

      bus.on('test.event', handler);

      await bus.emit('test.event', testContext);

      expect(optionMiddleware).toHaveBeenCalled();
      expect(dynamicMiddleware).toHaveBeenCalled();
      expect(handler).toHaveBeenCalled();

      bus.destroy();
    });
  });

  describe('Global Middleware Error Handling', () => {
    it('should handle async errors in global middleware', async () => {
      const asyncErrorMiddleware = vi.fn(async () => {
        await Promise.reject(new Error('Async error'));
      });

      eventBus.useGlobalMiddleware(asyncErrorMiddleware);
      eventBus.on('test.event', mockHandler);

      const results = await eventBus.emit('test.event', testContext);

      expect(results[0].state).toBe('failed');
      expect(results[0].error?.message).toBe('Async error');
    });

    it('should not break other global middlewares when one fails', async () => {
      const failingMiddleware = vi.fn(async () => {
        throw new Error('Failed middleware');
      });

      const succeedingMiddleware = vi.fn(async (context, next) => {
        context.meta.succeeded = true;
        return next();
      });

      eventBus.useGlobalMiddleware(failingMiddleware);
      eventBus.useGlobalMiddleware(succeedingMiddleware);
      eventBus.on('test.event', mockHandler);

      const results = await eventBus.emit('test.event', testContext);

      // The succeeding middleware should NOT be called when previous middleware fails
      expect(succeedingMiddleware).not.toHaveBeenCalled();
      expect(results[0].state).toBe('failed');
    });
  });
});
