import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	jest,
} from '@jest/globals';
import type { EventContext } from '../types/types.ts';
import { EventTask } from './event-task.ts';

describe('EventTask', () => {
	let mockContext: EventContext;

	beforeEach(() => {
		mockContext = { data: {} };
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('should execute handler successfully', async () => {
		const handler = jest.fn<any>().mockResolvedValue('success');
		const task = new EventTask(mockContext, handler);

		const result = await task.execute();

		expect(result.state).toBe('succeeded');
		expect(result.result).toBe('success');
		expect(result.error).toBeUndefined();
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it('should handle thrown Error instance', async () => {
		const handler = jest.fn<any>().mockRejectedValue(new Error('boom'));
		const task = new EventTask(mockContext, handler);

		const result = await task.execute();

		expect(result.state).toBe('failed');
		expect(result.error?.message).toBe('boom');
		expect(result.error?.code).toBe('UNKNOWN');
	});

	it('should normalize error when handler throws object', async () => {
		const handler = jest.fn<any>().mockRejectedValue({ someProperty: 'value' });
		const task = new EventTask(mockContext, handler);

		const result = await task.execute();

		expect(result.state).toBe('failed');
		expect(result.error?.code).toBe('UNKNOWN');
		expect(result.error?.message).toBe('{"someProperty":"value"}');
	});

	it('should normalize string error', async () => {
		const handler = jest.fn<any>().mockRejectedValue('fatal');
		const task = new EventTask(mockContext, handler);

		const result = await task.execute();

		expect(result.state).toBe('failed');
		expect(result.error?.message).toBe('fatal');
		expect(result.error?.code).toBe('UNKNOWN');
	});

	it('should timeout if handler exceeds timeout', async () => {
		const handler = jest.fn(
			() => new Promise((resolve) => setTimeout(() => resolve('late'), 2000)),
		);
		const onTimeout = jest.fn<any>();

		const task = new EventTask(mockContext, handler, {
			timeout: 1000,
			onTimeout,
		});

		const promise = task.execute();
		jest.advanceTimersByTime(1100);

		const result = await promise;

		expect(result.state).toBe('failed');
		expect(result.error?.code).toBe('TIMEOUT');
		expect(onTimeout).toHaveBeenCalledWith(1000, 'handler-execution');
	});

	it('should cancel if signal is aborted before execution', async () => {
		const controller = new AbortController();
		controller.abort();

		const handler = jest.fn<any>();
		const task = new EventTask(mockContext, handler, {
			signal: controller.signal,
		});

		const result = await task.execute();

		expect(result.state).toBe('cancelled');
		expect(result.error?.code).toBe('CANCELLED');
		expect(handler).not.toHaveBeenCalled();
	});

	it('should cancel while waiting during retry delay', async () => {
		const controller = new AbortController();
		const handler = jest
			.fn<any>()
			.mockRejectedValueOnce(new Error('fail'))
			.mockResolvedValue('ok');

		const task = new EventTask(mockContext, handler, {
			maxRetries: 1,
			retryDelay: 1000,
			signal: controller.signal,
		});

		const promise = task.execute();

		setTimeout(() => controller.abort(), 100);
		jest.advanceTimersByTime(2000);

		const result = await promise;

		expect(result.state).toBe('cancelled');
		expect(result.error?.code).toBe('CANCELLED');
	});

	it('should retry on failure up to maxRetries', async () => {
		const handler = jest
			.fn<any>()
			.mockRejectedValueOnce(new Error('1'))
			.mockRejectedValueOnce(new Error('2'))
			.mockResolvedValue('success');

		const onRetry = jest.fn<any>();
		const task = new EventTask(mockContext, handler, {
			maxRetries: 2,
			retryDelay: 100,
			onRetry,
		});

		const promise = task.execute();

		await jest.runAllTimersAsync();

		const result = await promise;

		expect(handler).toHaveBeenCalledTimes(3);
		expect(onRetry).toHaveBeenCalledTimes(2);
		expect(result.state).toBe('succeeded');
		expect(result.result).toBe('success');
	});

	it('should trigger onStateChange on state transitions', async () => {
		const handler = jest.fn<any>().mockResolvedValue('ok');
		const onStateChange = jest.fn<any>();

		const task = new EventTask(mockContext, handler, { onStateChange });

		await task.execute();

		expect(onStateChange).toHaveBeenCalledWith('running');
		expect(onStateChange).toHaveBeenCalledWith('succeeded');
		expect(onStateChange).toHaveBeenCalledTimes(2);
	});

	it('should fail after exceeding max retries', async () => {
		const handler = jest.fn<any>().mockRejectedValue(new Error('boom'));
		const task = new EventTask(mockContext, handler, { maxRetries: 2 });

		const result = await task.execute();

		expect(result.state).toBe('failed');
		expect(result.error?.message).toContain('boom');
	});
});
