import {
	afterEach,
	beforeEach,
	describe,
	expect,
	jest,
	test,
} from '@jest/globals';
import type {
	BaseEventDefinitions,
	EmitOptions,
	EventContext,
	EventListener,
	EventName,
	EventPayload,
} from '../core/event.d.ts';
import {
	EventTask,
	TaskCancelledError,
	TaskTimeoutError,
} from '../core/index.ts';

interface TestEvents extends BaseEventDefinitions {
	'test:event': {
		payload: { value: number };
		context?: { meta?: string };
	};
}

type TEvents = TestEvents;
type KTest = EventName<TEvents>;

describe('EventTask', () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
		jest.clearAllMocks();
	});

	const createTask = (
		handler: EventListener<TEvents, KTest>,
		options: Partial<EmitOptions<TEvents, KTest>> = {},
		payload: EventPayload<TEvents, KTest> = { value: 42 },
		context: EventContext<TEvents, KTest> = { meta: 'ctx' },
	) =>
		new EventTask<TEvents, KTest>(payload, context, handler, {
			throwOnError: true,
			...options,
		} as EmitOptions<TEvents, KTest>);

	test('Executes handler normally (no timeout, no retries)', async () => {
		const handler = jest.fn<any>(async () => {});

		const onStateChange = jest.fn();
		const task = createTask(handler, {
			onStateChange,
		});

		await task.execute();

		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith({ value: 42 }, { meta: 'ctx' });

		// State transitions: pending -> running -> succeeded
		expect(onStateChange.mock.calls.map((c) => c[0])).toEqual([
			'running',
			'succeeded',
		]);
	});

	test('Marks as failed on first failure when isRetryable=false', async () => {
		const handler = jest.fn<any>().mockRejectedValue(new Error('boom'));
		const onRetry = jest.fn();
		const onStateChange = jest.fn();

		const task = createTask(handler, {
			maxRetries: 3 as any,
			isRetryable: () => false,
			onRetry,
			onStateChange,
		});

		await expect(task.execute()).rejects.toThrow('boom');

		expect(handler).toHaveBeenCalledTimes(1);
		expect(onRetry).not.toHaveBeenCalled();
		// running -> failed
		expect(onStateChange.mock.calls.map((c) => c[0])).toEqual([
			'running',
			'failed',
		]);
	});

	test('Retries according to maxRetries for retryable errors and eventually succeeds', async () => {
		const handler = jest
			.fn<EventListener<TEvents, KTest>>()
			.mockImplementationOnce(async () => {
				throw new Error('first');
			})
			.mockImplementationOnce(async () => {
				throw new Error('second');
			})
			.mockImplementationOnce(async () => {
				// Succeeds on the third attempt
			});

		const onRetry = jest.fn();
		const onStateChange = jest.fn();

		const task = createTask(handler, {
			maxRetries: 2 as any, // Up to 2 retries -> maximum 3 total executions
			isRetryable: () => true,
			retryDelay: 10 as any,
			onRetry,
			onStateChange,
		});

		const promise = task.execute();

		// Execute first handler (fails)
		await Promise.resolve();
		// Wait before first retry
		jest.advanceTimersByTime(10);
		await Promise.resolve();

		// Execute second handler (fails)
		await Promise.resolve();
		// Wait before second retry
		jest.advanceTimersByTime(10);
		await Promise.resolve();

		// Execute third handler (succeeds)
		await promise;

		expect(handler).toHaveBeenCalledTimes(3);

		// onRetry is called for each failure that leads to a retry
		expect(onRetry).toHaveBeenCalledTimes(2);
		expect(onRetry.mock.calls[0][0]).toBe(1); // First retry attempt=1
		expect(onRetry.mock.calls[1][0]).toBe(2); // Second retry attempt=2

		// State: pending -> running -> retrying -> succeeded
		expect(onStateChange.mock.calls.map((c) => c[0])).toEqual([
			'running',
			'retrying',
			'succeeded',
		]);
	});

	test('Throws TaskTimeoutError on timeout and triggers onTimeout & state change', async () => {
		const handler = jest.fn(
			() =>
				new Promise<void>(() => {
					// Never resolves
				}),
		);

		const onTimeout = jest.fn();
		const onStateChange = jest.fn();

		const task = createTask(handler, {
			timeout: 100 as any,
			onTimeout,
			onStateChange,
			isRetryable: () => false,
		});

		const promise = task.execute();

		// Advance time to trigger timeout
		jest.advanceTimersByTime(150);

		await expect(promise).rejects.toBeInstanceOf(TaskTimeoutError);

		expect(handler).toHaveBeenCalledTimes(1);
		expect(onTimeout).toHaveBeenCalledTimes(1);
		expect(onTimeout).toHaveBeenCalledWith(100);

		// State: running -> timeout -> failed
		expect(onStateChange.mock.calls.map((c) => c[0])).toEqual([
			'running',
			'timeout',
			'failed',
		]);
	});

	test('External signal already cancelled before start -> directly throws TaskCancelledError', async () => {
		const ac = new AbortController();
		ac.abort();

		const handler = jest.fn<any>();
		const onCancel = jest.fn();
		const onStateChange = jest.fn();

		const task = createTask(handler, {
			signal: ac.signal,
			onCancel,
			onStateChange,
		});

		await expect(task.execute()).rejects.toBeInstanceOf(TaskCancelledError);

		expect(handler).not.toHaveBeenCalled();
		expect(onCancel).toHaveBeenCalledTimes(1);
		// State: pending -> cancelled
		expect(onStateChange.mock.calls.map((c) => c[0])).toEqual(['cancelled']);
	});

	test('External signal cancellation during execution -> TaskCancelledError & onCancel & state cancelled', async () => {
		const ac = new AbortController();

		const handler = jest.fn(
			() =>
				new Promise<void>((_resolve, _reject) => {
					// Abort after a short delay
					setTimeout(() => ac.abort(), 50);
				}),
		);

		const onCancel = jest.fn();
		const onStateChange = jest.fn();

		const task = createTask(handler, {
			signal: ac.signal,
			timeout: 1000 as any,
			onCancel,
			onStateChange,
			isRetryable: () => false,
		});

		const promise = task.execute();

		jest.advanceTimersByTime(60);

		await expect(promise).rejects.toBeInstanceOf(TaskCancelledError);

		expect(handler).toHaveBeenCalledTimes(1);
		expect(onCancel).toHaveBeenCalledTimes(1);
		// running -> cancelled
		expect(onStateChange.mock.calls.map((c) => c[0])).toEqual([
			'running',
			'cancelled',
		]);
	});

	test('Handler receives extended context.signal when timeout and signal are configured', async () => {
		const outer = new AbortController();

		const handler = jest.fn<any>(async (_payload: any, ctx: any) => {
			// Internal signal should exist
			expect(ctx).toBeDefined();
			expect((ctx as any).signal).toBeDefined();
			expect((ctx as any).signal).not.toBe(outer.signal);
		});

		const task = createTask(handler, {
			timeout: 100 as any,
			signal: outer.signal,
		});

		await task.execute();

		expect(handler).toHaveBeenCalledTimes(1);
	});

	test('Throws TaskCancelledError when cancelled during retry delay', async () => {
		const ac = new AbortController();

		const handler = jest.fn<any>().mockRejectedValue(new Error('boom'));
		const onCancel = jest.fn();

		const task = createTask(handler, {
			signal: ac.signal,
			maxRetries: 1,
			isRetryable: () => true,
			retryDelay: 1000,
			onCancel,
		});

		const promise = task.execute();

		// Let the first execution fail
		await Promise.resolve();

		// Cancel during the waiting period
		ac.abort();
		jest.advanceTimersByTime(10);

		await expect(promise).rejects.toBeInstanceOf(TaskCancelledError);
		expect(onCancel).toHaveBeenCalledTimes(1);
	});
});
