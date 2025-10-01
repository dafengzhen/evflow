import type { EventRecord, EventStore } from './types.js';

/**
 * InMemoryEventStore.
 *
 * @author dafengzhen
 */
export class InMemoryEventStore implements EventStore {
  private records: EventRecord[] = [];

  async clear(): Promise<void> {
    this.records = [];
  }

  async load(traceId: string): Promise<EventRecord[]> {
    return this.records.filter((r) => r.traceId === traceId);
  }

  async loadByName(name: string): Promise<EventRecord[]> {
    return this.records.filter((r) => r.name === name);
  }

  async loadByTimeRange(start: number, end: number): Promise<EventRecord[]> {
    return this.records.filter((r) => r.timestamp >= start && r.timestamp <= end);
  }

  async save(record: EventRecord): Promise<void> {
    this.records.push(record);
  }
}
