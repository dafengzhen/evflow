import type {
	BaseEventDefinitions,
	EventName,
	IEventPatternMatcher,
	InternalEntry,
	MatchedListener,
	OnceOptions,
	OnOptions,
	WildcardEventListener,
} from './types.ts';

/**
 * Escape regex characters.
 */
function escapeRegexChar(char: string): string {
	return char.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

/**
 * Compile a wildcard pattern containing # * + ? into a RegExp.
 *
 * Semantic conventions (you can adjust as needed):
 *  - # -> .*      (cross-level wildcard)
 *  - * -> [^.]*   (single-level 0+ characters)
 *  - + -> [^.]+   (single-level 1+ characters)
 *  - ? -> [^.]    (single-level 1 character)
 */
function compileWildcard(pattern: string): RegExp {
	let regexStr = '^';

	for (let i = 0; i < pattern.length; i++) {
		const ch = pattern[i];
		switch (ch) {
			case '#':
				regexStr += '.*';
				break;
			case '*':
				regexStr += '[^.]*';
				break;
			case '+':
				regexStr += '[^.]+';
				break;
			case '?':
				regexStr += '[^.]';
				break;
			default:
				regexStr += escapeRegexChar(ch);
				break;
		}
	}

	regexStr += '$';
	return new RegExp(regexStr);
}

/**
 * Default wildcard pattern matcher implementation.
 *
 * @author dafengzhen
 */
export class WildcardPatternMatcher<T extends BaseEventDefinitions>
	implements IEventPatternMatcher<T>
{
	private readonly entries: Set<InternalEntry<T>> = new Set();

	add(
		pattern: string,
		listener: WildcardEventListener<T>,
		options: OnOptions = {},
	): () => void {
		const entry: InternalEntry<T> = {
			listener,
			once: !!options.once,
			pattern,
			priority: options.priority ?? 0,
			regex: compileWildcard(pattern),
		};

		this.entries.add(entry);

		return () => this.remove(pattern, listener);
	}

	addOnce(
		pattern: string,
		listener: WildcardEventListener<T>,
		options: OnceOptions = {},
	): () => void {
		return this.add(pattern, listener, { ...options, once: true });
	}

	remove(pattern: string, listener: WildcardEventListener<T>): void {
		for (const entry of this.entries) {
			if (entry.pattern === pattern && entry.listener === listener) {
				this.entries.delete(entry);
				return;
			}
		}
	}

	match<K extends EventName<T>>(eventName: K): MatchedListener<T>[] {
		const name = String(eventName);
		const matched: MatchedListener<T>[] = [];

		for (const entry of this.entries) {
			if (entry.regex.test(name)) {
				matched.push({
					listener: entry.listener,
					once: entry.once,
					pattern: entry.pattern,
					priority: entry.priority,
				});
			}
		}

		matched.sort((a, b) => b.priority - a.priority);

		return matched;
	}
}
