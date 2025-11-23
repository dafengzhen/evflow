import { EventTask } from './event-task.ts';
import type {
	BaseEventDefinitions,
	EmitContext,
	EmitOptions,
	EventContext,
	EventListener,
	EventMiddleware,
	EventName,
	EventPayload,
	IEventEmitterWithMiddleware,
	IEventTask,
	InternalListener,
	ListenerEntry,
	OnceOptions,
	OnOptions,
} from './types.ts';

/**
 * BaseEventEmitter.
 *
 * @author dafengzhen
 */
export abstract class BaseEventEmitter<T extends BaseEventDefinitions>
	implements IEventEmitterWithMiddleware<T>
{
	private readonly listeners = new Map<
		EventName<T>,
		Map<number, Set<ListenerEntry<T, any>>>
	>();

	private readonly middlewares = new Set<EventMiddleware<T>>();

	private middlewareChain?(
		ctx: EmitContext<T>,
		dispatch: () => Promise<void>,
	): Promise<void>;

	on<K extends EventName<T>>(
		eventName: K,
		listener: EventListener<T, K>,
		options: OnOptions = {},
	): () => void {
		let group = this.listeners.get(eventName);
		if (!group) {
			group = new Map();
			this.listeners.set(eventName, group);
		}

		const priority = options.priority ?? 0;

		let bucket = group.get(priority);
		if (!bucket) {
			bucket = new Set();
			group.set(priority, bucket);
		}

		const entry: ListenerEntry<T, K> = {
			listener,
			once: !!options.once,
		};

		bucket.add(entry);
		this.onListenerAdded(eventName, entry, priority);

		return () => this.off(eventName, listener);
	}

	once<K extends EventName<T>>(
		eventName: K,
		listener: EventListener<T, K>,
		options: OnceOptions = {},
	): () => void {
		return this.on(eventName, listener, { ...options, once: true });
	}

	off<K extends EventName<T>>(
		eventName: K,
		listener: EventListener<T, K>,
	): void {
		const group = this.listeners.get(eventName);
		if (!group) {
			return;
		}

		for (const [priority, bucket] of group) {
			for (const entry of bucket) {
				if (entry.listener === listener) {
					bucket.delete(entry);
					this.onListenerRemoved(eventName, entry, priority);
					return;
				}
			}
		}
	}

	async emit<K extends EventName<T>>(
		eventName: K,
		payload?: EventPayload<T, K>,
		context?: EventContext<T, K>,
		options?: EmitOptions<T, K>,
	): Promise<void> {
		const ctx = this.createEmitContext(eventName, payload, context, options);

		const dispatch = async () => {
			if (ctx.isPropagationStopped()) {
				return;
			}

			await this.dispatchEmit(
				ctx.eventName,
				ctx.payload,
				ctx.context,
				ctx.options,
			);
		};

		await this.beforeEmit(ctx);

		let error: unknown;
		try {
			if (this.middlewareChain) {
				await this.middlewareChain(ctx, dispatch);
			} else {
				await dispatch();
			}
		} catch (err) {
			error = err;
			throw err;
		} finally {
			await this.afterEmit(ctx, error);
		}
	}

	use(middleware: EventMiddleware<T>): () => void {
		this.middlewares.add(middleware);
		this.rebuildMiddlewareChain();

		return () => {
			this.middlewares.delete(middleware);
			this.rebuildMiddlewareChain();
		};
	}

	private rebuildMiddlewareChain(): void {
		const mws = [...this.middlewares];

		if (mws.length === 0) {
			this.middlewareChain = undefined;
			return;
		}

		this.middlewareChain = async (
			ctx: EmitContext<T>,
			dispatch: () => Promise<void>,
		): Promise<void> => {
			let index = mws.length - 1;

			const invoke = async (): Promise<void> => {
				if (index < 0) {
					return dispatch();
				}

				const mw = mws[index--];
				await mw(ctx, invoke);
			};

			await invoke();
		};
	}

	protected getExtraListenersForEmit(
		_eventName: EventName<T>,
	): InternalListener<T>[] {
		return [];
	}

	protected afterEmitExtra(
		_eventName: EventName<T>,
		_extraListeners: InternalListener<T>[],
	): void {
		// no-op
	}

	protected async dispatchEmit<K extends EventName<T>>(
		eventName: K,
		payload?: EventPayload<T, K>,
		context?: EventContext<T, K>,
		options?: EmitOptions<T, K>,
	): Promise<void> {
		const group = this.listeners.get(eventName);
		const extraListeners = this.getExtraListenersForEmit(eventName) ?? [];

		if (!group && extraListeners.length === 0) {
			return;
		}

		const priorities = new Set<number>();
		if (group) {
			for (const p of group.keys()) {
				priorities.add(p);
			}
		}

		for (const extra of extraListeners) {
			priorities.add(extra.priority);
		}

		if (priorities.size === 0) {
			return;
		}

		const sortedPriorities = [...priorities].sort((a, b) => b - a);

		const baseTaskOptions: EmitOptions<T, K> = {
			...options,
			__eventName__: eventName,
		};

		const toRemoveExact: Array<{
			bucket: Set<ListenerEntry<T, any>>;
			entry: ListenerEntry<T, any>;
		}> = [];
		const invokedExtra: InternalListener<T>[] = [];

		for (const priority of sortedPriorities) {
			const bucket = group?.get(priority);
			if (bucket && bucket.size > 0) {
				for (const entry of bucket) {
					const task = this.createEventTask(
						entry.listener,
						payload,
						context,
						baseTaskOptions,
					);

					try {
						await task.execute();
					} catch (err) {
						await this.onListenerError(eventName, err, entry.listener);

						if (baseTaskOptions.throwOnError) {
							throw err;
						}
					}

					if (entry.once) {
						toRemoveExact.push({ bucket, entry });
					}
				}
			}

			for (const extra of extraListeners) {
				if (extra.priority !== priority) {
					continue;
				}

				const task = this.createEventTask(
					extra.listener,
					payload,
					context,
					baseTaskOptions,
				);

				try {
					await task.execute();
				} catch (err) {
					await this.onListenerError(eventName, err, extra.listener);

					if (baseTaskOptions.throwOnError) {
						throw err;
					}
				}

				invokedExtra.push(extra);
			}
		}

		for (const { bucket, entry } of toRemoveExact) {
			bucket.delete(entry);
		}

		this.afterEmitExtra(eventName, invokedExtra);
	}

	protected async beforeEmit<K extends EventName<T>>(
		_ctx: EmitContext<T, K>,
	): Promise<void> {
		// no-op
	}

	protected async afterEmit<K extends EventName<T>>(
		_ctx: EmitContext<T, K>,
		_error?: unknown,
	): Promise<void> {
		// no-op
	}

	protected onListenerAdded<K extends EventName<T>>(
		_eventName: K,
		_entry: ListenerEntry<T, K>,
		_priority: number,
	): void {
		// no-op
	}

	protected onListenerRemoved<K extends EventName<T>>(
		_eventName: K,
		_entry: ListenerEntry<T, K>,
		_priority: number,
	): void {
		// no-op
	}

	protected async onListenerError<K extends EventName<T>>(
		_eventName: K,
		_error: unknown,
		_listener: EventListener<T, K>,
	): Promise<void> {
		// no-op
	}

	protected createEmitContext<K extends EventName<T>>(
		eventName: K,
		payload?: EventPayload<T, K>,
		context?: EventContext<T, K>,
		options?: EmitOptions<T, K>,
	): EmitContext<T, K> {
		let stopped = false;

		return {
			eventName,
			payload,
			context,
			options: {
				...options,
				__eventName__: eventName,
			},
			isPropagationStopped() {
				return stopped;
			},
			stopPropagation() {
				stopped = true;
			},
		};
	}

	protected createEventTask<K extends EventName<T>>(
		listener: EventListener<T, K>,
		payload: EventPayload<T, K> | undefined,
		context: EventContext<T, K> | undefined,
		options: EmitOptions<T, K> | undefined,
	): IEventTask<T, K> {
		return new EventTask(listener, payload, context, {
			...options,
			__eventName__: options?.__eventName__,
		});
	}
}
