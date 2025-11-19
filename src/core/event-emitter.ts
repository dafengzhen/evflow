import type {
	BaseEventDefinitions,
	EmitOptions,
	EventContext,
	EventListener,
	EventName,
	EventPayload,
	IEventEmitter,
	ListenerEntry,
	OnceOptions,
	OnOptions,
} from './event.d.ts';

import { EventTask } from './event-task.ts';

export class EventEmitter<T extends BaseEventDefinitions>
	implements IEventEmitter<T>
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
		return this.on(eventName, listener, { once: true, ...options });
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
		if (!group) {
			return;
		}

		const priorities = [...group.keys()].sort((a, b) => b - a);

		const toRemove: { bucket: Set<any>; entry: any }[] = [];

		for (const p of priorities) {
			const bucket = group.get(p);

			if (!bucket) {
				continue;
			}

			for (const entry of bucket) {
				await new EventTask(payload, context, entry.listener, {
					...options,
					__eventName__: eventName,
				}).execute();

				if (entry.once) {
					toRemove.push({ bucket, entry });
				}
			}
		}

		for (const { bucket, entry } of toRemove) {
			bucket.delete(entry);
		}
	}
}
