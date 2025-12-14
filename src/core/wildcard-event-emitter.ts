import type {
  BaseEventDefinitions,
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

import { AbstractEventEmitter } from './abstract-event-emitter.ts';
import { compileWildcard } from './tools.ts';

/**
 * WildcardEventEmitter.
 *
 * @author dafengzhen
 */
export class WildcardEventEmitter<T extends BaseEventDefinitions> extends AbstractEventEmitter<T> implements MatchSupport<T> {
  protected patternCache = new Map<string, RegExp>();

  protected patternListeners: PatternListenerEntry<T>[] = [];

  public match(pattern: string, listener: EventListener<T, any>, options: OnOptions = {}): () => void {
    this.validatePattern(pattern);
    this.validatePatternListener('pattern', listener);

    const entry: PatternListenerEntry<T> = {
      listener,
      once: options.once ?? false,
      pattern,
      priority: options.priority ?? 0
    };

    this.patternListeners.push(entry);
    this.sortPatternListeners();

    return () => this.unmatch(pattern, listener);
  }

  public matchOnce(pattern: string, listener: EventListener<T, any>, options: OnceOptions = {}): () => void {
    return this.match(pattern, listener, { ...options, once: true });
  }

  public unmatch(pattern: string, listener: EventListener<T, any>): void {
    this.patternListeners = this.patternListeners.filter(
      entry => !(entry.pattern === pattern && entry.listener === listener)
    );
  }

  protected override async executeEmission<K extends EventName<T>>(
    eventName: K,
    payload: EventPayload<T, K> | undefined,
    options: ExecOptions
  ): Promise<void> {
    const exactListeners = this.listeners.get(eventName) ?? [];
    const patternListeners = this.getMatchingPatternListeners(eventName as string);
    const allListeners = [...exactListeners, ...patternListeners];
    if (allListeners.length === 0) {
      return;
    }

    this.sortAllListeners(allListeners);

    const executors = allListeners.map(entry =>
      this.createListenerExecutor(entry as ListenerEntry<T, any>, payload, options)
    );

    await this.executeListeners(executors, options);

    this.cleanupOnceListeners(exactListeners);
    this.cleanupOncePatternListeners(patternListeners);
  }

  protected getMatchingPatternListeners(eventName: string): PatternListenerEntry<T>[] {
    if (this.patternListeners.length === 0) {
      return [];
    }

    return this.patternListeners.filter(entry =>
      this.matchesPattern(entry.pattern, eventName)
    );
  }

  protected matchesPattern(pattern: string, eventName: string): boolean {
    const regex = compileWildcard(pattern, {
      cache: this.patternCache,
      flags: '',
      separator: '.'
    });
    return regex.test(eventName);
  }

  protected override async onClear(): Promise<void> {
    await super.onClear?.();
    this.patternListeners = [];
  }

  protected override async onDestroy(): Promise<void> {
    await super.onDestroy?.();
    this.patternListeners = [];
    this.patternCache.clear();
  }

  private cleanupOncePatternListeners(executed: PatternListenerEntry<T>[]): void {
    const toRemove = executed.filter(entry => entry.once);
    if (toRemove.length === 0) {
      return;
    }

    this.patternListeners = this.patternListeners.filter(
      entry => !toRemove.includes(entry)
    );
  }

  private sortAllListeners(listeners: (any | PatternListenerEntry<T>)[]): void {
    if (listeners.length > 1) {
      listeners.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    }
  }

  private sortPatternListeners(): void {
    if (this.patternListeners.length > 1) {
      this.patternListeners.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    }
  }

  private validatePattern(pattern: string): void {
    if (pattern.trim() === '') {
      throw new TypeError('Pattern must be a non-empty string.');
    }
  }

  private validatePatternListener(context: string, listener: EventListener<T, any>): void {
    if (typeof listener !== 'function') {
      throw new TypeError(`Listener for ${context} must be a function.`);
    }
  }
}