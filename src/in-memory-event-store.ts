import type { EventRecord, EventStore } from './types.js';

/**
 * InMemoryEventStore.
 *
 * @author dafengzhen
 */
export class InMemoryEventStore implements EventStore {
  private store: Map<string, Map<string, EventRecord>> = new Map();

  async clear(): Promise<void> {
    this.store.clear();
  }

  async delete(traceId: string, id: string): Promise<void> {
    const m = this.store.get(traceId);
    if (!m) {
      return;
    }
    m.delete(id);
  }

  async load(traceId: string): Promise<EventRecord[]> {
    const m = this.store.get(traceId);
    if (!m) {
      return [];
    }
    return Array.from(m.values());
  }

  async loadByName(name: string): Promise<EventRecord[]> {
    const result: EventRecord[] = [];
    for (const m of this.store.values()) {
      for (const r of m.values()) {
        if (r.name === name) {
          result.push(r);
        }
      }
    }
    return result;
  }

  async loadByTimeRange(start: number, end: number): Promise<EventRecord[]> {
    const result: EventRecord[] = [];
    for (const m of this.store.values()) {
      for (const r of m.values()) {
        if (r.timestamp >= start && r.timestamp <= end) {
          result.push(r);
        }
      }
    }
    return result;
  }

  async save(record: EventRecord): Promise<void> {
    const traceId = record.traceId ?? 'unknown';
    let m = this.store.get(traceId);
    if (!m) {
      m = new Map();
      this.store.set(traceId, m);
    }
    m.set(record.id, record);
  }
}
