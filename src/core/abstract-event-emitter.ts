import type {
  BaseEventDefinitions,
  EmitOptions,
  EventEmitter,
  EventEmitterConfig,
  EventListener,
  EventName,
  EventPayload,
  ExecOptions,
  ListenerEntry,
  OnOptions
} from './types.ts';

import { Executor } from './executor.ts';

/**
 * AbstractEventEmitter.
 *
 * @author dafengzhen
 */
export abstract class AbstractEventEmitter<T extends BaseEventDefinitions> implements EventEmitter<T> {
  protected config: EventEmitterConfig;

  protected isInitialized = false;

  protected listeners: Map<EventName<T>, ListenerEntry<T, any>[]> = new Map();

  private initializationPromise: null | Promise<void> = null;

  private maxListenersWarning = false;

  constructor(config: Partial<EventEmitterConfig> = {}) {
    this.config = { ...this.getDefaultConfig(), ...config };
  }

  public async clear(): Promise<void> {
    this.listeners.clear();
    await this.onClear?.();
  }

  public configure(config: Partial<EventEmitterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  public async destroy(): Promise<void> {
    if (!this.isInitialized) {
      this.listeners.clear();
      return;
    }

    await this.onDestroy?.();
    this.listeners.clear();
    this.isInitialized = false;
  }

  public async emit<K extends EventName<T>>(
    eventName: K,
    payload?: EventPayload<T, K>,
    options?: EmitOptions
  ): Promise<void> {
    await this.ensureInitialized();
    await this.executeEmission(eventName, payload, (options ?? {}) as ExecOptions);
  }

  public getConfig(): Readonly<EventEmitterConfig> {
    return { ...this.config };
  }

  public listenerCount(eventName?: EventName<T>): number {
    if (eventName) {
      return this.listeners.get(eventName)?.length ?? 0;
    }

    let total = 0;
    for (const listeners of this.listeners.values()) {
      total += listeners.length;
    }
    return total;
  }

  public off<K extends EventName<T>>(eventName: K, listener: EventListener<T, K>): void {
    const listeners = this.listeners.get(eventName);
    if (!listeners) {
      return;
    }

    const filtered = listeners.filter(entry => entry.listener !== listener);

    if (filtered.length === 0) {
      this.listeners.delete(eventName);
    } else {
      this.listeners.set(eventName, filtered);
    }
  }

  public on<K extends EventName<T>>(
    eventName: K,
    listener: EventListener<T, K>,
    options: OnOptions = {}
  ): () => void {
    this.validateListener(eventName, listener);

    const entry: ListenerEntry<T, K> = {
      eventName,
      listener,
      once: options.once ?? false,
      priority: options.priority ?? 0
    };

    const listeners = this.getOrCreateListenerArray(eventName);

    if (this.config.maxListeners && listeners.length >= this.config.maxListeners) {
      if (!this.maxListenersWarning) {
        console.warn(`Maximum listeners (${this.config.maxListeners}) reached for event "${eventName}"`);
        this.maxListenersWarning = true;
      }
      return () => {
      };
    }

    listeners.push(entry);
    this.sortListenersByPriority(listeners);

    return () => this.removeListener(eventName, listener);
  }

  public once<K extends EventName<T>>(
    eventName: K,
    listener: EventListener<T, K>,
    options: Omit<OnOptions, 'once'> = {}
  ): () => void {
    return this.on(eventName, listener, { ...options, once: true });
  }

  protected cleanupOnceListeners(executed: ListenerEntry<T, any>[]): void {
    const toRemove = executed.filter(entry => entry.once);
    if (toRemove.length === 0) {
      return;
    }

    for (const entry of toRemove) {
      this.off(entry.eventName, entry.listener);
    }
  }

  protected createListenerExecutor(
    entry: ListenerEntry<T, any>,
    payload: EventPayload<T, any> | undefined,
    options: ExecOptions
  ): () => Promise<void> {
    return () => new Executor(
      () => entry.listener(payload),
      options
    ).execute();
  }

  protected async ensureInitialized(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (!this.initializationPromise) {
      this.initializationPromise = (async () => {
        await this.onInitialize?.();
        this.isInitialized = true;
      })();
    }

    await this.initializationPromise;
  }

  protected async executeEmission<K extends EventName<T>>(
    eventName: K,
    payload: EventPayload<T, K> | undefined,
    options: ExecOptions
  ): Promise<void> {
    const entries = this.listeners.get(eventName);
    if (!entries || entries.length === 0) {
      return;
    }

    const snapshot = entries.slice();
    const executors = snapshot.map(entry =>
      this.createListenerExecutor(entry, payload, options)
    );

    await this.executeListeners(executors, options);
    this.cleanupOnceListeners(snapshot);
  }

  protected async executeListeners(
    executors: (() => Promise<void>)[],
    _options: ExecOptions
  ): Promise<void> {
    for (const executor of executors) {
      await executor();
    }
  }

  protected getDefaultConfig(): EventEmitterConfig {
    return {
      maxListeners: 10
    };
  }

  protected async onClear?(): Promise<void>;

  protected async onDestroy?(): Promise<void>;

  protected async onInitialize?(): Promise<void>;

  private getOrCreateListenerArray<K extends EventName<T>>(eventName: K): ListenerEntry<T, K>[] {
    let listeners = this.listeners.get(eventName);
    if (!listeners) {
      listeners = [];
      this.listeners.set(eventName, listeners);
    }
    return listeners;
  }

  private removeListener<K extends EventName<T>>(eventName: K, listener: EventListener<T, K>): void {
    this.off(eventName, listener);
  }

  private sortListenersByPriority(listeners: ListenerEntry<T, any>[]): void {
    if (listeners.length > 1) {
      listeners.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    }
  }

  private validateListener<K extends EventName<T>>(eventName: K, listener: EventListener<T, K>): void {
    if (typeof listener !== 'function') {
      throw new TypeError(`Listener for event "${eventName}" must be a function.`);
    }
  }
}
