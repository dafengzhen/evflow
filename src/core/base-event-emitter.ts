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
	InternalListener,
	ListenerEntry,
	OnceOptions,
	OnOptions,
} from './types.ts';

function createEmitContext<
	T extends BaseEventDefinitions,
	K extends EventName<T>,
>(
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

		isPropagationStopped(): boolean {
			return stopped;
		},

		stopPropagation(): void {
			stopped = true;
		},
	};
}

/**
 * BaseEventEmitter.
 *
 * @author dafengzhen
 */
export abstract class BaseEventEmitter<T extends BaseEventDefinitions>
	implements IEventEmitterWithMiddleware<T>
{
	private readonly listeners: Map<
		EventName<T>,
		Map<number, Set<ListenerEntry<T, any>>>
	> = new Map();

	private readonly middlewares: Set<EventMiddleware<T>> = new Set();

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

		for (const [, bucket] of group) {
			for (const entry of bucket) {
				if (entry.listener === listener) {
					bucket.delete(entry);
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
		const ctx: EmitContext<T, K> = createEmitContext(
			eventName,
			payload,
			context,
			options,
		);

		const middlewares = [...this.middlewares];

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

		const composed = middlewares.reduceRight<() => Promise<void>>(
			(next, mw) => {
				return () => mw(ctx, next);
			},
			dispatch,
		);

		await composed();
	}

	use(middleware: EventMiddleware<T>): () => void {
		this.middlewares.add(middleware);

		return () => {
			this.middlewares.delete(middleware);
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
	): void {}

	protected async dispatchEmit<K extends EventName<T>>(
		eventName: K,
		payload?: EventPayload<T, K>,
		context?: EventContext<T, K>,
		options?: EmitOptions<T, K>,
	): Promise<void> {
		const group = this.listeners.get(eventName);

		const exactByPriority = new Map<number, Set<ListenerEntry<T, any>>>();

		if (group) {
			for (const [priority, bucket] of group.entries()) {
				exactByPriority.set(priority, bucket);
			}
		}

		const extraListeners = this.getExtraListenersForEmit(eventName) ?? [];

		if (!group && extraListeners.length === 0) {
			return;
		}

		const priorities = new Set<number>();

		for (const p of exactByPriority.keys()) {
			priorities.add(p);
		}

		for (const extra of extraListeners) {
			priorities.add(extra.priority);
		}

		const sortedPriorities = [...priorities].sort((a, b) => b - a);
		const toRemoveExact: { bucket: Set<any>; entry: any }[] = [];
		const invokedExtra: InternalListener<T>[] = [];

		for (const p of sortedPriorities) {
			const exactBucket = exactByPriority.get(p);
			if (exactBucket) {
				for (const entry of exactBucket) {
					await new EventTask(entry.listener, payload, context, {
						...options,
						__eventName__: eventName,
					}).execute();

					if (entry.once) {
						toRemoveExact.push({ bucket: exactBucket, entry });
					}
				}
			}

			for (const extra of extraListeners) {
				if (extra.priority !== p) {
					continue;
				}

				await new EventTask(extra.listener, payload, context, {
					...options,
					__eventName__: eventName,
				}).execute();

				invokedExtra.push(extra);
			}
		}

		for (const { bucket, entry } of toRemoveExact) {
			bucket.delete(entry);
		}

		this.afterEmitExtra(eventName, invokedExtra);
	}
}
