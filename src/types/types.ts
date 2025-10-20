import type { LifecyclePhase } from '../enums.ts';

export type PlainObject = Record<string, unknown>;

export type StringKeyOf<T> = Extract<keyof T, string>;

export type RetryDelayFunction = (attempt: number) => number;

export type EventState =
	| 'cancelled'
	| 'failed'
	| 'pending'
	| 'retrying'
	| 'running'
	| 'succeeded'
	| 'timeout';

export interface EventError {
	code?: string;
	error?: unknown;
	message: string;
	stack?: string;
}

export interface EventMap {
	[eventName: string]: PlainObject;
}

export interface EventContext<
	T extends PlainObject = PlainObject,
	GC extends PlainObject = PlainObject,
> {
	data: T;
	global?: GC;
	meta?: {
		eventName?: string;
		startTime?: number;
		endTime?: number;
		lifecyclePhase?: LifecyclePhase;
	} & PlainObject;
	signal?: AbortSignal;
}

export interface NormalizedEventTaskOptions {
	isRetryable: (error: EventError) => boolean;
	maxRetries: number;
	onRetry: (attempt: number, error: EventError) => void;
	onStateChange: (state: EventState) => void;
	onTimeout: (timeout: number, phase: string) => void;
	retryDelay: number | ((attempt: number) => number);
	signal?: AbortSignal;
	timeout: number;
}

export interface EventTaskOptions {
	timeout?: number;
	signal?: AbortSignal;
	maxRetries?: number;
	retryDelay?: number | RetryDelayFunction;
	isRetryable?: (error: EventError) => boolean;
	onRetry?: (attempt: number, error: EventError) => void;
	onStateChange?: (state: EventState) => void;
	onTimeout?: (timeout: number, phase: string) => void;
}

export interface EventEmitOptions {
	traceId?: string;
	parallel?: boolean;
	stopOnError?: boolean;
	ignoreNoHandlersWarning?: boolean;
	globalTimeout?: number;
	maxConcurrency?: number;
}

export interface EventEmitResult<R = unknown> {
	result?: R;
	error?: EventError;
	state: EventState;
	traceId?: string;
}

export interface EventExecutionInfo<R = unknown> {
	eventName: string;
	handlerCount: number;
	middlewareCount: number;
	inProgress: boolean;
	hasError: boolean;
	results: EventEmitResult<R>[];
	traceId?: string;
	lifecycle?: {
		startTime: number;
		endTime?: number;
		phase: LifecyclePhase;
		currentHandlerIndex?: number;
		currentMiddlewareIndex?: number;
	};
}

export type MiddlewareNext<R = unknown> = () => Promise<R>;

export interface MiddlewareOptions {
	filter?: (context: EventContext) => boolean;
	priority?: number;
	throwOnEventError?: boolean;
}

export type EventHandler<
	EM extends EventMap,
	K extends StringKeyOf<EM>,
	R = unknown,
	GC extends PlainObject = PlainObject,
> = (context: EventContext<EM[K], GC>) => Promise<R> | R;

export type EventMiddleware<
	EM extends EventMap,
	K extends StringKeyOf<EM>,
	R = unknown,
	GC extends PlainObject = PlainObject,
> = (
	context: EventContext<EM[K], GC>,
	next: MiddlewareNext<R>,
	info: EventExecutionInfo<R>,
) => Promise<R>;

export interface MiddlewareWrapper<
	EM extends EventMap,
	K extends StringKeyOf<EM>,
	R = unknown,
	GC extends PlainObject = PlainObject,
> {
	middleware: EventMiddleware<EM, K, R, GC>;
	priority: number;
	filter?: (context: EventContext<EM[K], GC>) => boolean;
	throwOnEventError?: boolean;
}

export interface IEventTask<R = unknown> {
	execute(): Promise<EventEmitResult<R>>;
}

export interface EventBusPlugin<
	EM extends EventMap = EventMap,
	GC extends PlainObject = PlainObject,
> {
	install(bus: IEventBus<EM, GC>): Promise<void> | void;
	uninstall?(bus: IEventBus<EM, GC>): Promise<void> | void;
}

export interface InstalledPlugin<
	EM extends EventMap,
	GC extends PlainObject = PlainObject,
> {
	plugin: EventBusPlugin<EM, GC>;
}

export interface PatternMatchingOptions {
	allowZeroLengthDoubleWildcard?: boolean;
	matchMultiple?: boolean;
	separator?: string;
	wildcard?: string;
}

export interface EventBusOptions<
	EM extends EventMap = EventMap,
	GC extends PlainObject = PlainObject,
> {
	globalMiddlewares?: EventMiddleware<EM, any, any, GC>[];
	plugins?: EventBusPlugin<EM, GC>[];
	patternMatching?: PatternMatchingOptions;
	lifecycle?: EventBusLifecycleHooks<EM, GC>;
}

