import type { EventRecord, EventStore } from './types.ts';

/**
 * InMemoryEventStore.
 *
 * @author dafengzhen
 */
export class InMemoryEventStore implements EventStore {
  private store = new Map<string, Map<string, EventRecord>>();

  async clear(): Promise<void> {
    this.store.clear();
  }

  async delete(traceId: string, id: string): Promise<void> {
    this.store.get(traceId)?.delete(id);
  }

  async load(traceId: string): Promise<EventRecord[]> {
    return Array.from(this.store.get(traceId)?.values() ?? []);
  }

  async loadByName(name: string): Promise<EventRecord[]> {
    return this.filterRecords((r) => r.name === name);
  }

  async loadByTimeRange(start: number, end: number): Promise<EventRecord[]> {
    return this.filterRecords((r) => r.timestamp >= start && r.timestamp <= end);
  }

  async save(record: EventRecord): Promise<void> {
    const traceId = record.traceId ?? 'unknown';
    const m = this.store.get(traceId) ?? new Map<string, EventRecord>();
    m.set(record.id, record);
    this.store.set(traceId, m);
  }

  private filterRecords(predicate: (record: EventRecord) => boolean): EventRecord[] {
    const result: EventRecord[] = [];
    for (const m of this.store.values()) {
      for (const r of m.values()) {
        if (predicate(r)) {
          result.push(r);
        }
      }
    }
    return result;
  }
}
