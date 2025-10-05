import type {
  BroadcastAdapter,
  BroadcastAdapterStatus,
  BroadcastFilter,
  BroadcastMessage,
  BroadcastOptions,
  ErrorType,
  EventContext,
  EventMap,
  PlainObject,
} from '../types.ts';

import { genId, now } from '../utils.ts';

/**
 * BroadcastManager.
 *
 * @author dafengzhen
 */
export class BroadcastManager<EM extends EventMap> {
  private broadcastAdapters = new Map<string, BroadcastAdapter>();

  private broadcastFilters: BroadcastFilter[] = [];

  private handleEmit?: (eventName: keyof EM, context: EventContext<any>) => Promise<any>;

  private processedBroadcasts = new Set<string>();

  private subscribedChannels = new Set<string>();

  constructor(
    private readonly nodeId: string,
    private readonly handleError: <K extends keyof EM>(
      error: Error,
      context: EventContext<EM[K]>,
      type: ErrorType,
    ) => Promise<void>,
    private readonly maxProcessedBroadcasts = 10_000,
  ) {}

  addBroadcastAdapter(adapter: BroadcastAdapter): void {
    this.broadcastAdapters.set(adapter.name, adapter);
  }

  addBroadcastFilter(filter: BroadcastFilter): void {
    this.broadcastFilters.push(filter);
  }

  async broadcast<K extends keyof EM>(
    eventName: K,
    context: EventContext<EM[K]>,
    broadcastOptions: BroadcastOptions = {},
    handleLocalEmit: (eventName: K, context: EventContext<EM[K]>) => Promise<any>,
  ): Promise<any> {
    const localPromise = handleLocalEmit(eventName, context);
    const broadcastId = genId('broadcast');
    const channels = broadcastOptions.channels ?? ['default'];
    const adapters = this.getAdaptersToUse(broadcastOptions.adapters);

    const message = {
      broadcastId,
      context: {
        ...context,
        broadcast: true,
        broadcastChannels: channels,
        broadcastId,
        broadcastSource: this.nodeId,
        excludeSelf: broadcastOptions.excludeSelf ?? true,
        name: context.name!,
      },
      eventName: String(eventName),
      id: broadcastId,
      source: this.nodeId,
      timestamp: now(),
      traceId: context.traceId!,
      version: context.version!,
    };

    if (adapters.length > 0) {
      await Promise.allSettled(
        adapters.flatMap((adapter) =>
          channels.map((ch) => this.safeAdapterAction(adapter.publish(ch, message), adapter.name, ch, message.context)),
        ),
      );
    }

    return localPromise;
  }

  async checkBroadcastAdapters(): Promise<BroadcastAdapterStatus[]> {
    const results: BroadcastAdapterStatus[] = [];

    for (const [name, adapter] of this.broadcastAdapters) {
      try {
        await adapter.healthCheck?.();
        results.push({ healthy: true, name });
      } catch (error) {
        results.push({
          error: error instanceof Error ? error.message : String(error),
          healthy: false,
          name,
        });
      }
    }

    return results;
  }

  async destroy(): Promise<void> {
    await this.unsubscribeBroadcast([...this.subscribedChannels]);
    this.subscribedChannels.clear();

    await Promise.allSettled(
      Array.from(this.broadcastAdapters.values()).map((adapter) =>
        adapter.disconnect ? this.safeAdapterAction(adapter.disconnect(), adapter.name) : Promise.resolve(),
      ),
    );

    this.broadcastAdapters.clear();
    this.broadcastFilters = [];
    this.processedBroadcasts.clear();
    this.handleEmit = undefined;
  }

  getAdapterNames(): string[] {
    return Array.from(this.broadcastAdapters.keys());
  }

  getSubscribedChannels(): string[] {
    return Array.from(this.subscribedChannels);
  }

