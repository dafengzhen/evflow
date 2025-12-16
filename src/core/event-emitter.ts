import type {
  BaseEventDefinitions,
  CompiledPatternListenerEntry,
  EmitOptions,
  EventListener,
  EventMiddleware,
  EventName,
  EventPayload,
  ExecOptions,
  ListenerEntry,
  MiddlewareContext,
  MiddlewareSupport,
  OnceOptions,
  OnOptions,
  PatternOptions,
  Support,
  WildcardCompileOptions,
  WildcardSupport
} from './types.ts';

import { Executor } from './executor.ts';

/**
 * EventEmitter.
 *
 * @author dafengzhen
 */
export class EventEmitter<T extends BaseEventDefinitions>
  implements MiddlewareSupport<T>, Support<T>, WildcardSupport<T> {
  private listeners = new Map<EventName<T>, ListenerEntry<T, any>[]>();

  private middlewares: EventMiddleware<T>[] = [];

  private patternCache = new Map<string, RegExp>();

  private patternListeners: CompiledPatternListenerEntry<T>[] = [];

  destroy(): void {
    this.listeners.clear();
    this.patternListeners.length = 0;
    this.middlewares.length = 0;
    this.patternCache.clear();
  }

  async emit<K extends EventName<T>>(eventName: K, payload?: EventPayload<T, K>, options?: EmitOptions): Promise<void> {
    const execOptions = (options ?? {}) as ExecOptions;

    const ctx: MiddlewareContext<T> = {
      eventName,
      options: execOptions,
      payload,
      state: Object.create(null)
    };

    const fn = this.composeMiddlewares(this.middlewares, async () => {
      await this.emitCore(eventName, payload, execOptions);
    });

    await fn(ctx);
  }

  match(pattern: string, listener: EventListener<T, any>, options: PatternOptions = {}): () => void {
    const entry: CompiledPatternListenerEntry<T> = {
      cache: options.cache,
      flags: options.flags,
      listener,
      once: options.once ?? false,
      pattern,
      priority: options.priority ?? 0,
      re: this.compileWildcard(pattern, {
        cache: options.cache,
        flags: options.flags,
        separator: options.separator
      }),
      separator: options.separator
    };

    this.insertByPriority(this.patternListeners, entry);
    return () => this.unmatch(pattern, listener);
  }

  matchOnce(pattern: string, listener: EventListener<T, any>, options?: OnceOptions): () => void {
    return this.match(pattern, listener, { ...options, once: true });
  }

  off<K extends EventName<T>>(eventName: K, listener: EventListener<T, K>): void {
    const list = this.listeners.get(eventName);
    if (!list) {
      return;
    }

    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].listener === listener) {
        list.splice(i, 1);
        break;
      }
    }

    if (list.length === 0) {
      this.listeners.delete(eventName);
    }
  }

  on<K extends EventName<T>>(eventName: K, listener: EventListener<T, K>, options: OnOptions = {}): () => void {
    const entry: ListenerEntry<T, K> = {
      eventName,
      listener,
      once: options.once ?? false,
      priority: options.priority ?? 0
    };

    const list = this.getOrCreateList(eventName);
    this.insertByPriority(list, entry);

    return () => this.off(eventName, listener);
  }

  once<K extends EventName<T>>(
    eventName: K,
    listener: EventListener<T, K>,
    options: Omit<OnOptions, 'once'> = {}
  ): () => void {
    return this.on(eventName, listener, { ...options, once: true });
  }

  unmatch(pattern: string, listener: EventListener<T, any>): void {
    for (let i = this.patternListeners.length - 1; i >= 0; i--) {
      const e = this.patternListeners[i];
      if (e.pattern === pattern && e.listener === listener) {
        this.patternListeners.splice(i, 1);
        break;
      }
    }
  }

  use(middleware: EventMiddleware<T>): () => void {
    this.middlewares.push(middleware);
    return () => {
      const i = this.middlewares.indexOf(middleware);
      if (i !== -1) {
        this.middlewares.splice(i, 1);
      }
    };
  }

  private compileWildcard(pattern: string, options: WildcardCompileOptions = {}): RegExp {
    const { flags = '', separator = '.' } = options;
    const key = `${pattern}|${separator}|${flags}`;

    const cached = this.patternCache.get(key);
    if (cached) {
      return cached;
    }

    const sep = this.escape(separator);
    let out = '^';
    let escaped = false;

    for (const ch of pattern) {
      if (!escaped && ch === '\\') {
        escaped = true;
        continue;
      }

      if (escaped) {
        out += this.escape(ch);
        escaped = false;
        continue;
      }

      switch (ch) {
        case '#':
          out += '.*';
          break;
        case '*':
          out += `[^${sep}]*`;
          break;
        case '+':
          out += `[^${sep}]+`;
          break;
        case '?':
          out += `[^${sep}]`;
          break;
        default:
          out += this.escape(ch);
      }
    }

    out += '$';
    const re = new RegExp(out, flags);
    this.patternCache.set(key, re);
    return re;
  }

  private composeMiddlewares(middlewares: EventMiddleware<T>[], finalHandler: () => Promise<void>) {
    return async (ctx: MiddlewareContext<T>): Promise<void> => {
      let index = -1;

      const dispatch = async (i: number): Promise<void> => {
        if (i <= index) {
          return Promise.reject(new Error('next() called multiple times.'));
        }
        index = i;

        const fn = i === middlewares.length ? finalHandler : middlewares[i];
        if (!fn) {
          return Promise.resolve();
        }

        try {
          if (i === middlewares.length) {
            return Promise.resolve((fn as () => Promise<void>)());
          }

          return Promise.resolve(fn(ctx, () => dispatch(i + 1)));
        } catch (err) {
          return Promise.reject(err);
        }
      };

      return dispatch(0);
    };
  }

  private async emitCore<K extends EventName<T>>(
    eventName: K,
    payload?: EventPayload<T, K>,
    options?: ExecOptions
  ): Promise<void> {
    const nameStr = String(eventName);

    const exact = this.listeners.get(eventName);
    const exactSnapshot = exact ? exact.slice() : [];

    const patternSnapshot = this.patternListeners.length ? this.patternListeners.slice() : [];

    for (const e of exactSnapshot) {
      await new Executor(() => e.listener(payload), options).execute();
    }

    for (const e of patternSnapshot) {
      if (e.re.test(nameStr)) {
        await new Executor(() => e.listener(payload), options).execute();
      }
    }

    for (const e of exactSnapshot) {
      if (e.once) {
        this.off(eventName, e.listener);
      }
    }

    for (const e of patternSnapshot) {
      if (e.once && e.re.test(nameStr)) {
        this.unmatch(e.pattern, e.listener);
      }
    }
  }

  private escape(ch: string): string {
    return ch.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
  }

  private getOrCreateList<K extends EventName<T>>(eventName: K): ListenerEntry<T, K>[] {
    let list = this.listeners.get(eventName);
    if (!list) {
      list = [];
      this.listeners.set(eventName, list);
    }
    return list;
  }

  private insertByPriority<TEntry extends { priority?: number }>(list: TEntry[], entry: TEntry): void {
    const p = entry.priority ?? 0;
    let lo = 0;
    let hi = list.length;

    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const mp = list[mid].priority ?? 0;
      if (mp >= p) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    list.splice(lo, 0, entry);
  }
}
