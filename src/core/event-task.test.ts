import { describe, expect, it, vi } from 'vitest';

import type { EventContext, EventError, EventHandler, EventState, EventTaskOptions } from '../types/types.ts';

import { EventTaskImpl } from './event-task.ts';

describe('EventTaskImpl', () => {
  const mockContext: EventContext = {
    data: { test: 'data' },
    global: { globalVar: 'value' },
    meta: { timestamp: Date.now() },
  };

  describe('execute', () => {
    it('should execute successfully and return succeeded state', async () => {
      const mockResult = { data: 'test', success: true };
      const handler: EventHandler = vi.fn().mockResolvedValue(mockResult);
      const options: EventTaskOptions = {};

      const task = new EventTaskImpl(mockContext, handler, options);
      const result = await task.execute();

      expect(handler).toHaveBeenCalledWith(mockContext);
      expect(result.state).toBe('succeeded');
      expect(result.result).toEqual(mockResult);
      expect(result.error).toBeUndefined();
    });

    it('should handle synchronous handler successfully', async () => {
      const mockResult = { success: true };
      const handler: EventHandler = vi.fn().mockReturnValue(mockResult);

      const task = new EventTaskImpl(mockContext, handler);
      const result = await task.execute();

      expect(result.state).toBe('succeeded');
      expect(result.result).toEqual(mockResult);
    });

    it('should handle timeout and return timeout error', async () => {
      vi.useFakeTimers();

      const handler: EventHandler = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('slow'), 100)));
      const options: EventTaskOptions = { timeout: 50 };

      const task = new EventTaskImpl(mockContext, handler, options);
      const promise = task.execute();

      await vi.advanceTimersByTimeAsync(100);
      const result = await promise;

      expect(result.state).toBe('failed');
      expect(result.error?.code).toBe('TIMEOUT');
      expect(result.error?.message).toBe('Task timed out');

      vi.useRealTimers();
    });

    it('should handle cancellation via AbortSignal', async () => {
      const abortController = new AbortController();
      const handler: EventHandler = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('data'), 100)));
      const options: EventTaskOptions = { signal: abortController.signal };

      const task = new EventTaskImpl(mockContext, handler, options);
      const promise = task.execute();

      abortController.abort();
      const result = await promise;

      expect(result.state).toBe('cancelled');
      expect(result.error?.code).toBe('CANCELLED');
      expect(result.error?.message).toBe('Task was cancelled');
    });

    it('should retry on failure and eventually succeed', async () => {
      const mockResult = { success: true };
      let attempt = 0;
      const handler: EventHandler = vi.fn().mockImplementation(() => {
        attempt++;
        if (attempt < 3) {
          throw new Error(`Attempt ${attempt} failed`);
        }
        return mockResult;
      });

      const onRetry = vi.fn();
      const onStateChange = vi.fn();
      const options: EventTaskOptions = {
        maxRetries: 3,
        onRetry,
        onStateChange,
        retryDelay: 10,
      };

      const task = new EventTaskImpl(mockContext, handler, options);
      const result = await task.execute();

      expect(handler).toHaveBeenCalledTimes(3);
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onStateChange).toHaveBeenCalledWith('retrying');
      expect(onStateChange).toHaveBeenCalledWith('succeeded');
      expect(result.state).toBe('succeeded');
      expect(result.result).toEqual(mockResult);
    });

    it('should retry with custom retry delay function', async () => {
      vi.useFakeTimers();

      let attempt = 0;
      const handler: EventHandler = vi.fn().mockImplementation(() => {
        attempt++;
        throw new Error(`Attempt ${attempt} failed`);
      });

      const retryDelay = vi.fn().mockImplementation((attempt: number) => attempt * 10);
      const options: EventTaskOptions = {
        maxRetries: 2,
        retryDelay,
      };

      const task = new EventTaskImpl(mockContext, handler, options);
      const promise = task.execute();

      // Advance through all retry delays
      await vi.advanceTimersByTimeAsync(30);
      const result = await promise;

      expect(retryDelay).toHaveBeenCalledWith(1);
      expect(retryDelay).toHaveBeenCalledWith(2);
      expect(result.state).toBe('failed');

      vi.useRealTimers();
    });

    it('should use custom isRetryable function to determine retry behavior', async () => {
      const retryableError = new Error('Retryable error');
      const nonRetryableError = new Error('Non-retryable error');

      let callCount = 0;
      const handler: EventHandler = vi.fn().mockImplementation(() => {
        callCount++;
        throw callCount === 1 ? retryableError : nonRetryableError;
      });

      const isRetryable = vi.fn().mockImplementation((error: EventError) => {
        return error.message === 'Retryable error';
      });

      const options: EventTaskOptions = {
        isRetryable,
        maxRetries: 3,
      };

      const task = new EventTaskImpl(mockContext, handler, options);
      const result = await task.execute();

      expect(handler).toHaveBeenCalledTimes(2);
      expect(isRetryable).toHaveBeenCalledTimes(2);
      expect(isRetryable).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Retryable error',
        }),
      );
      expect(result.state).toBe('failed');
    });

    it('should not retry when maxRetries is 0', async () => {
      const handler: EventHandler = vi.fn().mockRejectedValue(new Error('Failed'));
      const options: EventTaskOptions = { maxRetries: 0 };

      const task = new EventTaskImpl(mockContext, handler, options);
      const result = await task.execute();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(result.state).toBe('failed');
    });

    it('should handle immediate cancellation before execution', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const handler: EventHandler = vi.fn();
      const options: EventTaskOptions = { signal: abortController.signal };

      const task = new EventTaskImpl(mockContext, handler, options);
      const result = await task.execute();

      expect(handler).not.toHaveBeenCalled();
      expect(result.state).toBe('cancelled');
    });

    it('should handle cancellation during retry delay', async () => {
      vi.useFakeTimers();

      const abortController = new AbortController();
      let callCount = 0;

      const handler: EventHandler = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.reject(new Error(`Attempt ${callCount} failed`));
      });

      const onStateChange = vi.fn();
      const options: EventTaskOptions = {
        maxRetries: 3,
        onStateChange,
        retryDelay: 100,
        signal: abortController.signal,
      };

      const task = new EventTaskImpl(mockContext, handler, options);
      const promise = task.execute();

      // Wait for first execution to complete and enter retrying state
      await vi.advanceTimersByTimeAsync(0);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(onStateChange).toHaveBeenCalledWith('retrying');

      // Cancel during retry delay
      abortController.abort();

      const result = await promise;

      // Now it should return cancelled state
      expect(result.state).toBe('cancelled');
      expect(result.error?.code).toBe('CANCELLED');
      expect(result.error?.message).toBe('Task was cancelled');

      vi.useRealTimers();
    });

    it('should normalize different error types correctly', async () => {
      const testCases = [
        { error: new Error('Standard error'), expectedCode: 'UNKNOWN' },
        { error: { code: 'CUSTOM_ERROR', message: 'Custom error' }, expectedCode: 'CUSTOM_ERROR' },
        { error: 'String error', expectedCode: 'UNKNOWN' },
        { error: null, expectedCode: 'UNKNOWN' },
        { error: undefined, expectedCode: 'UNKNOWN' },
      ];

      for (const { error, expectedCode } of testCases) {
        const handler: EventHandler = vi.fn().mockRejectedValue(error);
        const task = new EventTaskImpl(mockContext, handler);
        const result = await task.execute();

        expect(result.state).toBe('failed');
        expect(result.error?.code).toBe(expectedCode);
        expect(result.error?.message).toBeDefined();
      }
    });

    it('should call onStateChange with correct states during successful execution', async () => {
      const states: EventState[] = [];
      const handler: EventHandler = vi.fn().mockResolvedValue('success');
      const options: EventTaskOptions = {
        onStateChange: (state) => states.push(state),
      };

      const task = new EventTaskImpl(mockContext, handler, options);
      await task.execute();

      expect(states).toEqual(['running', 'succeeded']);
    });

    it('should call onStateChange with correct states during failed execution', async () => {
      const states: EventState[] = [];
      const handler: EventHandler = vi.fn().mockRejectedValue(new Error('Failed'));
      const options: EventTaskOptions = {
        onStateChange: (state) => states.push(state),
      };

      const task = new EventTaskImpl(mockContext, handler, options);
      await task.execute();

      expect(states).toEqual(['running', 'failed']);
    });

    it('should call onStateChange with correct states during retry sequence', async () => {
      const states: EventState[] = [];
      let attempt = 0;
      const handler: EventHandler = vi.fn().mockImplementation(() => {
        attempt++;
        if (attempt < 2) {
          throw new Error('Failed');
        }
        return 'success';
      });

      const options: EventTaskOptions = {
        maxRetries: 2,
        onStateChange: (state) => states.push(state),
        retryDelay: 0,
      };

      const task = new EventTaskImpl(mockContext, handler, options);
      await task.execute();

      expect(states).toEqual(['running', 'retrying', 'succeeded']);
    });

    it('should handle cancellation during timeout', async () => {
      vi.useFakeTimers();

      const abortController = new AbortController();
      const handler: EventHandler = vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('data'), 100)));
      const options: EventTaskOptions = {
        signal: abortController.signal,
        timeout: 200,
      };

      const task = new EventTaskImpl(mockContext, handler, options);
      const promise = task.execute();

      // Cancel before timeout
      abortController.abort();
      const result = await promise;

      expect(result.state).toBe('cancelled');
      expect(result.error?.code).toBe('CANCELLED');

      vi.useRealTimers();
    });
  });

  describe('error normalization', () => {
    it('should create error with stack trace from Error object', () => {
      const task = new EventTaskImpl(mockContext, vi.fn());
      const testError = new Error('Test error');

      // @ts-expect-error - Accessing private method for testing
      const eventError = task.createError('TEST_CODE', 'Test message', testError);

      expect(eventError.code).toBe('TEST_CODE');
      expect(eventError.message).toBe('Test message');
      expect(eventError.error).toBe(testError);
      expect(eventError.stack).toBe(testError.stack);
    });

    it('should normalize error with code from object', async () => {
      const customError = { code: 'CUSTOM_CODE', message: 'Custom message' };
      const handler: EventHandler = vi.fn().mockRejectedValue(customError);

      const task = new EventTaskImpl(mockContext, handler);
      const result = await task.execute();

      expect(result.error?.code).toBe('CUSTOM_CODE');
      expect(result.error?.message).toBe('Custom message');
    });

    it('should normalize string errors', async () => {
      const handler: EventHandler = vi.fn().mockRejectedValue('String error');

      const task = new EventTaskImpl(mockContext, handler);
      const result = await task.execute();

      expect(result.error?.code).toBe('UNKNOWN');
      expect(result.error?.message).toBe('String error');
    });

    it('should normalize error without message property', async () => {
      const handler: EventHandler = vi.fn().mockRejectedValue({ someProperty: 'value' });

      const task = new EventTaskImpl(mockContext, handler);
      const result = await task.execute();

      expect(result.error?.code).toBe('UNKNOWN');
      expect(result.error?.message).toBe('[object Object]');
    });
  });

  describe('result creation', () => {
    it('should create result with success state', () => {
      const task = new EventTaskImpl(mockContext, vi.fn());
      const mockResult = { data: 'test' };

      const result = task['createResult']('succeeded', mockResult);

      expect(result.state).toBe('succeeded');
      expect(result.result).toBe(mockResult);
      expect(result.error).toBeUndefined();
    });

    it('should create result with error state', () => {
      const task = new EventTaskImpl(mockContext, vi.fn());
      const mockError: EventError = { code: 'ERROR', message: 'Test error' };

      const result = task['createResult']('failed', undefined, mockError);

      expect(result.state).toBe('failed');
      expect(result.result).toBeUndefined();
      expect(result.error).toBe(mockError);
    });

    it('should create result with cancelled state', () => {
      const task = new EventTaskImpl(mockContext, vi.fn());
      const mockError: EventError = { code: 'CANCELLED', message: 'Cancelled' };

      const result = task['createResult']('cancelled', undefined, mockError);

      expect(result.state).toBe('cancelled');
      expect(result.result).toBeUndefined();
      expect(result.error).toBe(mockError);
    });
  });
});
