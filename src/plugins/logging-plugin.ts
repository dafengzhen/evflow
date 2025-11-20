import type {
	BaseEventDefinitions,
	EmitOptions,
	EventMiddleware,
	EventName,
	EventPlugin,
	EventState,
} from '../core/event.d.ts';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggingPluginOptions {
	/**
	 * Custom logger, uses console by default
	 * level: Log level
	 * message: Brief description
	 * meta: Additional data
	 */
	logger?: (
		level: LogLevel,
		message: string,
		meta?: Record<string, unknown>,
	) => void;

	/** Whether to log emit calls, defaults to true */
	logEmits?: boolean;

	/** Whether to log successfully completed emits, defaults to true */
	logSuccess?: boolean;

	/** Whether to log errors, defaults to true */
	logErrors?: boolean;

	/** Whether to log payload, defaults to true */
	logPayload?: boolean;

	/** Whether to log context, defaults to false (to prevent excessive size) */
	logContext?: boolean;

	/** Whether to log options, defaults to false */
	logOptions?: boolean;

	/** Event filter, returns false to skip logging for the event */
	filterEvent?: (eventName: string) => boolean;
}

const defaultLogger: NonNullable<LoggingPluginOptions['logger']> = (
	level,
	message,
	meta,
) => {
	const prefix = `[EventLogger][${level.toUpperCase()}]`;
	if (meta) {
		console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
			prefix,
			message,
			meta,
		);
	} else {
		console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
			prefix,
			message,
		);
	}
};

function shouldLogEvent(
	eventName: string,
	options?: LoggingPluginOptions,
): boolean {
	if (!options?.filterEvent) {
		return true;
	}
	return options.filterEvent(eventName);
}

/**
 * Keep only the meaningful and "serializable" fields from EmitOptions to avoid circular references.
 */
function sanitizeEmitOptions<
	T extends BaseEventDefinitions,
	K extends EventName<T>,
>(options?: EmitOptions<T, K>): Record<string, unknown> | undefined {
	if (!options) {
		return undefined;
	}

	const {
		timeout,
		maxRetries,
		retryDelay,
		throwOnError,
		__eventName__,
		isRetryable,
		onRetry,
		onStateChange,
		onTimeout,
		onCancel,
		signal,
		...rest
	} = options;

	return {
		...rest,
		timeout,
		maxRetries,
		retryDelay: typeof retryDelay === 'function' ? '[Function]' : retryDelay,
		throwOnError,
		__eventName__,
		hasSignal: !!signal,
		hasIsRetryable: !!isRetryable,
		hasOnRetry: !!onRetry,
		hasOnStateChange: !!onStateChange,
		hasOnTimeout: !!onTimeout,
		hasOnCancel: !!onCancel,
	};
}

function wrapEmitOptionsWithLogging<
	T extends BaseEventDefinitions,
	K extends EventName<T>,
>(
	eventName: string,
	options: EmitOptions<T, K> | undefined,
	logger: (
		level: LogLevel,
		message: string,
		meta?: Record<string, unknown>,
	) => void,
	_global: LoggingPluginOptions,
): EmitOptions<T, EventName<T>> | undefined {
	if (!options) {
		return options;
	}

	const originalOnStateChange = options.onStateChange;
	const originalOnRetry = options.onRetry;
	const originalOnTimeout = options.onTimeout;
	const originalOnCancel = options.onCancel;
	const originalIsRetryable = options.isRetryable;

	return {
		...options,
		onStateChange: (state: EventState) => {
			logger('debug', 'event state change', { eventName, state });
			originalOnStateChange?.(state);
		},
		onRetry: (attempt: number, error: unknown) => {
			logger('warn', 'event retry', { eventName, attempt, error });
			originalOnRetry?.(attempt, error);
		},
		onTimeout: (timeout: number) => {
			logger('warn', 'event timeout', { eventName, timeout });
			originalOnTimeout?.(timeout);
		},
		onCancel: () => {
			logger('info', 'event cancelled', { eventName });
			originalOnCancel?.();
		},
		isRetryable: (error: unknown) => {
			const result = originalIsRetryable ? originalIsRetryable(error) : true;
			logger('debug', 'isRetryable check', { eventName, error, result });
			return result;
		},
	};
}

/**
 * createLoggingPlugin.
 *
 * @author dafengzhen
 */
export function createLoggingPlugin<T extends BaseEventDefinitions>(
	options: LoggingPluginOptions = {},
): EventPlugin<T> {
	return (ctx) => {
		const logger = options.logger ?? defaultLogger;

		const middleware: EventMiddleware<T> = async (emitCtx, next) => {
			const { eventName } = emitCtx;

			if (!shouldLogEvent(eventName, options)) {
				return next();
			}

			const start = Date.now();

			if (options.logEmits !== false) {
				logger('info', 'emit start', {
					eventName,
					payload: options.logPayload ? emitCtx.payload : undefined,
					context: options.logContext ? emitCtx.context : undefined,
					options: options.logOptions
						? sanitizeEmitOptions(emitCtx.options)
						: undefined,
				});
			}

			// Wrap callbacks on EmitOptions to add logging
			emitCtx.options = wrapEmitOptionsWithLogging(
				eventName,
				emitCtx.options,
				logger,
				options,
			) as any;

			try {
				await next();
				const duration = Date.now() - start;

				if (options.logSuccess !== false) {
					logger('info', 'emit success', {
						eventName,
						duration,
					});
				}
			} catch (error) {
				const duration = Date.now() - start;

				if (options.logErrors !== false) {
					logger('error', 'emit error', {
						eventName,
						duration,
						error,
					});
				}

				// Preserve original behavior
				throw error;
			}
		};

		// Attach middleware via plugin context and clean up on plugin disposal
		const dispose = ctx.use(middleware);
		ctx.registerCleanup(dispose);
	};
}
