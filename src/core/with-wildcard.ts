import type { AbstractEventEmitter } from './abstract-event-emitter.ts';
import type {
  BaseEventDefinitions,
  Ctor,
  EventListener,
  EventName,
  EventPayload,
  ExecOptions,
  ListenerEntry,
  MatchSupport,
  OnceOptions,
  OnOptions,
  PatternListenerEntry
} from './types.ts';

import { compileWildcard } from './matchable-event-emitter.ts';

/**
 * WithWildcard.
 *
 * @author dafengzhen
 */
export function WithWildcard<
  TEvents extends BaseEventDefinitions,
  TBase extends Ctor<AbstractEventEmitter<TEvents>>,
>(Base: TBase) {
  return class WildcardEmitter
    extends Base
    implements MatchSupport<TEvents> {
    protected patternListeners: PatternListenerEntry<TEvents>[] = [];
    private patternCache = new Map<string, RegExp>();

    match(
      pattern: string,
      listener: EventListener<TEvents, any>,
      options?: OnOptions
    ): () => void {
      this.patternListeners.push({
        listener,
        once: options?.once ?? false,
        pattern,
        priority: options?.priority ?? 0
      });

      if (this.patternListeners.length > 1) {
        this.patternListeners.sort(
          (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
        );
      }

      return () => this.unmatch(pattern, listener);
    }

    matchOnce(
      pattern: string,
      listener: EventListener<TEvents, any>,
      options?: OnceOptions
    ): () => void {
      return this.match(pattern, listener, { ...options, once: true });
    }

    unmatch(
      pattern: string,
      listener: EventListener<TEvents, any>
    ): void {
      if (!this.patternListeners.length) {
        return;
      }
      this.patternListeners = this.patternListeners.filter(
        (e) => e.pattern !== pattern || e.listener !== listener
      );
    }

    protected getMatchingPatternListeners(
      eventName: string
    ): PatternListenerEntry<TEvents>[] {
      if (!this.patternListeners.length) {
        return [];
      }

      return this.patternListeners.filter((entry) => {
        const re = compileWildcard(entry.pattern, {
          cache: this.patternCache,
          separator: '.'
        });
        return re.test(eventName);
      });
    }

    protected override onDestroy(): Promise<void> | void {
      this.patternListeners = [];
      if (super.onDestroy) {
        return super.onDestroy();
      }
    }

    protected override async runAllListeners<K extends EventName<TEvents>>(
      eventName: K,
      payload: EventPayload<TEvents, K> | undefined,
      options?: ExecOptions
    ): Promise<void> {
      const exact = this.listeners.get(eventName) ?? [];
      const patterns = this.getMatchingPatternListeners(eventName as string);

      const allEntries: (ListenerEntry<TEvents, any> | PatternListenerEntry<TEvents>)[] =
        [...exact, ...patterns];
      if (!allEntries.length) {
        return;
      }

      allEntries.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
      const snapshot = allEntries.slice();

      await this.executeListeners(
        snapshot.map((entry) =>
          this.wrapListener(entry as ListenerEntry<TEvents, any>, payload, options)
        ),
        options
      );

      this.cleanupOnceListeners(exact);
      this.cleanupOncePatternListeners(patterns);
    }

    private cleanupOncePatternListeners(
      executed: PatternListenerEntry<TEvents>[]
    ): void {
      if (!executed.length) {
        return;
      }
      const toRemove = new Set(executed.filter((e) => e.once));
      this.patternListeners = this.patternListeners.filter(
        (e) => !toRemove.has(e)
      );
    }
  };
}
