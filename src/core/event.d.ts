export type PlainObject = Record<string, unknown>;

export type PositiveNumber = number & { __brand?: 'positive' };

export interface BaseEventDefinitions {
	[eventName: string]: {
		payload: PlainObject;
		context?: PlainObject & BaseContext;
	};
}

export type EventName<T extends BaseEventDefinitions> = Extract<
	keyof T,
	string
>;

export interface BaseContext {
	signal?: AbortSignal;
	[key: string]: unknown;
}

export type EventPayload<
	T extends BaseEventDefinitions,
	K extends EventName<T>,
> = T[K]['payload'];

export type EventContext<
	T extends BaseEventDefinitions,
	K extends EventName<T>,
> =
	| (T[K] extends { context: infer C } ? C & BaseContext : BaseContext)
	| undefined;

export type EventListener<
	T extends BaseEventDefinitions,
	K extends EventName<T>,
> = (
	payload: EventPayload<T, K>,
	context?: EventContext<T, K>,
	options?: EmitOptions<T, K>,
) => Promise<void>;

export type AnyEventPayload<T extends BaseEventDefinitions> =
	T[EventName<T>]['payload'];

export type AnyEventContext<T extends BaseEventDefinitions> =
	| (T[EventName<T>] extends { context: infer C }
			? C & BaseContext
			: BaseContext)
	| undefined;

export type WildcardEventListener<T extends BaseEventDefinitions> = (
	payload: AnyEventPayload<T>,
	context?: AnyEventContext<T>,
	options?: EmitOptions<T>,
) => Promise<void>;

export type EventState =
	| 'pending'
	| 'running'
	| 'retrying'
	| 'succeeded'
	| 'failed'
	| 'cancelled'
	| 'timeout';

export interface EmitOptions<
	T extends BaseEventDefinitions = BaseEventDefinitions,
	K extends EventName<T> = EventName<T>,
> {
	timeout?: PositiveNumber;
	signal?: AbortSignal;
	maxRetries?: PositiveNumber;
	retryDelay?: PositiveNumber | ((attempt: number) => PositiveNumber);
	isRetryable?: (error: unknown) => boolean;
	onRetry?: (attempt: number, error: unknown) => void;
	onStateChange?: (state: EventState) => void;
	onTimeout?: (timeout: number) => void;
	onCancel?: () => void;
	throwOnError?: boolean;
	__eventName__?: K;
}

export interface EventTaskOptions<
	T extends BaseEventDefinitions,
	K extends EventName<T>,
> {
	timeout: number;
	maxRetries: number;
	signal?: AbortSignal;
	retryDelay: number | ((attempt: number) => number);
	isRetryable: (error: unknown) => boolean;
	onRetry: (attempt: number, error: unknown) => void;
	onStateChange: (state: EventState) => void;
	onTimeout: (timeout: number) => void;
	onCancel: () => void;
	throwOnError: boolean;
	__eventName__?: K;
}

export interface OnOptions {
	priority?: number;
	once?: boolean;
}

export interface OnceOptions extends Omit<OnOptions, 'once'> {}

export interface IEventEmitterCore<T extends BaseEventDefinitions> {
	emit<K extends EventName<T>>(
		eventName: K,
		payload: EventPayload<T, K>,
		context?: EventContext<T, K>,
		options?: EmitOptions<T, K>,
	): Promise<void>;

	on<K extends EventName<T>>(
		eventName: K,
		listener: EventListener<T, K>,
		options?: OnOptions,
	): () => void;

	once<K extends EventName<T>>(
		eventName: K,
		listener: EventListener<T, K>,
		options?: OnceOptions,
	): () => void;

	off<K extends EventName<T>>(
		eventName: K,
		listener: EventListener<T, K>,
	): void;
}

export interface IWildcardEventEmitter<T extends BaseEventDefinitions>
	extends IEventEmitterCore<T> {
	onPattern(
		pattern: string,
		listener: WildcardEventListener<T>,
		options?: OnOptions,
	): () => void;

	oncePattern(
		pattern: string,
		listener: WildcardEventListener<T>,
		options?: OnceOptions,
	): () => void;

	offPattern(pattern: string, listener: WildcardEventListener<T>): void;
}

export interface InternalListener<T extends BaseEventDefinitions> {
	listener: EventListener<T, any>;
	once: boolean;
	priority: number;
	meta?: Record<string, unknown>;
}

export interface ListenerEntry<
	T extends BaseEventDefinitions,
	K extends EventName<T>,
> {
	listener: EventListener<T, K>;
	once: boolean;
}

export interface IEventTask<
	T extends BaseEventDefinitions,
	_K extends EventName<T>,
> {
	execute(): Promise<void>;
}

export interface MatchedListener<T extends BaseEventDefinitions> {
	pattern: string;
	listener: WildcardEventListener<T>;
	once: boolean;
	priority: number;
}

export interface IEventPatternMatcher<T extends BaseEventDefinitions> {
	add(
		pattern: string,
		listener: WildcardEventListener<T>,
		options?: OnOptions,
	): () => void;

	addOnce(
		pattern: string,
		listener: WildcardEventListener<T>,
		options?: OnceOptions,
	): () => void;

	remove(pattern: string, listener: WildcardEventListener<T>): void;

	match<K extends EventName<T>>(eventName: K): MatchedListener<T>[];
}

export interface InternalEntry<T extends BaseEventDefinitions> {
	pattern: string;
	regex: RegExp;
	listener: WildcardEventListener<T>;
	once: boolean;
	priority: number;
}

export interface EmitContext<
	T extends BaseEventDefinitions,
	K extends EventName<T> = EventName<T>,
> {
	eventName: K;
	payload: EventPayload<T, K>;
	context?: EventContext<T, K>;
	options?: EmitOptions<T, K>;
	isPropagationStopped(): boolean;
	stopPropagation(): void;
}

export type EventMiddleware<T extends BaseEventDefinitions> = <
	K extends EventName<T>,
>(
	ctx: EmitContext<T, K>,
	next: () => Promise<void>,
) => Promise<void>;

export interface IEventEmitterWithMiddleware<T extends BaseEventDefinitions>
	extends IEventEmitterCore<T> {
	use(middleware: EventMiddleware<T>): () => void;
}
