import type {
  BaseEventDefinitions,
  ConfigurableEventEmitter,
  EmitOptions,
  EventEmitterConfig,
  EventListener,
  EventName,
  EventPayload,
  ExecOptions,
  ListenerEntry,
  OnceOptions,
  OnOptions,
} from './types.ts';

import { Executor } from './executor.ts';

/**
 * AbstractEventEmitter.
 *
 * @author dafengzhen
 */
export abstract class AbstractEventEmitter<T extends BaseEventDefinitions> implements ConfigurableEventEmitter<T> {
  protected config: EventEmitterConfig;

  protected initialized = false;

  protected readonly listeners: Map<EventName<T>, ListenerEntry<T, any>[]> = new Map();

  private initializePromise: null | Promise<void> = null;

  constructor(config?: Partial<EventEmitterConfig>) {
    this.config = this.getDefaultConfig();
    if (config) {
      this.configure(config);
    }
  }

  configure(config: Partial<EventEmitterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  async emit<K extends EventName<T>>(eventName: K, payload?: EventPayload<T, K>, options?: EmitOptions): Promise<void> {
    await this.initialize();

    const execOptions = options as ExecOptions | undefined;

    await this.runAllListeners(eventName, payload, execOptions);
  }

  getConfig(): Readonly<EventEmitterConfig> {
    return { ...this.config };
  }

  off<K extends EventName<T>>(eventName: K, listener: EventListener<T, K>): void {
    const arr = this.listeners.get(eventName);
    if (!arr || arr.length === 0) {
      return;
    }

    const filtered = arr.filter((e) => e.listener !== listener);
    if (filtered.length === 0) {
      this.listeners.delete(eventName);
    } else {
      this.listeners.set(eventName, filtered);
    }
  }

  on<K extends EventName<T>>(eventName: K, listener: EventListener<T, K>, options?: OnOptions): () => void {
    const arr = this.listeners.get(eventName) ?? this.ensureListenerArray(eventName);

    arr.push({
      eventName,
      listener,
      once: options?.once ?? false,
      priority: options?.priority ?? 0,
    });

    if (arr.length > 1) {
      arr.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    }

    return () => this.off(eventName, listener);
  }

  once<K extends EventName<T>>(eventName: K, listener: EventListener<T, K>, options?: OnceOptions): () => void {
    return this.on(eventName, listener, { ...options, once: true });
  }

  protected cleanupOnceListeners(executed: ListenerEntry<T, any>[]): void {
    if (!executed.length) {
      return;
    }

    const toRemove = new Set(executed.filter((e) => e.once));

    if (!toRemove.size) {
      return;
    }

    for (const [key, arr] of this.listeners) {
      const remaining = arr.filter((e) => !toRemove.has(e));
      if (remaining.length === 0) {
        this.listeners.delete(key);
      } else {
        this.listeners.set(key, remaining);
      }
    }
  }

  protected async destroy(): Promise<void> {
    if (!this.initialized) {
      this.listeners.clear();
      return;
    }

    await this.onDestroy?.();
    this.listeners.clear();
    this.initialized = false;
  }

  protected async executeListeners(entries: (() => Promise<void>)[], _options?: ExecOptions): Promise<void> {
    for (const exec of entries) {
      await exec();
    }
  }

  protected getDefaultConfig(): EventEmitterConfig {
    return {};
  }

  protected async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!this.initializePromise) {
      this.initializePromise = (async () => {
        await this.onInitialize?.();
        await this.performInitialization?.();
        this.initialized = true;
      })().finally(() => {
        this.initializePromise = null;
      });
    }

    return this.initializePromise;
  }

  protected onDestroy?(): Promise<void> | void;

  protected onInitialize?(): Promise<void> | void;

  protected performInitialization?(): Promise<void>;

  protected async runAllListeners<K extends EventName<T>>(
    eventName: K,
    payload?: EventPayload<T, K>,
    options?: ExecOptions,
  ): Promise<void> {
    const entries = this.listeners.get(eventName);
    if (!entries || entries.length === 0) {
      return;
    }

    const snapshot = entries.slice();

    await this.executeListeners(
      snapshot.map((entry) => this.wrapListener(entry, payload, options)),
      options,
    );

    this.cleanupOnceListeners(snapshot);
  }

  protected wrapListener(
    entry: ListenerEntry<T, any>,
    payload?: EventPayload<T, any>,
    options?: ExecOptions,
  ): () => Promise<void> {
    return () => new Executor(() => entry.listener(payload), options).execute();
  }

  private ensureListenerArray<K extends EventName<T>>(eventName: K): ListenerEntry<T, any>[] {
    const arr: ListenerEntry<T, any>[] = [];
    this.listeners.set(eventName, arr);
    return arr;
  }
}
