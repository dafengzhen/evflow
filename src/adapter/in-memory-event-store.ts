import type { EmitResult, EventContext, EventRecord, EventStore, PlainObject, StoreHealthStatus } from '../types.ts';

import { EventState } from '../enums.ts';

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

  async healthCheck(): Promise<StoreHealthStatus> {
    return {
      details: { storedTraces: this.store.size },
      message: 'In-memory store is operational',
      status: 'healthy',
    };
  }

  async load(traceId: string): Promise<EventRecord[]> {
    return Array.from(this.store.get(traceId)?.values() ?? []);
  }

  async loadAll(): Promise<EventRecord[]> {
    return this.filterRecords(() => true);
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

  async saveErrorRecord(error: Error, context: PlainObject & { traceId?: string }, type: string): Promise<void> {
    const record: EventRecord = {
      context,
      error,
      errorStack: error.stack,
      id: `${Date.now()}-${Math.random()}`,
      name: type,
      state: EventState.Failed,
      timestamp: Date.now(),
      traceId: context.traceId ?? 'unknown',
    };
    await this.save(record);
  }

  async saveEventResults(context: EventContext, results: EmitResult[]): Promise<void> {
    const traceId = context.traceId ?? 'unknown';
    const events = this.store.get(traceId);
    if (!events) {
      return;
    }

    for (const result of results) {
      const _result = result as any;
      if (_result.id) {
        const record = events.get(_result.id);
        if (record) {
          record.result = result.result;
          record.state = result.state;
          record.timestamp = Date.now();
        }
      }
    }
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
