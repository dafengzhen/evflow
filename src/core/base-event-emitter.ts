import type {
	BaseEventDefinitions,
	EmitOptions,
	EventContext,
	EventListener,
	EventName,
	EventPayload,
	IEventEmitterCore,
	InternalListener,
	ListenerEntry,
	OnceOptions,
	OnOptions,
} from './event.d.ts';

import { EventTask } from './event-task.ts';

/**
 * BaseEventEmitter.
 *
 * @author dafengzhen
 */
export abstract class BaseEventEmitter<T extends BaseEventDefinitions>
	implements IEventEmitterCore<T>
{
	private readonly listeners: Map<
		EventName<T>,
		Map<number, Set<ListenerEntry<T, any>>>
	> = new Map();

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
		payload: EventPayload<T, K>,
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
					await new EventTask(payload, context, entry.listener, {
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

				await new EventTask(payload, context, extra.listener, {
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

	protected getExtraListenersForEmit(
		_eventName: EventName<T>,
	): InternalListener<T>[] {
		return [];
	}

	protected afterEmitExtra(
		_eventName: EventName<T>,
		_extraListeners: InternalListener<T>[],
	): void {}
}
