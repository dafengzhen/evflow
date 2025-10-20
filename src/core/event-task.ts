import type {
	EventContext,
	EventEmitResult,
	EventError,
	EventHandler,
	EventState,
	EventTaskOptions,
	IEventTask,
	NormalizedEventTaskOptions,
} from '../types/types.ts';

/**
 * EventTask.
 *
 * @author dafengzhen
 */
export class EventTask<R = unknown> implements IEventTask<R> {
	private readonly originalContext: EventContext;

	private readonly handler: EventHandler<any, any, any, any>;

	private readonly opts: NormalizedEventTaskOptions;

	constructor(
		context: EventContext,
		handler: EventHandler<any, any, any, any>,
		options: EventTaskOptions = {},
	) {
		this.originalContext = context;
		this.handler = handler;
		this.opts = this.normalizeOptions(options);
	}

	async execute(): Promise<EventEmitResult<R>> {
		let attempt = 0;
		let state: EventState = 'pending';

		const setState = (newState: EventState) => {
			if (state !== newState) {
				state = newState;
				this.safeCall(() => this.opts.onStateChange(newState));
			}
		};

		try {
			setState('running');

			while (attempt <= this.opts.maxRetries) {
				this.throwIfCancelled();

				try {
					const result = await this.executeHandlerWithTimeout();
					setState('succeeded');
					return this.createSuccessResult(result);
				} catch (rawError) {
					const error = this.normalizeError(rawError);

					if (error.code === 'TIMEOUT') {
						this.safeCall(() =>
							this.opts.onTimeout(this.opts.timeout, 'handler-execution'),
						);
					}

					if (error.code === 'CANCELLED') {
						setState('cancelled');
						return this.createCancelledResult(error);
					}

					if (!this.shouldRetry(attempt, error)) {
						setState('failed');
						return this.createFailedResult(error);
					}

					attempt++;
					setState('retrying');
					this.safeCall(() => this.opts.onRetry(attempt, error));

					const delay = this.calculateRetryDelay(attempt);
					if (delay > 0) {
						await this.waitWithCancellation(delay);
					}
				}
			}

			setState('failed');
			return this.createFailedResult(
				this.createError('UNKNOWN', 'Max retries exceeded'),
			);
		} catch (rawError) {
			const error = this.normalizeError(rawError);
			if (error.code === 'CANCELLED') {
				setState('cancelled');
				return this.createCancelledResult(error);
			}
			setState('failed');
			return this.createFailedResult(error);
		}
	}

	private normalizeOptions(
		options: EventTaskOptions,
	): NormalizedEventTaskOptions {
		return {
			isRetryable: options.isRetryable ?? (() => true),
			maxRetries: Math.max(0, options.maxRetries ?? 0),
			onRetry: options.onRetry ?? (() => {}),
			onStateChange: options.onStateChange ?? (() => {}),
			onTimeout: options.onTimeout ?? (() => {}),
			retryDelay: options.retryDelay ?? 0,
			signal: options.signal ?? undefined,
			timeout: Math.max(0, options.timeout ?? 0),
		};
	}

	private createExtendedContext(): EventContext & { signal?: AbortSignal } {
		const originalContext = this.originalContext;
		const opts = this.opts;
		return {
			...originalContext,
			meta: originalContext.meta ?? {},
			signal: opts.signal,
		};
	}

	private safeCall(callback: () => void): void {
		try {
			callback();
		} catch (_err) {}
	}

	private shouldRetry(attempt: number, error: EventError): boolean {
		return attempt < this.opts.maxRetries && this.opts.isRetryable(error);
	}

	private calculateRetryDelay(attempt: number): number {
		const { retryDelay } = this.opts;
		return Math.max(
			0,
			typeof retryDelay === 'function' ? retryDelay(attempt) : retryDelay,
		);
	}

	private createSuccessResult(result: R): EventEmitResult<R> {
		return { state: 'succeeded', result, error: undefined };
	}

