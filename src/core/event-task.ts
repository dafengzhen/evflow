import type {
	BaseEventDefinitions,
	EmitOptions,
	EventContext,
	EventListener,
	EventName,
	EventPayload,
	EventState,
	EventTaskOptions,
	IEventTask,
} from './types.ts';

/**
 * TaskError.
 *
 * @author dafengzhen
 */
export class TaskError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.code = code;
		this.name = 'TaskError';
	}
}

/**
 * TaskCancelledError.
 *
 * @author dafengzhen
 */
export class TaskCancelledError extends TaskError {
	constructor(message = 'Task was cancelled') {
		super('CANCELLED', message);
		this.name = 'TaskCancelledError';
	}
}

/**
 * TaskTimeoutError.
 *
 * @author dafengzhen
 */
export class TaskTimeoutError extends TaskError {
	readonly timeout: number;

	constructor(timeout: number, message?: string) {
		super('TIMEOUT', message ?? `Task timed out after ${timeout}ms`);
		this.timeout = timeout;
		this.name = 'TaskTimeoutError';
	}
}

/**
 * EventTask.
 *
 * @author dafengzhen
 */
export class EventTask<T extends BaseEventDefinitions, K extends EventName<T>>
	implements IEventTask<T, K>
{
	private readonly payload: EventPayload<T, K>;

	private readonly context: EventContext<T, K>;

	private readonly handler: EventListener<T, K>;

	private readonly options: EventTaskOptions<T, K>;

	constructor(
		payload: EventPayload<T, K>,
		context: EventContext<T, K>,
		handler: EventListener<T, K>,
		options: EmitOptions<T, K>,
	) {
		this.payload = payload;
		this.context = context;
		this.handler = handler;
		this.options = {
			isRetryable: options.isRetryable ?? (() => false),
			maxRetries: Math.max(0, options.maxRetries ?? 0),
			onRetry: options.onRetry ?? (() => {}),
			onStateChange: options.onStateChange ?? (() => {}),
			onCancel: options.onCancel ?? (() => {}),
			onTimeout: options.onTimeout ?? (() => {}),
			retryDelay: options.retryDelay ?? 0,
			signal: options.signal,
			timeout: Math.max(0, options.timeout ?? 0),
			throwOnError: options.throwOnError ?? false,
			__eventName__: options.__eventName__,
		};
	}

	async execute(): Promise<void> {
		let attempt = 0;
		let state: EventState = 'pending';

		const setState = (newState: EventState) => {
			if (state !== newState) {
				state = newState;
				this.options.onStateChange(newState);
			}
		};

		while (true) {
			try {
				if (this.isCancelled()) {
					// noinspection ExceptionCaughtLocallyJS
					throw new TaskCancelledError();
				}

				setState(attempt === 0 ? 'running' : 'retrying');

				await this.executeHandlerWithTimeout();

				setState('succeeded');

				break;
			} catch (err) {
				if (err instanceof TaskCancelledError) {
					setState('cancelled');
					this.options.onCancel();

					if (this.options.throwOnError) {
						throw err;
					} else {
						break;
					}
				}

				if (err instanceof TaskTimeoutError) {
					setState('timeout');
					this.options.onTimeout(this.options.timeout);
				}

				if (!this.shouldRetry(attempt, err)) {
					setState('failed');

					if (this.options.throwOnError) {
						throw err;
					} else {
						break;
					}
				}

				attempt++;
				this.options.onRetry(attempt, err);

				const delay = this.calculateRetryDelay(attempt);
				if (delay > 0) {
					try {
						await this.waitWithCancellation(delay);
					} catch (waitErr) {
						if (waitErr instanceof TaskCancelledError) {
							setState('cancelled');
							this.options.onCancel();

							if (this.options.throwOnError) {
								throw waitErr;
							} else {
								break;
							}
						}
						throw waitErr;
					}
				}
			}
		}
	}

	private createExtendedContext(signal?: AbortSignal): EventContext<T, K> {
		if (!signal) {
			return this.context;
		}

		const base = (this.context ?? {}) as Record<string, unknown> & {
			signal?: AbortSignal;
		};

		return {
			...base,
			signal,
		} as EventContext<T, K>;
	}

	private shouldRetry(attempt: number, error: unknown): boolean {
		return attempt < this.options.maxRetries && this.options.isRetryable(error);
	}

	private calculateRetryDelay(attempt: number): number {
		const d = this.options.retryDelay;
		return Math.max(0, typeof d === 'function' ? d(attempt) : d);
	}

	private isCancelled(): boolean {
		return this.options.signal?.aborted ?? false;
	}

	private executeHandlerWithTimeout(): Promise<void> {
		const { timeout, signal: outer } = this.options;

		if (!timeout && !outer) {
			return Promise.resolve(
				this.handler(this.payload, this.context, this.options),
			);
		}

		const controller = new AbortController();
		const inner = controller.signal;

		let timeoutId: ReturnType<typeof setTimeout> | null = null;
		let outerHandler: (() => void) | null = null;

		if (outer) {
			outerHandler = () => controller.abort();
			outer.addEventListener('abort', outerHandler);
		}

		if (timeout > 0) {
			timeoutId = setTimeout(() => controller.abort(), timeout);
		}

		const ctx = this.createExtendedContext(inner);

		const cleanup = () => {
			if (timeoutId !== null) {
				clearTimeout(timeoutId);
			}

			if (outer && outerHandler) {
				outer.removeEventListener('abort', outerHandler);
			}
		};

		return new Promise<void>((resolve, reject) => {
			const onAbort = () => {
				cleanup();
				if (outer?.aborted) {
					reject(new TaskCancelledError());
				} else {
					reject(new TaskTimeoutError(timeout));
				}
			};

			inner.addEventListener('abort', onAbort, { once: true });

			Promise.resolve(this.handler(this.payload, ctx, this.options)).then(
				(val) => {
					cleanup();
					resolve(val);
				},
				(err) => {
					cleanup();
					reject(err);
				},
			);
		});
	}

	private waitWithCancellation(ms: number): Promise<void> {
		const sig = this.options.signal;

		if (!sig) {
			return new Promise((res) => setTimeout(res, ms));
		}

		if (sig.aborted) {
			return Promise.reject(new TaskCancelledError('Cancelled during wait'));
		}

		return new Promise((resolve, reject) => {
			let timeoutId: ReturnType<typeof setTimeout> | null = null;

			const onAbort = () => {
				if (timeoutId !== null) {
					clearTimeout(timeoutId);
				}
				sig.removeEventListener('abort', onAbort);
				reject(new TaskCancelledError('Cancelled during wait'));
			};

			sig.addEventListener('abort', onAbort);

			timeoutId = setTimeout(() => {
				sig.removeEventListener('abort', onAbort);
				resolve();
			}, ms);
		});
	}
}
