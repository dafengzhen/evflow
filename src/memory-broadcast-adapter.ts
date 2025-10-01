import type { BroadcastAdapter, BroadcastMessage } from './types.js';

/**
 * MemoryBroadcastAdapter.
 *
 * @author dafengzhen
 */
export class MemoryBroadcastAdapter implements BroadcastAdapter {
  private static sharedChannels: Map<
    string,
    Array<{
      adapter: MemoryBroadcastAdapter;
      callback: (message: BroadcastMessage) => void;
    }>
  > = new Map();

  public name: string;

  constructor(name: string) {
    this.name = name;
  }

  static getDebugInfo() {
    const info: any = {};
    for (const [channel, subscribers] of MemoryBroadcastAdapter.sharedChannels.entries()) {
      info[channel] = subscribers.map((sub) => sub.adapter.name);
    }
    return info;
  }

  async disconnect(): Promise<void> {
    for (const [channel, subscribers] of MemoryBroadcastAdapter.sharedChannels.entries()) {
      const filtered = subscribers.filter((sub) => sub.adapter !== this);
      if (filtered.length > 0) {
        MemoryBroadcastAdapter.sharedChannels.set(channel, filtered);
      } else {
        MemoryBroadcastAdapter.sharedChannels.delete(channel);
      }
    }
  }

  async publish(channel: string, message: BroadcastMessage): Promise<void> {
    const subscribers = MemoryBroadcastAdapter.sharedChannels.get(channel) || [];

    for (const { adapter, callback } of subscribers) {
      if (message.context.excludeSelf && adapter === this) {
        continue;
      }

      try {
        callback(message);
      } catch (error) {
        console.error(`❌ [${this.name}] Delivery error to ${adapter.name}:`, error);
      }
    }
  }

  async subscribe(channel: string, callback: (message: BroadcastMessage) => void): Promise<void> {
    if (!MemoryBroadcastAdapter.sharedChannels.has(channel)) {
      MemoryBroadcastAdapter.sharedChannels.set(channel, []);
    }

    const subscribers = MemoryBroadcastAdapter.sharedChannels.get(channel)!;
    subscribers.push({ adapter: this, callback });
  }

  async unsubscribe(channel: string): Promise<void> {
    const subscribers = MemoryBroadcastAdapter.sharedChannels.get(channel) || [];
    const filtered = subscribers.filter((sub) => sub.adapter !== this);

    if (filtered.length > 0) {
      MemoryBroadcastAdapter.sharedChannels.set(channel, filtered);
    } else {
      MemoryBroadcastAdapter.sharedChannels.delete(channel);
    }
  }
}
