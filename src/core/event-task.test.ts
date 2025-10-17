import { describe, expect, it, jest } from '@jest/globals';

import type { EventContext, EventError, EventState, EventTaskOptions } from '../types/types.ts';

import { EventTask } from './event-task.ts';

describe('EventTaskImpl', () => {
  const mockContext: EventContext = {
    data: { test: 'data' },
    global: { globalVar: 'value' },
    meta: { timestamp: Date.now() },
  };

  describe('execute', () => {
    it('should execute successfully and return succeeded state', async () => {
      const mockResult = { data: 'test', success: true };
      const handler = jest.fn<any>().mockResolvedValue(mockResult);
      const options: EventTaskOptions = {};

      const task = new EventTask(mockContext, handler, options);
      const result = await task.execute();

      expect(handler).toHaveBeenCalledWith(mockContext);
      expect(result.state).toBe('succeeded');
      expect(result.result).toEqual(mockResult);
      expect(result.error).toBeUndefined();
    });

    it('should handle synchronous handler successfully', async () => {
      const mockResult = { success: true };
      const handler = jest.fn<any>().mockReturnValue(mockResult);

      const task = new EventTask(mockContext, handler);
      const result = await task.execute();

      expect(result.state).toBe('succeeded');
      expect(result.result).toEqual(mockResult);
    });

    it('should handle timeout and return timeout error', async () => {
      jest.useFakeTimers();

      const handler = jest
        .fn<any>()
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('slow'), 100)));
      const options: EventTaskOptions = { timeout: 50 };

      const task = new EventTask(mockContext, handler, options);
      const promise = task.execute();

      await jest.advanceTimersByTimeAsync(100);
      const result = await promise;

      expect(result.state).toBe('failed');
      expect(result.error?.code).toBe('TIMEOUT');
      expect(result.error?.message).toBe('Task timed out after 50ms');

      jest.useRealTimers();
    });

    it('should handle cancellation jesta AbortSignal', async () => {
      const abortController = new AbortController();
      const handler = jest
        .fn<any>()
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('data'), 100)));
      const options: EventTaskOptions = { signal: abortController.signal };

      const task = new EventTask(mockContext, handler, options);
      const promise = task.execute();

      abortController.abort();
      const result = await promise;

      expect(result.state).toBe('cancelled');
      expect(result.error?.code).toBe('CANCELLED');
      expect(result.error?.message).toContain('cancelled');
    });

    it('should retry on failure and eventually succeed', async () => {
      const mockResult = { success: true };
      let attempt = 0;
      const handler = jest.fn<any>().mockImplementation(() => {
        attempt++;
        if (attempt < 3) {
          throw new Error(`Attempt ${attempt} failed`);
        }
        return mockResult;
      });

      const onRetry = jest.fn<any>();
      const onStateChange = jest.fn<any>();
      const options: EventTaskOptions = {
        maxRetries: 3,
        onRetry,
        onStateChange,
        retryDelay: 10,
      };

      const task = new EventTask(mockContext, handler, options);
      const result = await task.execute();

      expect(handler).toHaveBeenCalledTimes(3);
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onStateChange).toHaveBeenCalledWith('retrying');
      expect(onStateChange).toHaveBeenCalledWith('succeeded');
      expect(result.state).toBe('succeeded');
      expect(result.result).toEqual(mockResult);
    });

    it('should retry with custom retry delay function', async () => {
      jest.useFakeTimers();

      let attempt = 0;
      const handler = jest.fn<any>().mockImplementation(() => {
        attempt++;
        throw new Error(`Attempt ${attempt} failed`);
      });

      const retryDelay = jest.fn<any>().mockImplementation((attempt: number) => attempt * 10);
      const options: EventTaskOptions = {
        maxRetries: 2,
        retryDelay,
      };

      const task = new EventTask(mockContext, handler, options);
      const promise = task.execute();

      // Advance through all retry delays
      await jest.advanceTimersByTimeAsync(30);
      const result = await promise;

      expect(retryDelay).toHaveBeenCalledWith(1);
      expect(retryDelay).toHaveBeenCalledWith(2);
      expect(result.state).toBe('failed');

      jest.useRealTimers();
    });

    it('should use custom isRetryable function to determine retry behajestor', async () => {
      const retryableError = new Error('Retryable error');
      const nonRetryableError = new Error('Non-retryable error');

      let callCount = 0;
      const handler = jest.fn<any>().mockImplementation(() => {
        callCount++;
        throw callCount === 1 ? retryableError : nonRetryableError;
      });

      const isRetryable = jest.fn<any>().mockImplementation((error: EventError) => {
        return error.message === 'Retryable error';
      });

      const options: EventTaskOptions = {
        isRetryable,
        maxRetries: 3,
      };

      const task = new EventTask(mockContext, handler, options);
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
      const handler = jest.fn<any>().mockRejectedValue(new Error('Failed'));
      const options: EventTaskOptions = { maxRetries: 0 };

      const task = new EventTask(mockContext, handler, options);
      const result = await task.execute();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(result.state).toBe('failed');
    });

    it('should handle immediate cancellation before execution', async () => {
      const abortController = new AbortController();
      abortController.abort();

      const handler = jest.fn<any>();
      const options: EventTaskOptions = { signal: abortController.signal };

      const task = new EventTask(mockContext, handler, options);
      const result = await task.execute();

      expect(handler).not.toHaveBeenCalled();
      expect(result.state).toBe('cancelled');
    });

    it('should handle cancellation during retry delay', async () => {
      jest.useFakeTimers();

      const abortController = new AbortController();
      let callCount = 0;

      const handler = jest.fn<any>().mockImplementation(() => {
        callCount++;
        return Promise.reject(new Error(`Attempt ${callCount} failed`));
      });

      const onStateChange = jest.fn<any>();
      const options: EventTaskOptions = {
        maxRetries: 3,
        onStateChange,
        retryDelay: 100,
        signal: abortController.signal,
      };

      const task = new EventTask(mockContext, handler, options);
      const promise = task.execute();

      // Wait for first execution to complete and enter retrying state
      await jest.advanceTimersByTimeAsync(0);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(onStateChange).toHaveBeenCalledWith('retrying');

      // Cancel during retry delay
      abortController.abort();

      const result = await promise;

      // Now it should return cancelled state
      expect(result.state).toBe('cancelled');
      expect(result.error?.code).toBe('CANCELLED');
      expect(result.error?.message).toBe('Task was cancelled');

      jest.useRealTimers();
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
        const handler = jest.fn<any>().mockRejectedValue(error);
        const task = new EventTask(mockContext, handler);
        const result = await task.execute();

        expect(result.state).toBe('failed');
        expect(result.error?.code).toBe(expectedCode);
        expect(result.error?.message).toBeDefined();
      }
    });

    it('should call onStateChange with correct states during successful execution', async () => {
      const states: EventState[] = [];
      const handler = jest.fn<any>().mockResolvedValue('success');
      const options: EventTaskOptions = {
        onStateChange: (state) => states.push(state),
      };

      const task = new EventTask(mockContext, handler, options);
      await task.execute();

      expect(states).toEqual(['running', 'succeeded']);
    });

    it('should call onStateChange with correct states during failed execution', async () => {
      const states: EventState[] = [];
      const handler = jest.fn<any>().mockRejectedValue(new Error('Failed'));
      const options: EventTaskOptions = {
        onStateChange: (state) => states.push(state),
      };

      const task = new EventTask(mockContext, handler, options);
      await task.execute();

      expect(states).toEqual(['running', 'failed']);
    });

    it('should call onStateChange with correct states during retry sequence', async () => {
      const states: EventState[] = [];
      let attempt = 0;
      const handler = jest.fn<any>().mockImplementation(() => {
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

      const task = new EventTask(mockContext, handler, options);
      await task.execute();

      expect(states).toEqual(['running', 'retrying', 'succeeded']);
    });

    it('should handle cancellation during timeout', async () => {
      jest.useFakeTimers();

      const abortController = new AbortController();
      const handler = jest
        .fn<any>()
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('data'), 100)));
      const options: EventTaskOptions = {
        signal: abortController.signal,
        timeout: 200,
      };

      const task = new EventTask(mockContext, handler, options);
      const promise = task.execute();

      // Cancel before timeout
      abortController.abort();
      const result = await promise;

      expect(result.state).toBe('cancelled');
      expect(result.error?.code).toBe('CANCELLED');

      jest.useRealTimers();
    });
  });

  describe('error normalization', () => {
    it('should create error with stack trace from Error object', () => {
      const task = new EventTask(mockContext, jest.fn<any>());
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
      const handler = jest.fn<any>().mockRejectedValue(customError);

      const task = new EventTask(mockContext, handler);
      const result = await task.execute();

      expect(result.error?.code).toBe('CUSTOM_CODE');
      expect(result.error?.message).toBe('Custom message');
    });

    it('should normalize string errors', async () => {
      const handler = jest.fn<any>().mockRejectedValue('String error');

      const task = new EventTask(mockContext, handler);
      const result = await task.execute();

      expect(result.error?.code).toBe('UNKNOWN');
      expect(result.error?.message).toBe('String error');
    });

    it('should normalize error without message property', async () => {
      const handler = jest.fn<any>().mockRejectedValue({ someProperty: 'value' });

      const task = new EventTask(mockContext, handler);
      const result = await task.execute();

      expect(result.error?.code).toBe('UNKNOWN');
      expect(result.error?.message).toBe('[object Object]');
    });
  });

  describe('result creation', () => {
    it('should create result with success state', () => {
      const task = new EventTask(mockContext, jest.fn<any>());
      const mockResult = { data: 'test' };

      const result = task['createResult']('succeeded', mockResult);

      expect(result.state).toBe('succeeded');
      expect(result.result).toBe(mockResult);
      expect(result.error).toBeUndefined();
    });

    it('should create result with error state', () => {
      const task = new EventTask(mockContext, jest.fn<any>());
      const mockError: EventError = { code: 'ERROR', message: 'Test error' };

      const result = task['createResult']('failed', undefined, mockError);

      expect(result.state).toBe('failed');
      expect(result.result).toBeUndefined();
      expect(result.error).toBe(mockError);
    });

    it('should create result with cancelled state', () => {
      const task = new EventTask(mockContext, jest.fn<any>());
      const mockError: EventError = { code: 'CANCELLED', message: 'Cancelled' };

      const result = task['createResult']('cancelled', undefined, mockError);

      expect(result.state).toBe('cancelled');
      expect(result.result).toBeUndefined();
      expect(result.error).toBe(mockError);
    });
  });
});
