import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MiddlewareContext } from '../types.ts';

import { PubSub } from './pubsub.ts';

describe('PubSub', () => {
  let pubsub: PubSub;
  const mockCallback = vi.fn();
  const mockErrorCallback = vi.fn().mockRejectedValue(new Error('test error'));

  beforeEach(() => {
    pubsub = new PubSub();
    vi.clearAllMocks();
  });

  describe('subscribe/publish', () => {
    it('should call subscribers', async () => {
      pubsub.subscribe('test', mockCallback);
      await pubsub.publish('test', { result: 123 } as MiddlewareContext);
      expect(mockCallback).toHaveBeenCalledWith({ result: 123 });
    });

    it('should handle multiple subscribers', async () => {
      const cb2 = vi.fn();
      pubsub.subscribe('test', mockCallback);
      pubsub.subscribe('test', cb2);
      await pubsub.publish('test', {} as MiddlewareContext);
      expect(mockCallback).toHaveBeenCalled();
      expect(cb2).toHaveBeenCalled();
    });

    it('should handle empty subscribers', async () => {
      await expect(pubsub.publish('empty', {} as MiddlewareContext)).resolves.not.toThrow();
    });
  });

  describe('unsubscribe', () => {
    it('should remove subscriber', () => {
      pubsub.subscribe('test', mockCallback);
      pubsub.unsubscribe('test', mockCallback);
      expect(pubsub['subscribers'].get('test')?.size).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should catch sync errors', async () => {
      const errorCb = vi.fn().mockImplementation(() => {
        throw new Error('sync error');
      });

      const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});

      pubsub.subscribe('error', errorCb);
      await pubsub.publish('error', {} as MiddlewareContext);

      expect(errorCb).toHaveBeenCalled();

      consoleErrorMock.mockRestore();
    });

    it('should catch async errors', async () => {
      const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});

      pubsub.subscribe('error', mockErrorCallback);
      await pubsub.publish('error', {} as MiddlewareContext);
      expect(mockErrorCallback).toHaveBeenCalled();

      consoleErrorMock.mockRestore();
    });
  });

  describe('clear', () => {
    it('should clear all subscriptions', () => {
      pubsub.subscribe('test', mockCallback);
      pubsub.clear();
      expect(pubsub['subscribers'].size).toBe(0);
    });
  });
});
