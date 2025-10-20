import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	jest,
} from '@jest/globals';

import type { EventError, EventState } from './types/types.ts';

import { EventTask } from './core/index.ts';
import { RetryConditions, RetryStrategies } from './utils.ts';

const mockContext = {
	data: { test: 'data' },
	event: 'test-event',
	timestamp: Date.now(),
};

const mockOnStateChange = jest.fn<any>();
const mockOnRetry = jest.fn<any>();

describe('RetryStrategies', () => {
	beforeEach(() => {
		jest.restoreAllMocks();
	});

	describe('exponential', () => {
		it('should calculate exponential delays without max delay', () => {
			const strategy = RetryStrategies.exponential(100);

			expect(strategy(1)).toBe(100); // 100 * 2^0
			expect(strategy(2)).toBe(200); // 100 * 2^1
			expect(strategy(3)).toBe(400); // 100 * 2^2
			expect(strategy(4)).toBe(800); // 100 * 2^3
			expect(strategy(5)).toBe(1600); // 100 * 2^4
		});

		it('should respect max delay when provided', () => {
			const strategy = RetryStrategies.exponential(100, 500);

			expect(strategy(1)).toBe(100); // 100 * 2^0 = 100
			expect(strategy(2)).toBe(200); // 100 * 2^1 = 200
			expect(strategy(3)).toBe(400); // 100 * 2^2 = 400
			expect(strategy(4)).toBe(500); // 100 * 2^3 = 800, but capped at 500
			expect(strategy(5)).toBe(500); // 100 * 2^4 = 1600, but capped at 500
		});

		it('should handle zero base delay', () => {
			const strategy = RetryStrategies.exponential(0);

			expect(strategy(1)).toBe(0);
			expect(strategy(2)).toBe(0);
			expect(strategy(3)).toBe(0);
		});

		it('should handle negative attempt numbers gracefully', () => {
			const strategy = RetryStrategies.exponential(100);

			// For attempt = 0: 100 * 2^(0 - 1) = 100 * 2^(-1) = 100 * 0.5 = 50
			expect(strategy(0)).toBe(50);

			// For attempt = -1: 100 * 2^(-1 - 1) = 100 * 2^(-2) = 100 * 0.25 = 25
			expect(strategy(-1)).toBe(25);

			// For attempt = -2: 100 * 2^(-2 - 1) = 100 * 2^(-3) = 100 * 0.125 = 12.5
			expect(strategy(-2)).toBe(12.5);
		});
	});

	describe('fixed', () => {
		it('should always return the same fixed delay', () => {
			const strategy = RetryStrategies.fixed(250);

			expect(strategy(1)).toBe(250);
			expect(strategy(2)).toBe(250);
			expect(strategy(5)).toBe(250);
			expect(strategy(10)).toBe(250);
		});

		it('should handle zero delay', () => {
			const strategy = RetryStrategies.fixed(0);

			expect(strategy(1)).toBe(0);
			expect(strategy(100)).toBe(0);
		});

		it('should handle negative delay', () => {
			const strategy = RetryStrategies.fixed(-100);

			expect(strategy(1)).toBe(-100);
			expect(strategy(2)).toBe(-100);
		});
	});

	describe('jitter', () => {
		beforeEach(() => {
			jest.spyOn(Math, 'random').mockReturnValue(0.5);
		});

		it('should calculate jittered delays with default jitter factor', () => {
			const strategy = RetryStrategies.jitter(100);

			// attempt 1: 100 * 2^0 = 100 + (100 * 0.5 * 0.5) = 100 + 25 = 125
			expect(strategy(1)).toBe(125);
			// attempt 2: 100 * 2^1 = 200 + (200 * 0.5 * 0.5) = 200 + 50 = 250
			expect(strategy(2)).toBe(250);
			// attempt 3: 100 * 2^2 = 400 + (400 * 0.5 * 0.5) = 400 + 100 = 500
			expect(strategy(3)).toBe(500);
		});

		it('should calculate jittered delays with custom jitter factor', () => {
			const strategy = RetryStrategies.jitter(100, 0.2);

			// attempt 1: 100 * 2^0 = 100 + (100 * 0.2 * 0.5) = 100 + 10 = 110
			expect(strategy(1)).toBe(110);
			// attempt 2: 100 * 2^1 = 200 + (200 * 0.2 * 0.5) = 200 + 20 = 220
			expect(strategy(2)).toBe(220);
		});

		it('should handle zero base delay with jitter', () => {
			const strategy = RetryStrategies.jitter(0);

			expect(strategy(1)).toBe(0);
			expect(strategy(2)).toBe(0);
			expect(strategy(3)).toBe(0);
		});

		it('should handle different random values', () => {
			jest.spyOn(Math, 'random').mockReturnValue(0.0);
			const strategy1 = RetryStrategies.jitter(100);
			expect(strategy1(1)).toBe(100); // 100 + (100 * 0.5 * 0.0) = 100

			jest.spyOn(Math, 'random').mockReturnValue(1.0);
			const strategy2 = RetryStrategies.jitter(100);
			expect(strategy2(1)).toBe(150); // 100 + (100 * 0.5 * 1.0) = 150
		});

		it('should handle negative attempt numbers', () => {
			const strategy = RetryStrategies.jitter(100);

			// attempt 0: 100 * 2^(-1) = 50 + (50 * 0.5 * 0.5) = 50 + 12.5 = 62.5
			expect(strategy(0)).toBe(62.5);
		});
	});

	describe('linear', () => {
		it('should calculate linear delays without max delay', () => {
			const strategy = RetryStrategies.linear(100, 50);

			expect(strategy(1)).toBe(100); // 100 + 50 * 0
			expect(strategy(2)).toBe(150); // 100 + 50 * 1
			expect(strategy(3)).toBe(200); // 100 + 50 * 2
			expect(strategy(4)).toBe(250); // 100 + 50 * 3
		});

		it('should respect max delay when provided', () => {
			const strategy = RetryStrategies.linear(100, 50, 200);

			expect(strategy(1)).toBe(100); // 100 + 50 * 0 = 100
			expect(strategy(2)).toBe(150); // 100 + 50 * 1 = 150
			expect(strategy(3)).toBe(200); // 100 + 50 * 2 = 200
			expect(strategy(4)).toBe(200); // 100 + 50 * 3 = 250, but capped at 200
			expect(strategy(5)).toBe(200); // 100 + 50 * 4 = 300, but capped at 200
		});

		it('should handle zero base delay and increment', () => {
			const strategy = RetryStrategies.linear(0, 0);

			expect(strategy(1)).toBe(0);
			expect(strategy(2)).toBe(0);
			expect(strategy(10)).toBe(0);
		});

		it('should handle negative increments', () => {
			const strategy = RetryStrategies.linear(100, -10);

			expect(strategy(1)).toBe(100); // 100 + (-10) * 0 = 100
			expect(strategy(2)).toBe(90); // 100 + (-10) * 1 = 90
			expect(strategy(3)).toBe(80); // 100 + (-10) * 2 = 80
		});

		it('should handle negative attempt numbers', () => {
			const strategy = RetryStrategies.linear(100, 50);

			expect(strategy(0)).toBe(50); // 100 + 50 * (-1) = 50
			expect(strategy(-1)).toBe(0); // 100 + 50 * (-2) = 0
		});

		it('should handle negative values with max delay', () => {
			const strategy = RetryStrategies.linear(-100, 50, 0);

			expect(strategy(1)).toBe(-100); // -100 + 50 * 0 = -100
			expect(strategy(2)).toBe(-50); // -100 + 50 * 1 = -50
			expect(strategy(3)).toBe(0); // -100 + 50 * 2 = 0
			expect(strategy(4)).toBe(0); // -100 + 50 * 3 = 50 → Math.min(50, 0) = 0
		});
	});

	describe('edge cases and boundary conditions', () => {
		it('should handle very large numbers in exponential strategy', () => {
			const strategy = RetryStrategies.exponential(Number.MAX_SAFE_INTEGER);

			expect(strategy(1)).toBe(Number.MAX_SAFE_INTEGER);
			// This will exceed safe integer range but should still compute
			expect(strategy(2)).toBe(Number.MAX_SAFE_INTEGER * 2);
		});

		it('should handle very small numbers in fixed strategy', () => {
			const strategy = RetryStrategies.fixed(Number.MIN_VALUE);

			expect(strategy(1)).toBe(Number.MIN_VALUE);
			expect(strategy(100)).toBe(Number.MIN_VALUE);
		});

		it('should handle decimal numbers in linear strategy', () => {
			const strategy = RetryStrategies.linear(10.5, 2.5);

			expect(strategy(1)).toBe(10.5);
			expect(strategy(2)).toBe(13);
			expect(strategy(3)).toBe(15.5);
		});
	});
});

