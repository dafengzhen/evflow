import { BaseEventEmitter } from './base-event-emitter.ts';
import type {
	BaseEventDefinitions,
	EventName,
	IEventPatternMatcher,
	InternalListener,
	IWildcardEventEmitter,
	MatchedListener,
	OnceOptions,
	OnOptions,
	WildcardEventListener,
} from './event.d.ts';
import { WildcardPatternMatcher } from './wildcard-pattern-matcher.ts';

/**
 * WildcardEventEmitter.
 *
 * @author dafengzhen
 */
export class WildcardEventEmitter<T extends BaseEventDefinitions>
	extends BaseEventEmitter<T>
	implements IWildcardEventEmitter<T>
{
	private readonly matcher: IEventPatternMatcher<T>;

	constructor(matcher?: IEventPatternMatcher<T>) {
		super();
		this.matcher = matcher ?? new WildcardPatternMatcher<T>();
	}

	onPattern(
		pattern: string,
		listener: WildcardEventListener<T>,
		options?: OnOptions,
	): () => void {
		return this.matcher.add(pattern, listener, options);
	}

	oncePattern(
		pattern: string,
		listener: WildcardEventListener<T>,
		options?: OnceOptions,
	): () => void {
		return this.matcher.addOnce(pattern, listener, options);
	}

	offPattern(pattern: string, listener: WildcardEventListener<T>): void {
		this.matcher.remove(pattern, listener);
	}

	protected getExtraListenersForEmit(
		eventName: EventName<T>,
	): InternalListener<T>[] {
		const matched: MatchedListener<T>[] = this.matcher.match(eventName);

		return matched.map<InternalListener<T>>((m) => ({
			listener: m.listener,
			once: m.once,
			priority: m.priority,
			meta: { pattern: m.pattern, type: 'pattern' },
		}));
	}

	protected afterEmitExtra(
		_eventName: EventName<T>,
		extraListeners: InternalListener<T>[],
	): void {
		for (const extra of extraListeners) {
			if (!extra.once) {
				continue;
			}

			const pattern = extra.meta?.pattern as string | undefined;

			if (!pattern) {
				continue;
			}

			this.matcher.remove(pattern, extra.listener);
		}
	}
}
