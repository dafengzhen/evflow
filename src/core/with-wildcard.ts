import type { AbstractEventEmitter } from './abstract-event-emitter.ts';
import type {
  AbstractConstructor,
  BaseEventDefinitions,
  EventListener,
  EventName,
  EventPayload,
  ExecOptions,
  ListenerEntry,
  MatchSupport,
  OnceOptions,
  OnOptions,
  PatternListenerEntry,
} from './types.ts';

import { compileWildcard } from './tools.ts';

/**
 * WithWildcard.
 *
 * @author dafengzhen
 */
export function WithWildcard<T extends BaseEventDefinitions>() {
  return <C extends AbstractConstructor<AbstractEventEmitter<T>>>(BaseClass: C) => {
    abstract class WildcardMixin extends BaseClass implements MatchSupport<T> {
      protected patternListeners: PatternListenerEntry<T>[] = [];

      private patternCache = new Map<string, RegExp>();

      match(pattern: string, listener: EventListener<T, any>, options?: OnOptions): () => void {
        this.patternListeners.push({
          listener,
          once: options?.once ?? false,
          pattern,
          priority: options?.priority ?? 0,
        });

        if (this.patternListeners.length > 1) {
          this.patternListeners.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
        }

        return () => this.unmatch(pattern, listener);
      }

      matchOnce(pattern: string, listener: EventListener<T, any>, options?: OnceOptions): () => void {
        return this.match(pattern, listener, { ...options, once: true });
      }

      unmatch(pattern: string, listener: EventListener<T, any>): void {
        if (!this.patternListeners.length) {
          return;
        }

        this.patternListeners = this.patternListeners.filter((e) => e.pattern !== pattern || e.listener !== listener);
      }

      protected getMatchingPatternListeners(eventName: string): PatternListenerEntry<T>[] {
        if (!this.patternListeners.length) {
          return [];
        }

        return this.patternListeners.filter((entry) => this.matchesPattern(entry.pattern, eventName));
      }

      protected override onDestroy(): Promise<void> | void {
        this.patternListeners = [];
      }

      protected override async runAllListeners<K extends EventName<T>>(
        eventName: K,
        payload?: EventPayload<T, K>,
        options?: ExecOptions,
      ): Promise<void> {
        const exact = this.listeners.get(eventName) ?? [];
        const patterns = this.getMatchingPatternListeners(eventName as string);

        const allEntries: (ListenerEntry<T, any> | PatternListenerEntry<T>)[] = [...exact, ...patterns];

        if (!allEntries.length) {
          return;
        }

        allEntries.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

        const snapshot = allEntries.slice();

        await this.executeListeners(
          snapshot.map((entry) => this.wrapListener(entry as ListenerEntry<T, any>, payload, options)),
          options,
        );

        this.cleanupOnceListeners(exact);

        this.cleanupOncePatternListeners(patterns);
      }

      private cleanupOncePatternListeners(executed: PatternListenerEntry<T>[]): void {
        if (!executed.length || !this.patternListeners.length) {
          return;
        }

        const toRemove = new Set(executed.filter((e) => e.once));
        if (!toRemove.size) {
          return;
        }

        this.patternListeners = this.patternListeners.filter((e) => !toRemove.has(e));
      }

      private matchesPattern(pattern: string, eventName: string): boolean {
        const re = compileWildcard(pattern, {
          cache: this.patternCache,
          separator: '.',
        });
        return re.test(eventName);
      }
    }
    return WildcardMixin;
  };
}
