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
	EventContext,
	EventPayload,
} from '../core/event.d.ts';
import { createEventEmitter, TaskTimeoutError } from '../core/index.ts';

interface TestEvents extends BaseEventDefinitions {
	'test:event': {
		payload: { value: number };
		context?: { meta?: string };
	};
	'other:event': {
		payload: { message: string };
		context?: EventContext<BaseEventDefinitions, any>;
	};
}

type TEvents = TestEvents;

describe('BaseEventEmitter', () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
		jest.clearAllMocks();
	});

	test('Basic on / emit: Listener receives correct payload and context', async () => {
		const emitter = createEventEmitter<TEvents>();
		const listener = jest.fn<any>(async () => {});

		emitter.on('test:event', listener);

		const payload: EventPayload<TEvents, 'test:event'> = { value: 123 };
		const context: EventContext<TEvents, 'test:event'> = { meta: 'ctx' };

		await emitter.emit('test:event', payload, context);

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(
			{ value: 123 },
			{ meta: 'ctx' },
			expect.any(Object),
		);
	});

	test('Emitting without listeners does not throw an error', async () => {
		const emitter = createEventEmitter<TEvents>();

		await expect(
			emitter.emit('test:event', { value: 1 }, { meta: 'x' }),
		).resolves.toBeUndefined();
	});

	test('Once listener is called only once', async () => {
		const emitter = createEventEmitter<TEvents>();

		const listener = jest.fn<any>(async () => {});

		emitter.once('test:event', listener);

		await emitter.emit('test:event', { value: 1 }, { meta: 'a' });
		await emitter.emit('test:event', { value: 2 }, { meta: 'b' });

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener.mock.calls[0][0]).toEqual({ value: 1 });
	});

	test('The unsubscribe function returned by on can remove the listener', async () => {
		const emitter = createEventEmitter<TEvents>();

		const listener = jest.fn<any>(async () => {});
		const off = emitter.on('test:event', listener);

		await emitter.emit('test:event', { value: 1 }, { meta: 'a' });
		off();
		await emitter.emit('test:event', { value: 2 }, { meta: 'b' });

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener.mock.calls[0][0]).toEqual({ value: 1 });
	});

	test('off can remove the listener', async () => {
		const emitter = createEventEmitter<TEvents>();

		const listener = jest.fn(async () => {});
		emitter.on('test:event', listener);

		await emitter.emit('test:event', { value: 1 }, { meta: 'a' });
		emitter.off('test:event', listener);
		await emitter.emit('test:event', { value: 2 }, { meta: 'b' });

		expect(listener).toHaveBeenCalledTimes(1);
	});

	test('Listeners are executed in order from highest to lowest priority', async () => {
		const emitter = createEventEmitter<TEvents>();
		const calls: string[] = [];

		const l1 = jest.fn(async () => {
			calls.push('p0');
		});
		const l2 = jest.fn(async () => {
			calls.push('p10-first');
		});
		const l3 = jest.fn(async () => {
			calls.push('p10-second');
		});

		emitter.on('test:event', l1, { priority: 0 });
		emitter.on('test:event', l2, { priority: 10 });
		emitter.on('test:event', l3, { priority: 10 });

		await emitter.emit('test:event', { value: 1 }, { meta: 'x' });

		// The two with priority 10 execute first, maintaining insertion order, then priority 0
		expect(calls).toEqual(['p10-first', 'p10-second', 'p0']);
	});

	test('Listeners for the same event execute sequentially (waiting for each one)', async () => {
		const emitter = createEventEmitter<TEvents>();
		const order: string[] = [];

		const l1 = jest.fn(
			() =>
				new Promise<void>((resolve) => {
					setTimeout(() => {
						order.push('first');
						resolve();
					}, 50);
				}),
		);

		const l2 = jest.fn(async () => {
			order.push('second');
		});

		emitter.on('test:event', l1);
		emitter.on('test:event', l2);

		const emitPromise = emitter.emit('test:event', { value: 1 }, { meta: 'x' });

		jest.advanceTimersByTime(60);
		await emitPromise;

		expect(order).toEqual(['first', 'second']);
	});

	test('Options passed to emit are used for EventTask (e.g., timeout)', async () => {
		const emitter = createEventEmitter<TEvents>();

		const listener = jest.fn(
			() =>
				new Promise<void>(() => {
					// Never resolves, triggering timeout
				}),
		);

		emitter.on('test:event', listener);

		const onTimeout = jest.fn();

		const emitPromise = emitter.emit(
			'test:event',
			{ value: 1 },
			{ meta: 'x' },
			{
				timeout: 100,
				isRetryable: () => false,
				onTimeout,
				throwOnError: true,
			},
		);

		jest.advanceTimersByTime(150);

		await expect(emitPromise).rejects.toBeInstanceOf(TaskTimeoutError);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(onTimeout).toHaveBeenCalledWith(100);
	});

	test('Listener with once:true is removed after emit', async () => {
		const emitter = createEventEmitter<TEvents>();

		const listener = jest.fn(async () => {});

		emitter.on('test:event', listener, { once: true });

		await emitter.emit('test:event', { value: 1 }, { meta: 'x' });
		await emitter.emit('test:event', { value: 2 }, { meta: 'y' });

		expect(listener).toHaveBeenCalledTimes(1);
	});
});
