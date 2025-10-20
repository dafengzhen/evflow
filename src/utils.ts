import type { EventError } from './types/types.ts';

/**
 * sortByPriorityDesc.
 *
 * @param a a
 * @param b b
 */
export const sortByPriorityDesc = <T extends { priority: number }>(
	a: T,
	b: T,
) => b.priority - a.priority;

/**
 * sortByPriorityAsc.
 *
 * @param a a
 * @param b b
 */
export const sortByPriorityAsc = <T extends { priority: number }>(a: T, b: T) =>
	a.priority - b.priority;

/**
 * RetryStrategies.
 */
export const RetryStrategies = {
	exponential(
		baseDelay: number,
		maxDelay?: number,
	): (attempt: number) => number {
		return (attempt: number) => {
			const delay = baseDelay * 2 ** (attempt - 1);
			return maxDelay !== undefined ? Math.min(delay, maxDelay) : delay;
		};
	},
	fixed(delay: number): (attempt: number) => number {
		return () => delay;
	},
	jitter(
		baseDelay: number,
		jitterFactor: number = 0.5,
	): (attempt: number) => number {
		return (attempt: number) => {
			const delay = baseDelay * 2 ** (attempt - 1);
			const jitter = delay * jitterFactor * Math.random();
			return delay + jitter;
		};
	},
	linear(
		baseDelay: number,
		increment: number,
		maxDelay?: number,
	): (attempt: number) => number {
		return (attempt: number) => {
			const delay = baseDelay + increment * (attempt - 1);
			return maxDelay !== undefined ? Math.min(delay, maxDelay) : delay;
		};
	},
};

/**
 * RetryConditions.
 */
export const RetryConditions = {
	/**
	 * Always retry (default behavior when no isRetryable provided)
	 */
	always(): boolean {
		return true;
	},

	/**
	 * Combine multiple retry conditions with AND logic
	 */
	and(
		...conditions: ((error: EventError) => boolean)[]
	): (error: EventError) => boolean {
		return (error: EventError) => {
			return conditions.every((condition) => condition(error));
		};
	},

	/**
	 * Retry with exponential backoff for specific error types
	 */
	createExponentialRetryCondition(
		baseCondition: (error: EventError) => boolean,
		maxAttempts: number = 5,
	): (error: EventError, attempt: number) => boolean {
		return (error: EventError, attempt: number) => {
			return attempt < maxAttempts && baseCondition(error);
		};
	},

	/**
	 * Never retry
	 */
	never(): boolean {
		return false;
	},

	/**
	 * Negate a retry condition
	 */
	not(
		condition: (error: EventError) => boolean,
	): (error: EventError) => boolean {
		return (error: EventError) => {
			return !condition(error);
		};
	},

	/**
	 * Retry on database connection errors
	 */
	onDatabaseError: (error: EventError): boolean => {
		const databaseErrorPatterns = [
			'database',
			'sql',
			'connection pool',
			'deadlock',
			'timeout',
			'query timeout',
			'ECONNREFUSED',
			'sequelize',
		];

		const message = error.message.toLowerCase();
		const code = error.code?.toLowerCase() || '';

		return databaseErrorPatterns.some(
			(pattern) => message.includes(pattern) || code.includes(pattern),
		);
	},

	/**
	 * Retry on specific error codes
	 */
	onErrorCodes(...errorCodes: string[]): (error: EventError) => boolean {
		return (error: EventError) => {
			return errorCodes.some((code) => code === error.code);
		};
	},

	/**
	 * Retry based on error message patterns
	 */
	onMessagePatterns(...patterns: string[]): (error: EventError) => boolean {
		return (error: EventError) => {
			const message = error.message.toLowerCase();
			return patterns.some((pattern) =>
				message.includes(pattern.toLowerCase()),
			);
		};
	},

	/**
	 * Retry on network-related errors
	 */
	onNetworkError(error: EventError): boolean {
		const networkErrorPatterns = [
			'network',
			'timeout',
			'socket',
			'connection',
			'ECONN',
			'ETIMEDOUT',
			'ENOTFOUND',
			'EAI_AGAIN',
		];

		const message = error.message.toLowerCase();
		const code = error.code?.toLowerCase() || '';

		return networkErrorPatterns.some(
			(pattern) => message.includes(pattern) || code.includes(pattern),
		);
	},

	/**
	 * Retry on rate limiting (429 status code)
	 */
	onRateLimit(error: EventError): boolean {
		return (
			error.code === '429' ||
			error.code === 'RATE_LIMITED' ||
			error.message.toLowerCase().includes('rate limit') ||
			error.message.toLowerCase().includes('too many requests')
		);
	},

	/**
	 * Retry on server errors (5xx status codes)
	 */
	onServerError(error: EventError): boolean {
		if (error.code && /^5\d{2}$/.test(error.code)) {
			return true;
		}

		const serverErrorPatterns = [
			'internal server error',
			'service unavailable',
			'bad gateway',
			'gateway timeout',
		];

		const message = error.message.toLowerCase();
		return serverErrorPatterns.some((pattern) => message.includes(pattern));
	},

	/**
	 * Retry on third-party service unavailability
	 */
	onServiceUnavailable: (error: EventError): boolean => {
		const serviceErrorPatterns = [
			'service unavailable',
			'third party',
			'external service',
			'upstream',
			'provider',
		];

		const message = error.message.toLowerCase();
		return (
			RetryConditions.onServerError(error) ||
			serviceErrorPatterns.some((pattern) => message.includes(pattern))
		);
	},

	/**
	 * Retry on specific HTTP status codes
	 */
	onStatusCodes(
		...statusCodes: (number | string)[]
	): (error: EventError) => boolean {
		return (error: EventError) => {
			return statusCodes.some((code) => code.toString() === error.code);
		};
	},

	/**
	 * Retry on transient errors (network + server errors + rate limits)
	 */
	onTransientError: (error: EventError): boolean => {
		// 使用箭头函数或直接引用其他方法
		return (
			RetryConditions.onNetworkError(error) ||
			RetryConditions.onServerError(error) ||
			RetryConditions.onRateLimit(error)
		);
	},

	/**
	 * Combine multiple retry conditions with OR logic
	 */
	or(
		...conditions: ((error: EventError) => boolean)[]
	): (error: EventError) => boolean {
		return (error: EventError) => {
			return conditions.some((condition) => condition(error));
		};
	},

	/**
	 * Retry unless it's a client error (4xx, except 429)
	 */
	unlessClientError: (error: EventError): boolean => {
		if (error.code && /^4\d{2}$/.test(error.code) && error.code !== '429') {
			return false;
		}

		const clientErrorPatterns = [
			'bad request',
			'unauthorized',
			'forbidden',
			'not found',
			'method not allowed',
		];

		const message = error.message.toLowerCase();
		return !clientErrorPatterns.some((pattern) => message.includes(pattern));
	},
};