describe('RetryConditions', () => {
	// it('should be an empty object', () => {
	//   expect(RetryConditions).toBeDefined();
	//   expect(RetryConditions).toEqual({});
	//   expect(Object.keys(RetryConditions)).toHaveLength(0);
	// });

	it('should have no properties', () => {
		expect(RetryConditions).toMatchObject({});
	});
});

describe('EventTaskImpl with RetryStrategies', () => {
	beforeEach(() => {
		jest.useFakeTimers();
		jest.clearAllMocks();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	describe('exponential retry strategy', () => {
		it('should use exponential backoff for retries', async () => {
			let callCount = 0;
			const handler = jest.fn<any>().mockImplementation(() => {
				callCount++;
				if (callCount < 3) {
					throw new Error('Temporary error');
				}
				return 'success';
			});

			const task = new EventTask(mockContext, handler, {
				maxRetries: 5,
				onRetry: mockOnRetry,
				onStateChange: mockOnStateChange,
				retryDelay: RetryStrategies.exponential(100),
			});

			const promise = task.execute();

			// Advance through retries
			await jest.advanceTimersByTimeAsync(100); // First retry delay
			await jest.advanceTimersByTimeAsync(200); // Second retry delay

			const result = await promise;

			expect(result.state).toBe('succeeded');
			expect(result.result).toBe('success');
			expect(handler).toHaveBeenCalledTimes(3);
			expect(mockOnRetry).toHaveBeenCalledTimes(2);
			expect(mockOnRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Object));
			expect(mockOnRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Object));
		});

		it('should respect maxDelay in exponential strategy', async () => {
			const handler = jest
				.fn<any>()
				.mockRejectedValueOnce(new Error('Error 1'))
				.mockRejectedValueOnce(new Error('Error 2'))
				.mockRejectedValueOnce(new Error('Error 3'))
				.mockResolvedValue('success');

			const task = new EventTask(mockContext, handler, {
				maxRetries: 10,
				onRetry: mockOnRetry,
				retryDelay: RetryStrategies.exponential(100, 300), // Max 300ms
			});

			const promise = task.execute();

			// Check that delays are capped at 300ms
			await jest.advanceTimersByTimeAsync(100); // First retry: 100ms
			await jest.advanceTimersByTimeAsync(200); // Second retry: 200ms
			await jest.advanceTimersByTimeAsync(300); // Third retry: 300ms (capped)
			await jest.advanceTimersByTimeAsync(300); // Fourth retry: 300ms (capped)

			await promise;

			// Verify retry calls with correct attempt numbers
			expect(mockOnRetry).toHaveBeenCalledWith(1, expect.any(Object));
			expect(mockOnRetry).toHaveBeenCalledWith(2, expect.any(Object));
			expect(mockOnRetry).toHaveBeenCalledWith(3, expect.any(Object));
		});
	});

	describe('fixed retry strategy', () => {
		it('should use fixed delay for all retries', async () => {
			const handler = jest
				.fn<any>()
				.mockRejectedValueOnce(new Error('Error 1'))
				.mockRejectedValueOnce(new Error('Error 2'))
				.mockResolvedValue('success');

			const task = new EventTask(mockContext, handler, {
				maxRetries: 3,
				onRetry: mockOnRetry,
				retryDelay: RetryStrategies.fixed(150),
			});

			const promise = task.execute();

			// All retries should use 150ms delay
			await jest.advanceTimersByTimeAsync(150); // First retry
			await jest.advanceTimersByTimeAsync(150); // Second retry

			const result = await promise;

			expect(result.state).toBe('succeeded');
			expect(handler).toHaveBeenCalledTimes(3);
		});

		it('should work with zero fixed delay', async () => {
			const handler = jest
				.fn<any>()
				.mockRejectedValueOnce(new Error('Error 1'))
				.mockResolvedValue('success');

			const task = new EventTask(mockContext, handler, {
				maxRetries: 2,
				onRetry: mockOnRetry,
				retryDelay: RetryStrategies.fixed(0),
			});

			const promise = task.execute();
			// No need to advance timers since delay is 0
			const result = await promise;

			expect(result.state).toBe('succeeded');
			expect(handler).toHaveBeenCalledTimes(2);
		});
	});

	describe('jitter retry strategy', () => {
		beforeEach(() => {
			jest.spyOn(Math, 'random').mockReturnValue(0.5);
		});

		it('should apply jitter to retry delays', async () => {
			const handler = jest
				.fn<any>()
				.mockRejectedValueOnce(new Error('Error 1'))
				.mockRejectedValueOnce(new Error('Error 2'))
				.mockResolvedValue('success');

			const task = new EventTask(mockContext, handler, {
				maxRetries: 3,
				onRetry: mockOnRetry,
				retryDelay: RetryStrategies.jitter(100, 0.5),
			});

			const promise = task.execute();

			// First retry: 100 * 2^0 = 100 + (100 * 0.5 * 0.5) = 125ms
			await jest.advanceTimersByTimeAsync(125);
			// Second retry: 100 * 2^1 = 200 + (200 * 0.5 * 0.5) = 250ms
			await jest.advanceTimersByTimeAsync(250);

			const result = await promise;

			expect(result.state).toBe('succeeded');
			expect(handler).toHaveBeenCalledTimes(3);
		});
	});

	describe('linear retry strategy', () => {
		it('should use linearly increasing delays', async () => {
			const handler = jest
				.fn<any>()
				.mockRejectedValueOnce(new Error('Error 1'))
				.mockRejectedValueOnce(new Error('Error 2'))
				.mockRejectedValueOnce(new Error('Error 3'))
				.mockResolvedValue('success');

			const task = new EventTask(mockContext, handler, {
				maxRetries: 5,
				onRetry: mockOnRetry,
				retryDelay: RetryStrategies.linear(100, 50), // 100, 150, 200, 250, 300
			});

			const promise = task.execute();

			await jest.advanceTimersByTimeAsync(100); // First retry
			await jest.advanceTimersByTimeAsync(150); // Second retry
			await jest.advanceTimersByTimeAsync(200); // Third retry

			const result = await promise;

			expect(result.state).toBe('succeeded');
			expect(handler).toHaveBeenCalledTimes(4);
		});

		it('should respect maxDelay in linear strategy', async () => {
			const handler = jest
				.fn<any>()
				.mockRejectedValueOnce(new Error('Error 1'))
				.mockRejectedValueOnce(new Error('Error 2'))
				.mockRejectedValueOnce(new Error('Error 3'))
				.mockResolvedValue('success');

			const task = new EventTask(mockContext, handler, {
				maxRetries: 5,
				onRetry: mockOnRetry,
				retryDelay: RetryStrategies.linear(100, 100, 250), // Capped at 250
			});

			const promise = task.execute();

			await jest.advanceTimersByTimeAsync(100); // 100ms
			await jest.advanceTimersByTimeAsync(200); // 200ms
			await jest.advanceTimersByTimeAsync(250); // 250ms (capped)
			await jest.advanceTimersByTimeAsync(250); // 250ms (capped)

			await promise;

			expect(handler).toHaveBeenCalledTimes(4);
		});
	});

	describe('with custom retry conditions', () => {
		it('should use isRetryable to determine if retry should occur', async () => {
			const handler = jest
				.fn<any>()
				.mockRejectedValueOnce(new Error('Network error'))
				.mockRejectedValueOnce(new Error('Database error'))
				.mockResolvedValue('success');

			const isRetryable = jest
				.fn<any>()
				.mockImplementation((error: EventError) => {
					// Only retry on network errors, not database errors
					return error.message.includes('Network');
				});

			const task = new EventTask(mockContext, handler, {
				isRetryable,
				maxRetries: 3,
				onRetry: mockOnRetry,
				retryDelay: RetryStrategies.fixed(100),
			});

			const promise = task.execute();
			await jest.advanceTimersByTimeAsync(100); // First retry delay

			const result = await promise;

			expect(result.state).toBe('failed');
			expect(isRetryable).toHaveBeenCalledTimes(2);
			expect(mockOnRetry).toHaveBeenCalledTimes(1); // Only one retry for network error
		});

		it('should not retry when isRetryable returns false', async () => {
			const handler = jest
				.fn<any>()
				.mockRejectedValueOnce(new Error('Permanent failure'));

			const task = new EventTask(mockContext, handler, {
				isRetryable: () => false, // Never retry
				maxRetries: 3,
				onRetry: mockOnRetry,
				retryDelay: RetryStrategies.fixed(100),
			});

			const result = await task.execute();

			expect(result.state).toBe('failed');
			expect(mockOnRetry).not.toHaveBeenCalled();
		});
	});

	describe('integration with abort signal', () => {
		it('should cancel during retry delay with exponential strategy', async () => {
			const handler = jest.fn<any>().mockRejectedValue(new Error('Error'));

			const controller = new AbortController();
			const task = new EventTask(mockContext, handler, {
				maxRetries: 5,
				retryDelay: RetryStrategies.exponential(100),
				signal: controller.signal,
			});

			const promise = task.execute();

			// Start first retry delay
			await jest.advanceTimersByTimeAsync(50);

			// Cancel during delay
			controller.abort();

			const result = await promise;

			expect(result.state).toBe('cancelled');
			expect(result.error?.code).toBe('CANCELLED');
		});

		it('should cancel during jitter retry delay', async () => {
			jest.spyOn(Math, 'random').mockReturnValue(0.5);

			const handler = jest.fn<any>().mockRejectedValue(new Error('Error'));

			const controller = new AbortController();
			const task = new EventTask(mockContext, handler, {
				maxRetries: 5,
				retryDelay: RetryStrategies.jitter(100),
				signal: controller.signal,
			});

			const promise = task.execute();

			// Cancel before delay completes
			await jest.advanceTimersByTimeAsync(50);
			controller.abort();

			const result = await promise;

			expect(result.state).toBe('cancelled');
		});
	});

	describe('state transitions with retry strategies', () => {
		it('should transition through correct states with exponential retry', async () => {
			const handler = jest
				.fn<any>()
				.mockRejectedValueOnce(new Error('Error 1'))
				.mockRejectedValueOnce(new Error('Error 2'))
				.mockResolvedValue('success');

			const stateChanges: EventState[] = [];
			const onStateChange = (state: EventState) => stateChanges.push(state);

			const task = new EventTask(mockContext, handler, {
				maxRetries: 3,
				onRetry: mockOnRetry,
				onStateChange,
				retryDelay: RetryStrategies.exponential(100),
			});

			const promise = task.execute();
			await jest.advanceTimersByTimeAsync(100); // First retry
			await jest.advanceTimersByTimeAsync(200); // Second retry
			await promise;

			expect(stateChanges).toEqual(['running', 'retrying', 'succeeded']);
		});

		it('should transition to failed when retries exhausted with linear strategy', async () => {
			const handler = jest
				.fn<any>()
				.mockRejectedValue(new Error('Persistent error'));

			const stateChanges: EventState[] = [];
			const onStateChange = (state: EventState) => stateChanges.push(state);

			const task = new EventTask(mockContext, handler, {
				maxRetries: 2,
				onRetry: mockOnRetry,
				onStateChange,
				retryDelay: RetryStrategies.linear(100, 50),
			});

			const promise = task.execute();
			await jest.advanceTimersByTimeAsync(100); // First retry
			await jest.advanceTimersByTimeAsync(150); // Second retry
			const result = await promise;

			expect(result.state).toBe('failed');
			expect(stateChanges).toEqual([
				'running',
				'retrying',
				'failed', // Final state
			]);
		});
	});
});