  async handleIncomingBroadcast(message: BroadcastMessage): Promise<void> {
    if (!this.handleEmit) {
      console.error('BroadcastManager: handleEmit is not set');
      return;
    }

    const key = `${message.broadcastId}_${message.source}`;
    if (this.processedBroadcasts.has(key)) {
      return;
    }

    this.cleanupProcessedBroadcasts();
    this.processedBroadcasts.add(key);

    try {
      const excludeSelf = message.context.excludeSelf ?? true;
      const isSelfSource = message.source === this.nodeId || message.context.broadcastSource === this.nodeId;
      if (excludeSelf && isSelfSource) {
        return;
      }

      for (const filter of this.broadcastFilters) {
        const ok = await filter(message);
        if (!ok) {
          return;
        }
      }

      await this.handleEmit(message.eventName as keyof EM, {
        ...message.context,
        broadcast: true,
        broadcastId: message.broadcastId,
        broadcastSource: message.source,
        receivedAt: now(),
      });
    } catch (error) {
      await this.handleError(
        error instanceof Error ? error : new Error(String(error)),
        message.context as PlainObject,
        'broadcast',
      );
    }
  }

  removeBroadcastAdapter(name: string): void {
    const adapter = this.broadcastAdapters.get(name);
    if (!adapter) {
      return;
    }

    for (const channel of this.subscribedChannels) {
      this.safeAdapterAction(adapter.unsubscribe(channel), adapter.name, channel);
    }

    if (adapter.disconnect) {
      this.safeAdapterAction(adapter.disconnect(), adapter.name);
    }

    this.broadcastAdapters.delete(name);
  }

  removeBroadcastFilter(filter: BroadcastFilter): void {
    const index = this.broadcastFilters.indexOf(filter);
    if (index >= 0) {
      this.broadcastFilters.splice(index, 1);
    }
  }

  setEmitHandler(handleEmit: (eventName: keyof EM, context: EventContext<any>) => Promise<any>): void {
    this.handleEmit = handleEmit;
  }

  async subscribeBroadcast(channels: string | string[], options: { adapter?: string } = {}): Promise<void> {
    const list = Array.isArray(channels) ? channels : [channels];
    const adapters = this.getAdaptersToUse(options.adapter ? [options.adapter] : undefined);

    for (const adapter of adapters) {
      for (const channel of list) {
        if (this.subscribedChannels.has(channel)) {
          continue;
        }

        await this.safeAdapterAction(
          adapter.subscribe(channel, (msg) => this.handleIncomingBroadcast(msg)),
          adapter.name,
          channel,
        );
        this.subscribedChannels.add(channel);
      }
    }
  }

  async unsubscribeBroadcast(channels: string | string[], adapterName?: string): Promise<void> {
    const list = Array.isArray(channels) ? channels : [channels];
    const adapters = this.getAdaptersToUse(adapterName ? [adapterName] : undefined);

    await Promise.allSettled(
      adapters.flatMap((adapter) =>
        list.map((channel) => this.safeAdapterAction(adapter.unsubscribe(channel), adapter.name, channel)),
      ),
    );

    list.forEach((ch) => this.subscribedChannels.delete(ch));
  }

  private cleanupProcessedBroadcasts(): void {
    const excess = this.processedBroadcasts.size - this.maxProcessedBroadcasts;
    if (excess <= 0) {
      return;
    }

    const iterator = this.processedBroadcasts.values();
    for (let i = 0; i < excess; i++) {
      const val = iterator.next().value;
      if (!val) {
        break;
      }
      this.processedBroadcasts.delete(val);
    }
  }

  private getAdaptersToUse(adapterNames?: string[]): BroadcastAdapter[] {
    if (adapterNames?.length) {
      return adapterNames.map((n) => this.broadcastAdapters.get(n)).filter((a): a is BroadcastAdapter => !!a);
    }
    return [...this.broadcastAdapters.values()];
  }

  private async safeAdapterAction(
    promise: Promise<unknown>,
    adapterName: string,
    channel?: string,
    context: PlainObject = {},
  ): Promise<void> {
    try {
      await promise;
    } catch (error) {
      await this.handleError(
        error instanceof Error ? error : new Error(String(error)),
        { ...context, adapter: adapterName, channel } as PlainObject,
        'adapter',
      );
    }
  }
}
