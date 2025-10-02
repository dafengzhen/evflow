import type { BroadcastAdapter, BroadcastMessage } from './types.ts';

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

  public readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  static getDebugInfo(): Record<string, string[]> {
    const info: Record<string, string[]> = {};
    for (const [channel, subscribers] of this.sharedChannels) {
      info[channel] = subscribers.map((sub) => sub.adapter.name);
    }
    return info;
  }

  private static cleanupChannel(channel: string, keep: (sub: { adapter: MemoryBroadcastAdapter }) => boolean): void {
    const subscribers = this.sharedChannels.get(channel);
    if (!subscribers) {
      return;
    }

    const filtered = subscribers.filter(keep);
    if (filtered.length > 0) {
      this.sharedChannels.set(channel, filtered);
    } else {
      this.sharedChannels.delete(channel);
    }
  }

  async disconnect(): Promise<void> {
    for (const channel of MemoryBroadcastAdapter.sharedChannels.keys()) {
      MemoryBroadcastAdapter.cleanupChannel(channel, (sub) => sub.adapter !== this);
    }
  }

  async publish(channel: string, message: BroadcastMessage): Promise<void> {
    const subscribers = MemoryBroadcastAdapter.sharedChannels.get(channel);
    if (!subscribers) {
      return;
    }

    for (const sub of subscribers) {
      if (message.context.excludeSelf && sub.adapter === this) {
        continue;
      }

      try {
        sub.callback(message);
      } catch (error) {
        console.error(`[${this.name}] Delivery error to ${sub.adapter.name}:`, error);
      }
    }
  }

  async subscribe(channel: string, callback: (message: BroadcastMessage) => void): Promise<void> {
    const subscribers = MemoryBroadcastAdapter.sharedChannels.get(channel) ?? [];
    subscribers.push({ adapter: this, callback });
    MemoryBroadcastAdapter.sharedChannels.set(channel, subscribers);
  }

  async unsubscribe(channel: string): Promise<void> {
    MemoryBroadcastAdapter.cleanupChannel(channel, (sub) => sub.adapter !== this);
  }
}
