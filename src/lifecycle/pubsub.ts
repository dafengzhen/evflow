import type { Callback, MiddlewareContext } from '../types.ts';

export class PubSub {
  private subscribers = new Map<string, Set<Callback>>();

  clear() {
    this.subscribers.clear();
  }

  async publish(topic: string, data: MiddlewareContext) {
    const subs = this.subscribers.get(topic);
    if (!subs || subs.size === 0) {
      return;
    }

    const results: Promise<void>[] = [];

    for (const cb of subs) {
      try {
        const result = cb(data);
        results.push(
          Promise.resolve(result).catch((err) => {
            console.error(`Error in subscriber for topic "${topic}":`, err);
          }),
        );
      } catch (err) {
        console.error(`Error in subscriber for topic "${topic}":`, err);
      }
    }

    await Promise.all(results);
  }

  subscribe(topic: string, cb: Callback) {
    let subs = this.subscribers.get(topic);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(topic, subs);
    }
    subs.add(cb);
  }

  unsubscribe(topic: string, cb: Callback) {
    this.subscribers.get(topic)?.delete(cb);
  }
}
