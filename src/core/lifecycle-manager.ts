import type { LifecyclePhase } from '../enums.ts';
import type {
	EventBusLifecycleHooks,
	EventContext,
	EventEmitOptions,
	EventEmitResult,
	EventError,
	EventHandler,
	EventMap,
	EventMiddleware,
	PlainObject,
	StringKeyOf,
} from '../types/types.ts';

/**
 * LifecycleManager.
 *
 * @author dafengzhen
 */
export class LifecycleManager<
	EM extends EventMap = EventMap,
	GC extends PlainObject = PlainObject,
> {
	private readonly hooks: Required<EventBusLifecycleHooks<EM, GC>>;

	constructor(lifecycle?: EventBusLifecycleHooks<EM, GC>) {
		this.hooks = this.initializeHooks(lifecycle);
	}

	private initializeHooks(
		lifecycle?: EventBusLifecycleHooks<EM, GC>,
	): Required<EventBusLifecycleHooks<EM, GC>> {
		const noop = () => {};

		return {
			onBeforeEmit: lifecycle?.onBeforeEmit || noop,
			onAfterEmit: lifecycle?.onAfterEmit || noop,
			onBeforeHandler: lifecycle?.onBeforeHandler || noop,
			onAfterHandler: lifecycle?.onAfterHandler || noop,
			onBeforeMiddleware: lifecycle?.onBeforeMiddleware || noop,
			onAfterMiddleware: lifecycle?.onAfterMiddleware || noop,
			onError: lifecycle?.onError || noop,
			onTimeout: lifecycle?.onTimeout || noop,
			onNoHandlers: lifecycle?.onNoHandlers || noop,
			onDestroy: lifecycle?.onDestroy || noop,
		};
	}

	private async executeHook(
		hookName: keyof EventBusLifecycleHooks<EM, GC>,
		...args: any[]
	): Promise<void> {
		const hook: any = this.hooks[hookName];

		if (typeof hook !== 'function') {
			return;
		}

		try {
			const result = hook(...args);
			if (result instanceof Promise) {
				await result;
			}
		} catch (error) {
			console.error(
				`Lifecycle hook "${String(hookName)}" execution failed:`,
				error,
			);
		}
	}

	async beforeEmit<K extends StringKeyOf<EM>>(
		event: K,
		context: EventContext<EM[K], GC>,
		emitOptions?: EventEmitOptions,
	): Promise<void> {
		await this.executeHook('onBeforeEmit', event, context, emitOptions);
	}

	async afterEmit<K extends StringKeyOf<EM>, R = unknown>(
		event: K,
		context: EventContext<EM[K], GC>,
		results: EventEmitResult<R>[],
		emitOptions?: EventEmitOptions,
	): Promise<void> {
		await this.executeHook('onAfterEmit', event, context, results, emitOptions);
	}

	async beforeHandler<K extends StringKeyOf<EM>, R = unknown>(
		event: K,
		context: EventContext<EM[K], GC>,
		handler: EventHandler<EM, K, R, GC>,
		handlerIndex: number,
		totalHandlers: number,
	): Promise<void> {
		await this.executeHook(
			'onBeforeHandler',
			event,
			context,
			handler,
			handlerIndex,
			totalHandlers,
		);
	}

	async afterHandler<K extends StringKeyOf<EM>, R = unknown>(
		event: K,
		context: EventContext<EM[K], GC>,
		handler: EventHandler<EM, K, R, GC>,
		result: EventEmitResult<R>,
		handlerIndex: number,
		totalHandlers: number,
	): Promise<void> {
		await this.executeHook(
			'onAfterHandler',
			event,
			context,
			handler,
			result,
			handlerIndex,
			totalHandlers,
		);
	}

	async beforeMiddleware<K extends StringKeyOf<EM>, R = unknown>(
		event: K,
		context: EventContext<EM[K], GC>,
		middleware: EventMiddleware<EM, K, R, GC>,
		middlewareIndex: number,
		totalMiddlewares: number,
	): Promise<void> {
		await this.executeHook(
			'onBeforeMiddleware',
			event,
			context,
			middleware,
			middlewareIndex,
			totalMiddlewares,
		);
	}

	async afterMiddleware<K extends StringKeyOf<EM>, R = unknown>(
		event: K,
		context: EventContext<EM[K], GC>,
		middleware: EventMiddleware<EM, K, R, GC>,
		result: R | undefined,
		error: EventError | undefined,
		middlewareIndex: number,
		totalMiddlewares: number,
	): Promise<void> {
		await this.executeHook(
			'onAfterMiddleware',
			event,
			context,
			middleware,
			result,
			error,
			middlewareIndex,
			totalMiddlewares,
		);
	}

	async onError<K extends StringKeyOf<EM>>(
		event: K,
		context: EventContext<EM[K], GC>,
		error: EventError,
		phase: LifecyclePhase,
	): Promise<void> {
		await this.executeHook('onError', event, context, error, phase);
	}

	async onTimeout<K extends StringKeyOf<EM>>(
		event: K,
		context: EventContext<EM[K], GC>,
		timeout: number,
		phase: LifecyclePhase,
	): Promise<void> {
		await this.executeHook('onTimeout', event, context, timeout, phase);
	}

	async noHandlers<K extends StringKeyOf<EM>>(
		event: K,
		context: EventContext<EM[K], GC>,
	): Promise<void> {
		await this.executeHook('onNoHandlers', event, context);
	}

	async destroy(): Promise<void> {
		await this.executeHook('onDestroy');
	}
}
