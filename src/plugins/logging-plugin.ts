import type {
	BaseEventDefinitions,
	EmitOptions,
	EventMiddleware,
	EventName,
	EventPlugin,
	EventState,
} from '../core/types.ts';

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

/**
 * Format date like: 2025-11-21 10:15:30.123
 */
function formatDateForLog(date: Date): string {
	const pad = (n: number, width = 2) => String(n).padStart(width, '0');

	const year = date.getFullYear();
	const month = pad(date.getMonth() + 1);
	const day = pad(date.getDate());
	const hour = pad(date.getHours());
	const minute = pad(date.getMinutes());
	const second = pad(date.getSeconds());
	const ms = pad(date.getMilliseconds(), 3);

	return `${year}-${month}-${day} ${hour}:${minute}:${second}.${ms}`;
}

/**
 * defaultLogger.
 *
 * @author dafengzhen
 */
const defaultLogger: NonNullable<LoggingPluginOptions['logger']> = (
	level,
	message,
	meta,
) => {
	const now = new Date();
	const timestamp = formatDateForLog(now);

	const levelStr = level.toUpperCase().padEnd(5, ' '); // INFO / ERROR / DEBUG ...
	const pid =
		typeof process !== 'undefined'
			? String(process.pid).padStart(5, ' ')
			: '-----';

	const thread = '[main]';
	const loggerName = 'EventLogger';

	const prefix = `${timestamp}  ${levelStr} ${pid} --- ${thread} ${loggerName} : ${message}`;

	if (meta && Object.keys(meta).length > 0) {
		console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
			prefix,
			meta,
		);
	} else {
		console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](
			prefix,
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
	options: EmitOptions<T, K>,
	logger: (
		level: LogLevel,
		message: string,
		meta?: Record<string, unknown>,
	) => void,
): EmitOptions<T, EventName<T>> {
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

		const logEmits = options.logEmits !== false;
		const logSuccess = options.logSuccess !== false;
		const logErrors = options.logErrors !== false;
		const logPayload = options.logPayload !== false;
		const logContext = !!options.logContext;
		const logOptions = !!options.logOptions;
		const hasFilter = typeof options.filterEvent === 'function';

		if (!logEmits && !logSuccess && !logErrors && !hasFilter) {
			const noopDispose = () => {};
			ctx.registerCleanup(noopDispose);
			return;
		}

		const middleware: EventMiddleware<T> = async (emitCtx, next) => {
			const { eventName } = emitCtx;

			if (!shouldLogEvent(eventName, options)) {
				return next();
			}

			const needDuration = logSuccess || logErrors;
			const start = needDuration ? Date.now() : 0;

			if (logEmits) {
				logger('info', 'emit start', {
					eventName,
					payload: logPayload ? emitCtx.payload : undefined,
					context: logContext ? emitCtx.context : undefined,
					options: logOptions
						? sanitizeEmitOptions(emitCtx.options)
						: undefined,
				});
			}

			const originalOptions = emitCtx.options;
			const hasCallbacks =
				!!originalOptions &&
				(!!originalOptions.onStateChange ||
					!!originalOptions.onRetry ||
					!!originalOptions.onTimeout ||
					!!originalOptions.onCancel ||
					!!originalOptions.isRetryable);

			if (originalOptions && hasCallbacks) {
				emitCtx.options = wrapEmitOptionsWithLogging(
					eventName,
					originalOptions,
					logger,
				) as any;
			}

			try {
				await next();
				if (logSuccess) {
					const duration = needDuration ? Date.now() - start : undefined;
					logger('info', 'emit success', {
						eventName,
						duration,
					});
				}
			} catch (error) {
				if (logErrors) {
					const duration = needDuration ? Date.now() - start : undefined;
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

		const dispose = ctx.use(middleware);
		ctx.registerCleanup(dispose);
	};
}
