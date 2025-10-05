import type { ErrorType, EventContext, EventMap, EventRecord, EventStore, PlainObject } from '../types.ts';

import { EventState } from '../enums.ts';
import { genId, now, safeStoreSave } from '../utils.ts';

/**
 * StoreManager.
 *
 * @author dafengzhen
 */
export class StoreManager<EM extends EventMap> {
  constructor(
    private store?: EventStore,
    private handleError?: <K extends keyof EM>(
      error: Error,
      context: EventContext<EM[K]>,
      type: ErrorType,
    ) => Promise<void>,
  ) {}

  async checkStoreHealth(): Promise<{ error?: string; status: 'healthy' | 'not_configured' | 'unhealthy' }> {
    if (!this.store) {
      return { status: 'not_configured' };
    }

    try {
      await this.store.healthCheck?.();
      return { status: 'healthy' };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err), status: 'unhealthy' };
    }
  }

  async deleteEventRecord(traceId: string, id: string): Promise<void> {
    if (!this.store) {
      return;
    }

    try {
      await this.store.delete(traceId, id);
    } catch (err) {
      await this.handleStoreError(err, { id, traceId }, 'delete');
    }
  }

  async destroy(): Promise<void> {
    if (!this.store) {
      return;
    }

    try {
      await this.store.clear?.();
    } catch (err) {
      await this.handleStoreError(err, {}, 'destroy');
    }
  }

  getStore(): EventStore | undefined {
    return this.store;
  }

  hasStore(): boolean {
    return !!this.store;
  }

  async loadAllRecords(): Promise<EventRecord[]> {
    if (!this.store) {
      return [];
    }

    try {
      if (typeof this.store.loadAll === 'function') {
        return await this.store.loadAll();
      }

      const end = now();
      const start = end - 30 * 24 * 60 * 60 * 1000;
      return this.store.loadByTimeRange ? await this.store.loadByTimeRange(start, end) : [];
    } catch (err) {
      await this.handleStoreError(err, {}, 'loadAll');
      return [];
    }
  }

  async loadByTimeRange(start: number, end: number): Promise<EventRecord[]> {
    if (!this.store?.loadByTimeRange) {
      return [];
    }

    try {
      return await this.store.loadByTimeRange(start, end);
    } catch (err) {
      await this.handleStoreError(err, { end, start } as PlainObject, 'loadByTimeRange');
      return [];
    }
  }

  async loadEventRecords(traceId: string): Promise<EventRecord[]> {
    if (!this.store) {
      return [];
    }

    try {
      return await this.store.load(traceId);
    } catch (err) {
      await this.handleStoreError(err, { traceId }, 'load');
      return [];
    }
  }

  async saveErrorRecord<K extends keyof EM>(error: Error, context: EventContext<EM[K]>, type: string): Promise<void> {
    if (!this.store) {
      return;
    }

    const record: EventRecord = {
      context,
      error: error,
      id: genId('error'),
      name: `error.${type}`,
      result: null,
      state: EventState.Failed,
      timestamp: now(),
      traceId: context.traceId || genId('trace'),
      version: 1,
    };

    await this.safeSave(record, context);
  }

  async saveEventResults(
    context: EventContext<any>,
    results: Array<{ error?: any; handlerIndex: number; result?: any; state: any; traceId: string }>,
  ): Promise<void> {
    if (!this.store) {
      return;
    }

    await Promise.all(
      results.map((r) =>
        this.safeSave(
          {
            context: context,
            error: r.error,
            id: `${context.name}_${r.handlerIndex}_${now()}`,
            name: context.name!,
            result: r.result,
            state: r.state,
            timestamp: context.timestamp!,
            traceId: context.traceId!,
            version: context.version ?? 1,
          },
          context,
        ),
      ),
    );
  }

  async saveRecord(record: EventRecord): Promise<void> {
    if (!this.store) {
      return;
    }

    await this.safeSave(record, record.context as PlainObject);
  }

  private async handleStoreError<K extends keyof EM>(err: unknown, context: EventContext<EM[K]>, type: string) {
    if (this.handleError) {
      await this.handleError(err instanceof Error ? err : new Error(String(err)), context, 'store');
    } else {
      console.error(`[StoreManager][${type}]`, err);
    }
  }

  private async safeSave<K extends keyof EM>(record: EventRecord, context: EventContext<EM[K]>): Promise<void> {
    try {
      await safeStoreSave(this.store!, record);
    } catch (err) {
      await this.handleStoreError(err, context, 'save');
    }
  }
}