export interface EventBusLifecycleHooks<
	EM extends EventMap = EventMap,
	GC extends PlainObject = PlainObject,
> {
	onBeforeEmit?: <K extends StringKeyOf<EM>>(
		event: K,
		context: EventContext<EM[K], GC>,
		emitOptions?: EventEmitOptions,
	) => void | Promise<void>;
	onAfterEmit?: <K extends StringKeyOf<EM>, R = unknown>(
		event: K,
		context: EventContext<EM[K], GC>,
		results: EventEmitResult<R>[],
		emitOptions?: EventEmitOptions,
	) => void | Promise<void>;
	onBeforeHandler?: <K extends StringKeyOf<EM>, R = unknown>(
		event: K,
		context: EventContext<EM[K], GC>,
		handler: EventHandler<EM, K, R, GC>,
		handlerIndex: number,
		totalHandlers: number,
	) => void | Promise<void>;
	onAfterHandler?: <K extends StringKeyOf<EM>, R = unknown>(
		event: K,
		context: EventContext<EM[K], GC>,
		handler: EventHandler<EM, K, R, GC>,
		result: EventEmitResult<R>,
		handlerIndex: number,
		totalHandlers: number,
	) => void | Promise<void>;
	onBeforeMiddleware?: <K extends StringKeyOf<EM>, R = unknown>(
		event: K,
		context: EventContext<EM[K], GC>,
		middleware: EventMiddleware<EM, K, R, GC>,
		middlewareIndex: number,
		totalMiddlewares: number,
	) => void | Promise<void>;
	onAfterMiddleware?: <K extends StringKeyOf<EM>, R = unknown>(
		event: K,
		context: EventContext<EM[K], GC>,
		middleware: EventMiddleware<EM, K, R, GC>,
		result: R | undefined,
		error: EventError | undefined,
		middlewareIndex: number,
		totalMiddlewares: number,
	) => void | Promise<void>;
	onError?: <K extends StringKeyOf<EM>>(
		event: K,
		context: EventContext<EM[K], GC>,
		error: EventError,
		phase: LifecyclePhase,
	) => void | Promise<void>;
	onTimeout?: <K extends StringKeyOf<EM>>(
		event: K,
		context: EventContext<EM[K], GC>,
		timeout: number,
		phase: LifecyclePhase,
	) => void | Promise<void>;
	onNoHandlers?: <K extends StringKeyOf<EM>>(
		event: K,
		context: EventContext<EM[K], GC>,
	) => void | Promise<void>;
	onDestroy?: () => void | Promise<void>;
}

export interface IEventBus<
	EM extends EventMap = EventMap,
	GC extends PlainObject = PlainObject,
> {
	destroy(): void;
	emit<K extends StringKeyOf<EM>, R = unknown>(
		event: K,
		context: EventContext<EM[K], GC>,
		taskOptions?: EventTaskOptions,
		emitOptions?: EventEmitOptions,
	): Promise<EventEmitResult<R>[]>;
	on<K extends StringKeyOf<EM>, R = unknown>(
		event: K,
		handler: EventHandler<EM, K, R, GC>,
		options?: { once?: boolean; priority?: number },
	): () => void;
	off<K extends StringKeyOf<EM>, R = unknown>(
		event: K,
		handler?: EventHandler<EM, K, R, GC>,
	): void;
	match<K extends StringKeyOf<EM>, R = unknown>(
		pattern: string,
		handler: EventHandler<EM, K, R, GC>,
		options?: { once?: boolean; priority?: number },
	): () => void;
	unmatch<K extends StringKeyOf<EM>, R = unknown>(
		pattern: string,
		handler?: EventHandler<EM, K, R, GC>,
	): void;
	use<K extends StringKeyOf<EM>, R = unknown>(
		event: K,
		middleware: EventMiddleware<EM, K, R, GC>,
		options?: MiddlewareOptions,
	): () => void;
	useGlobalMiddleware<R = unknown>(
		middleware: EventMiddleware<EM, any, R, GC>,
		options?: MiddlewareOptions,
	): () => void;
	usePlugin(plugin: EventBusPlugin<EM, GC>): () => void;
}

export interface IEventBusFactory {
	create<EM extends EventMap = EventMap, GC extends PlainObject = PlainObject>(
		options?: EventBusOptions<EM, GC>,
	): IEventBus<EM, GC>;
}

export interface HandlerWrapper<
	EM extends EventMap,
	K extends StringKeyOf<EM>,
	R = unknown,
	GC extends PlainObject = PlainObject,
> {
	handler: EventHandler<EM, K, R, GC>;
	once: boolean;
	priority: number;
}