	private createFailedResult(error: EventError): EventEmitResult<R> {
		return { state: 'failed', result: undefined, error };
	}

	private createCancelledResult(error: EventError): EventEmitResult<R> {
		return { state: 'cancelled', result: undefined, error };
	}

	private isCancelled(): boolean {
		return this.opts.signal?.aborted ?? false;
	}

	private throwIfCancelled(): void {
		if (this.isCancelled()) {
			throw this.createError('CANCELLED', 'Task was cancelled');
		}
	}

	private createError(
		code: string,
		message: string,
		originalError?: unknown,
	): EventError {
		return {
			code,
			message,
			error: originalError,
			stack: originalError instanceof Error ? originalError.stack : undefined,
		};
	}

	private normalizeError(error: unknown): EventError {
		if (this.isEventError(error)) {
			return error;
		}

		if (error instanceof Error) {
			return {
				code: (error as any).code ?? 'UNKNOWN',
				message: error.message,
				error,
				stack: error.stack,
			};
		}

		if (error && typeof error === 'object') {
			const objError = error as Record<string, unknown>;
			let message: string;

			if (typeof objError.message === 'string') {
				message = objError.message;
			} else {
				try {
					message = JSON.stringify(objError);
				} catch {
					message = String(objError.toString?.() ?? 'Unknown error');
				}
			}

			return {
				code: String(objError.code ?? 'UNKNOWN'),
				message,
				error,
				stack: typeof objError.stack === 'string' ? objError.stack : '',
			};
		}

		return {
			code: 'UNKNOWN',
			message: String(error ?? 'Unknown error'),
			error,
			stack: '',
		};
	}

	private isEventError(error: unknown): error is EventError {
		return (
			typeof error === 'object' &&
			error !== null &&
			'code' in error &&
			'message' in error
		);
	}

	private async executeHandlerWithTimeout(): Promise<R> {
		const extendedContext = this.createExtendedContext();

		if (!this.opts.timeout && !this.opts.signal) {
			return await Promise.resolve(this.handler(extendedContext));
		}

		const controller = new AbortController();
		let timeoutId: ReturnType<typeof setTimeout> | undefined;

		const cleanup = () => {
			if (timeoutId !== undefined) {
				clearTimeout(timeoutId);
				timeoutId = undefined;
			}
			this.opts.signal?.removeEventListener('abort', handleAbort);
		};

		const handleAbort = () => {
			cleanup();
			controller.abort();
		};

		if (this.opts.timeout > 0) {
			timeoutId = setTimeout(() => {
				if (!controller.signal.aborted) {
					controller.abort();
				}
			}, this.opts.timeout);
		}

		this.opts.signal?.addEventListener('abort', handleAbort);

		try {
			return await Promise.race([
				Promise.resolve(this.handler(extendedContext)),
				new Promise<never>((_, reject) => {
					controller.signal.addEventListener(
						'abort',
						() => {
							cleanup();
							reject(
								this.opts.signal?.aborted
									? this.createError('CANCELLED', 'Task was cancelled')
									: this.createError(
											'TIMEOUT',
											`Task timed out after ${this.opts.timeout}ms`,
										),
							);
						},
						{ once: true },
					);
				}),
			]);
		} finally {
			cleanup();
		}
	}

	private async waitWithCancellation(ms: number): Promise<void> {
		if (ms <= 0) {
			this.throwIfCancelled();
			return;
		}

		return new Promise((resolve, reject) => {
			this.throwIfCancelled();

			const timeoutId = setTimeout(() => {
				cleanup();
				resolve();
			}, ms);

			const handleAbort = () => {
				cleanup();
				reject(this.createError('CANCELLED', 'Task was cancelled during wait'));
			};

			const cleanup = () => {
				clearTimeout(timeoutId);
				this.opts.signal?.removeEventListener('abort', handleAbort);
			};

			this.opts.signal?.addEventListener('abort', handleAbort);
		});
	}
}
