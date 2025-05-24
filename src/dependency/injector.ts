import type { CloneStrategy } from '../types.ts';

export class Injector {
  private readonly cloneStrategy?: CloneStrategy;

  private instances = new Map<string, unknown>();

  private resolvedCache = new Map<string, unknown>();

  constructor(options?: { cloneStrategy?: CloneStrategy }) {
    this.cloneStrategy = options?.cloneStrategy;
  }

  clear(): void {
    this.instances.clear();
    this.resolvedCache.clear();
  }

  has(token: string): boolean {
    return this.instances.has(token);
  }

  inject<T>(factory: (...args: any[]) => T, dependencies: string[]): T {
    const resolvedDependencies = dependencies.map((dep) => this.resolve(dep));
    return factory(...resolvedDependencies);
  }

  register<T>(token: string, instance: T): void {
    if (this.instances.has(token)) {
      throw new Error(`Token ${token} already registered.`);
    }

    const clonedInstance = this.deepClone(instance, [], new WeakMap());
    this.instances.set(token, clonedInstance);
    this.resolvedCache.delete(token);
  }

  resolve<T>(token: string, options?: { throwIfNotRegistered?: boolean }): T {
    const cached = this.resolvedCache.get(token);
    if (cached !== undefined) {
      return this.deepClone(cached, [], new WeakMap()) as T;
    }

    const instance = this.instances.get(token);
    if (instance != null) {
      this.resolvedCache.set(token, instance);
      return this.deepClone(instance, [], new WeakMap()) as T;
    }

    const throwIfNotRegistered = options?.throwIfNotRegistered ?? true;
    if (throwIfNotRegistered) {
      throw new Error(`Token ${token} not registered.`);
    }

    return undefined as T;
  }

  private deepClone<T>(value: T, path: string[], seen: WeakMap<object, any>): T {
    if (this.cloneStrategy) {
      const strategyResult = this.cloneStrategy(value, path);
      if (strategyResult !== undefined) {
        return strategyResult as T;
      }
    }

    if (typeof value === 'function') {
      throw new Error(`Cannot clone function at path: ${path.join('.')}.`);
    }

    if (typeof HTMLElement !== 'undefined' && value instanceof HTMLElement) {
      throw new Error(`Cannot clone DOM element at path: ${path.join('.')}.`);
    }

    if (value === null || typeof value !== 'object') {
      return value;
    }

    const proto = Object.getPrototypeOf(value);
    const isArray = Array.isArray(value);
    const isPlainObject = proto === Object.prototype || proto === null;

    if (!isPlainObject && !isArray) {
      throw new Error(`Cannot clone custom class instance at path: ${path.join('.')}.`);
    }

    if (seen.has(value)) {
      return seen.get(value);
    }

    const cloned: any = isArray ? [] : {};
    seen.set(value, cloned);

    for (const [key, val] of Object.entries(value)) {
      cloned[key] = this.deepClone(val, [...path, key], seen);
    }

    return cloned;
  }
}