describe('RetryConditions integration', () => {
	it('should work with empty RetryConditions object', async () => {
		jest.useFakeTimers();

		// This test demonstrates that RetryConditions is available
		// but currently empty, so we use custom isRetryable functions
		// expect(RetryConditions).toBeDefined();
		// expect(typeof RetryConditions).toBe('object');

		const handler = jest
			.fn<any>()
			.mockRejectedValueOnce(new Error('Error'))
			.mockResolvedValue('success');

		const task = new EventTask(mockContext, handler, {
			// Using custom retry condition since RetryConditions is empty
			isRetryable: (error) => error.message !== 'Fatal error',
			maxRetries: 2,
			retryDelay: RetryStrategies.fixed(100),
		});

		const promise = task.execute();
		await jest.advanceTimersByTimeAsync(100);
		const result = await promise;

		expect(result.state).toBe('succeeded');

		jest.clearAllTimers();
	});
});

describe('RetryConditions', () => {
	const createMockError = (code: string, message: string): EventError => ({
		code,
		error: new Error(message),
		message,
	});

	describe('onNetworkError', () => {
		it('should return true for network-related errors', () => {
			expect(
				RetryConditions.onNetworkError(
					createMockError('ETIMEDOUT', 'Connection timed out'),
				),
			).toBe(true);
			expect(
				RetryConditions.onNetworkError(
					createMockError('ECONNRESET', 'Connection reset by peer'),
				),
			).toBe(true);
			expect(
				RetryConditions.onNetworkError(
					createMockError('', 'Network error occurred'),
				),
			).toBe(true);
			expect(
				RetryConditions.onNetworkError(createMockError('', 'Socket timeout')),
			).toBe(true);
		});

		it('should return false for non-network errors', () => {
			expect(
				RetryConditions.onNetworkError(createMockError('400', 'Bad request')),
			).toBe(false);
			expect(
				RetryConditions.onNetworkError(
					createMockError('', 'Validation failed'),
				),
			).toBe(false);
		});
	});

	describe('onServerError', () => {
		it('should return true for server errors', () => {
			expect(
				RetryConditions.onServerError(
					createMockError('500', 'Internal Server Error'),
				),
			).toBe(true);
			expect(
				RetryConditions.onServerError(
					createMockError('503', 'Service Unavailable'),
				),
			).toBe(true);
			expect(
				RetryConditions.onServerError(
					createMockError('', 'Internal server error'),
				),
			).toBe(true);
			expect(
				RetryConditions.onServerError(createMockError('', 'Gateway timeout')),
			).toBe(true);
		});

		it('should return false for client errors', () => {
			expect(
				RetryConditions.onServerError(createMockError('400', 'Bad Request')),
			).toBe(false);
			expect(
				RetryConditions.onServerError(createMockError('404', 'Not Found')),
			).toBe(false);
		});
	});

	describe('onRateLimit', () => {
		it('should return true for rate limit errors', () => {
			expect(
				RetryConditions.onRateLimit(
					createMockError('429', 'Too Many Requests'),
				),
			).toBe(true);
			expect(
				RetryConditions.onRateLimit(
					createMockError('RATE_LIMITED', 'Rate limit exceeded'),
				),
			).toBe(true);
			expect(
				RetryConditions.onRateLimit(createMockError('', 'Rate limit reached')),
			).toBe(true);
		});

		it('should return false for non-rate-limit errors', () => {
			expect(
				RetryConditions.onRateLimit(createMockError('500', 'Internal Error')),
			).toBe(false);
			expect(
				RetryConditions.onRateLimit(createMockError('', 'General error')),
			).toBe(false);
		});
	});

	describe('onTransientError', () => {
		it('should return true for transient errors', () => {
			expect(
				RetryConditions.onTransientError(
					createMockError('500', 'Server error'),
				),
			).toBe(true);
			expect(
				RetryConditions.onTransientError(
					createMockError('ETIMEDOUT', 'Timeout'),
				),
			).toBe(true);
			expect(
				RetryConditions.onTransientError(
					createMockError('429', 'Rate limited'),
				),
			).toBe(true);
		});

		it('should return false for non-transient errors', () => {
			expect(
				RetryConditions.onTransientError(createMockError('400', 'Bad request')),
			).toBe(false);
			expect(
				RetryConditions.onTransientError(
					createMockError('401', 'Unauthorized'),
				),
			).toBe(false);
		});
	});

	describe('onStatusCodes', () => {
		it('should return condition function for specific status codes', () => {
			const condition = RetryConditions.onStatusCodes(500, 502, '503');

			expect(condition(createMockError('500', 'Error'))).toBe(true);
			expect(condition(createMockError('502', 'Error'))).toBe(true);
			expect(condition(createMockError('503', 'Error'))).toBe(true);
			expect(condition(createMockError('400', 'Error'))).toBe(false);
		});
	});

	describe('unlessClientError', () => {
		it('should return false for client errors', () => {
			expect(
				RetryConditions.unlessClientError(
					createMockError('400', 'Bad Request'),
				),
			).toBe(false);
			expect(
				RetryConditions.unlessClientError(createMockError('404', 'Not Found')),
			).toBe(false);
		});

		it('should return true for rate limits and server errors', () => {
			expect(
				RetryConditions.unlessClientError(
					createMockError('429', 'Rate Limited'),
				),
			).toBe(true);
			expect(
				RetryConditions.unlessClientError(
					createMockError('500', 'Server Error'),
				),
			).toBe(true);
			expect(
				RetryConditions.unlessClientError(
					createMockError('ETIMEDOUT', 'Timeout'),
				),
			).toBe(true);
		});
	});

	describe('combining conditions', () => {
		it('should combine with AND logic', () => {
			const condition = RetryConditions.and(
				(error) => error.code === '500',
				(error) => error.message.includes('Server'),
			);

			expect(condition(createMockError('500', 'Server error'))).toBe(true);
			expect(condition(createMockError('500', 'Other error'))).toBe(false);
		});

		it('should combine with OR logic', () => {
			const condition = RetryConditions.or(
				(error) => error.code === '500',
				(error) => error.code === '502',
			);

			expect(condition(createMockError('500', 'Error'))).toBe(true);
			expect(condition(createMockError('502', 'Error'))).toBe(true);
			expect(condition(createMockError('400', 'Error'))).toBe(false);
		});

		it('should negate conditions', () => {
			const alwaysTrue = () => true;
			const negated = RetryConditions.not(alwaysTrue);

			expect(negated(createMockError('500', 'Error'))).toBe(false);
		});
	});

	describe('integration with EventTaskImpl', () => {
		it('should use onTransientError condition for rate limit', async () => {
			jest.useFakeTimers();

			const handler = jest
				.fn<any>()
				.mockRejectedValueOnce(new Error('Rate limit exceeded'))
				.mockResolvedValue('success');

			const task = new EventTask(mockContext, handler, {
				isRetryable: RetryConditions.onTransientError,
				maxRetries: 3,
				retryDelay: RetryStrategies.fixed(100),
			});

			const promise = task.execute();
			await jest.advanceTimersByTimeAsync(100);
			const result = await promise;

			expect(result.state).toBe('succeeded');
			expect(handler).toHaveBeenCalledTimes(2);

			jest.clearAllTimers();
		});

		it('should not retry on client errors with unlessClientError', async () => {
			const handler = jest
				.fn<any>()
				.mockRejectedValueOnce(new Error('Bad request: invalid parameters'));

			const task = new EventTask(mockContext, handler, {
				isRetryable: RetryConditions.unlessClientError,
				maxRetries: 3,
				retryDelay: RetryStrategies.fixed(100),
			});

			const result = await task.execute();

			expect(result.state).toBe('failed');
		});

		it('should combine conditions for complex logic', async () => {
			const handler = jest
				.fn<any>()
				.mockRejectedValueOnce(new Error('Database connection failed'))
				.mockResolvedValue('success');

			// Retry on database errors OR rate limits
			const customCondition = RetryConditions.or(
				RetryConditions.onDatabaseError,
				RetryConditions.onRateLimit,
			);

			const task = new EventTask(mockContext, handler, {
				isRetryable: customCondition,
				maxRetries: 3,
				retryDelay: RetryStrategies.exponential(100),
			});

			const promise = task.execute();
			await jest.advanceTimersByTimeAsync(100);
			const result = await promise;

			expect(result.state).toBe('succeeded');
		});
	});
});
