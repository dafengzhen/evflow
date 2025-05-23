import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventHandler, LifecycleHook, Middleware } from '../types';

import { Dispatcher } from './dispatcher';
import { Event } from './event';

describe('Dispatcher', () => {
  let dispatcher: Dispatcher;
  const mockHandler: EventHandler = vi.fn(() => Promise.resolve('result'));
  const mockLifecycleHook: LifecycleHook = vi.fn();
  const mockMiddleware: Middleware = vi.fn((_ctx, next) => next());
  const mockPubSubCallback = vi.fn();

  beforeEach(() => {
    dispatcher = new Dispatcher();
  });

  afterEach(() => {
    dispatcher.clear();
    vi.clearAllMocks();
  });

  describe('Event Registration', () => {
    it('should register event with dependencies and tags', () => {
      dispatcher.add('event1', ['dep1'], ['tag1']);
      expect(dispatcher.findByTags(['tag1'])).toEqual(['event1']);
    });

    it('should throw when registering duplicate event ID', () => {
      dispatcher.add('event1');
      expect(() => dispatcher.add('event1')).toThrowError(/unique/);
    });
  });

  describe('Dispatching', () => {
    it('should dispatch event with dependencies', async () => {
      dispatcher.add('dep1');
      dispatcher.add('event1', ['dep1']);
      dispatcher.handle(
        'dep1',
        vi.fn(() => 'depResult'),
      );
      dispatcher.handle('event1', mockHandler);

      await dispatcher.run('event1');
      expect(mockHandler).toHaveBeenCalledWith(expect.anything(), 'depResult');
    });

    it('should handle terminal state skipping', async () => {
      const event = new Event({ id: 'event1' });

      event.transition('scheduled');
      event.transition('running');
      event.transition('completed');

      dispatcher.add(event);
      dispatcher.handle('event1', mockHandler);

      await dispatcher.run('event1');
      expect(mockHandler).not.toHaveBeenCalled();
    });
  });

  describe('Lifecycle Hooks', () => {
    it('should trigger global and event-specific hooks', async () => {
      dispatcher.add('event1');
      dispatcher.handle('event1', mockHandler);
      dispatcher.onLifecycle('scheduled', mockLifecycleHook);
      dispatcher.onEvent('event1', 'scheduled', mockLifecycleHook);

      await dispatcher.run('event1');
      expect(mockLifecycleHook).toHaveBeenCalledTimes(2);
    });
  });

  describe('Middleware', () => {
    it('should execute middleware pipeline', async () => {
      dispatcher.add('event1');
      dispatcher.handle('event1', mockHandler);
      dispatcher.use(mockMiddleware);

      await dispatcher.run('event1');
      expect(mockMiddleware).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should log errors and transition to failed', async () => {
      const error = new Error('handler failed');

      dispatcher.add('event1');
      dispatcher.handle('event1', () => Promise.reject(error));

      let caughtError: unknown;
      try {
        await dispatcher.run('event1');
      } catch (e) {
        caughtError = e;
      }

      expect(caughtError).toBe(error);
      const logs = dispatcher.logs('error');
      expect(logs.some((log) => log.message.includes('failed'))).toBe(true);
    });
  });

  describe('Dependency Graph', () => {
    it('should process layered dispatch', async () => {
      dispatcher.add('event1', ['dep1']);
      dispatcher.add('dep1');
      dispatcher.handle('event1', mockHandler);
      dispatcher.handle('dep1', vi.fn());

      await dispatcher.runAll(['event1'], 'upstream');
      expect(mockHandler).toHaveBeenCalled();
    });
  });

  describe('PubSub', () => {
    it('should publish status updates', async () => {
      dispatcher.add('event1');
      dispatcher.handle('event1', mockHandler);
      dispatcher.subscribe('event1', mockPubSubCallback);

      await dispatcher.run('event1');
      expect(mockPubSubCallback).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    });
  });

  describe('Querying', () => {
    it('should find events by tags (any/all)', () => {
      dispatcher.add('event1', [], ['tag1']);
      dispatcher.add('event2', [], ['tag2']);

      expect(dispatcher.findByTags(['tag1'])).toEqual(['event1']);
      expect(dispatcher.findByTags(['tag1', 'tag2'], true)).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing handler', async () => {
      dispatcher.add('event1');
      await expect(dispatcher.run('event1')).rejects.toThrowError(/handler/);
    });

    it('should validate dependency resolution', async () => {
      dispatcher.add('missingDep');
      dispatcher.add('event1', ['missingDep']);

      dispatcher.handle('event1', vi.fn());

      dispatcher.handle('missingDep', () => {
        throw new Error('Intentional dependency failure');
      });

      await expect(dispatcher.run('event1')).rejects.toThrowError(/Intentional dependency failure/);
    });
  });
});
