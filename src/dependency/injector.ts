export class Injector {
  private instances = new Map<string, unknown>();

  private operationQueues = new Map<string, Promise<unknown>>();

  private resolvedCache = new Map<string, unknown>();

  clear(): void {
    this.instances.clear();
    this.resolvedCache.clear();
    this.operationQueues.clear();
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
    this.instances.set(token, instance);
    this.resolvedCache.delete(token);
  }

  resolve<T>(token: string): T {
    const cached = this.resolvedCache.get(token);
    if (cached !== undefined) {
      return cached as T;
    }

    const instance = this.instances.get(token);
    if (instance != null) {
      this.resolvedCache.set(token, instance);
    }

    return instance as T;
  }
}
