import type { ErrorType, EventContext, EventRecord, PlainObject } from '../types.ts';
import type { StoreManager } from './store-manager.ts';

import { EventState } from '../enums.ts';
import { now } from '../utils.ts';

/**
 * DLQManager.
 *
 * @author dafengzhen
 */
export class DLQManager {
  constructor(
    private readonly storeManager: StoreManager,
    private readonly handleError?: (error: Error, context: PlainObject, type: ErrorType) => Promise<void>,
  ) {}

  destroy(): void {}

  async getDLQStats(
    traceId?: string,
  ): Promise<{ byEvent: Record<string, number>; newest: Date | null; oldest: Date | null; total: number }> {
    if (!this.storeManager.hasStore()) {
      return { byEvent: {}, newest: null, oldest: null, total: 0 };
    }

    const records = await this.listDLQ(traceId);
    const byEvent: Record<string, number> = {};
    let oldest: null | number = null;
    let newest: null | number = null;

    for (const r of records) {
      byEvent[r.name] = (byEvent[r.name] || 0) + 1;
      const t = r.timestamp;
      if (oldest === null || t < oldest) {
        oldest = t;
      }
      if (newest === null || t > newest) {
        newest = t;
      }
    }

    return {
      byEvent,
      newest: newest ? new Date(newest) : null,
      oldest: oldest ? new Date(oldest) : null,
      total: records.length,
    };
  }

  async listDLQ(traceId?: string): Promise<EventRecord[]> {
    if (!this.storeManager.hasStore()) {
      return [];
    }

    try {
      const records = traceId
        ? await this.storeManager.loadEventRecords(traceId)
        : await this.storeManager.loadAllRecords();

      return records.filter((r) => r.state === EventState.DeadLetter).sort((a, b) => b.timestamp - a.timestamp);
    } catch (err) {
      await this.reportError(err, { traceId }, 'store');
      return [];
    }
  }

  async moveToDLQ(record: EventRecord): Promise<void> {
    if (!this.storeManager.hasStore()) {
      return;
    }
    const dlqRecord = this.createDLQRecord(record);

    try {
      await this.storeManager.saveRecord(dlqRecord);
    } catch (err) {
      await this.reportError(err, record, 'store');
    }
  }

  async purgeDLQ(traceId: string, dlqId: string, reason = 'manual_purge'): Promise<boolean> {
    if (!this.storeManager.hasStore()) {
      throw new Error('EventStore is required to purge DLQ items');
    }

    const records = await this.storeManager.loadEventRecords(traceId);
    const dlq = records.find((r) => r.id === dlqId && r.state === EventState.DeadLetter);
    if (!dlq) {
      return false;
    }

    await this.storeManager.deleteEventRecord(traceId, dlqId);

    await this.storeManager.saveErrorRecord(
      new Error(`DLQ purged: ${reason}`),
      {
        originalDlqId: dlqId,
        purgedAt: now(),
        purgedReason: reason,
        traceId,
      },
      'dlq_purge',
    );

    return true;
  }

  async purgeMultipleDLQ(
    traceId: string,
    dlqIds: string[],
  ): Promise<{ error?: string; id: string; success: boolean }[]> {
    if (!this.storeManager.hasStore()) {
      throw new Error('EventStore is required to purge DLQ items');
    }

    const results: { error?: string; id: string; success: boolean }[] = [];

    for (const id of dlqIds) {
      try {
        const success = await this.purgeDLQ(traceId, id);
        results.push({ id, success });
      } catch (err) {
        results.push({
          error: err instanceof Error ? err.message : String(err),
          id,
          success: false,
        });
      }
    }

    return results;
  }

  async requeueDLQ(
    traceId: string,
    dlqId: string,
    handleEmit: (eventName: any, context: EventContext<any>, taskOptions?: any, emitOptions?: any) => Promise<any>,
    emitOptions?: any,
    taskOptions?: any,
  ): Promise<any> {
    if (!this.storeManager.hasStore()) {
      throw new Error('EventStore is required');
    }

    const records = await this.storeManager.loadEventRecords(traceId);
    const dlq = records.find((r) => r.id === dlqId && r.state === EventState.DeadLetter);
    if (!dlq) {
      throw new Error(`DLQ record ${dlqId} not found`);
    }

    const requeueCount = Number(dlq.context.requeueCount ?? 0);
    const maxRequeue = Number(dlq.context.maxRequeue ?? 5);

    if (requeueCount >= maxRequeue) {
      throw new Error(`DLQ ${dlqId} exceeded max requeue (${maxRequeue})`);
    }

    const timestamp = now();
    const ctx: EventContext<any> = {
      ...dlq.context,
      disableAutoDLQ: true,
      parentId: dlq.id,
      requeueCount: requeueCount + 1,
      timestamp,
      traceId: dlq.traceId,
    };

    const options = { retries: 0, ...(taskOptions ?? {}) };

    try {
      const results = await handleEmit(dlq.name, ctx, options, emitOptions ?? {});
      const hasError = Array.isArray(results) && results.some((r: any) => r?.error);

      if (hasError) {
        const firstError = results.find((r: any) => r?.error)?.error;
        await this.storeManager.saveRecord(this.createDLQRecord(dlq, firstError));
      }

      await this.storeManager.deleteEventRecord(traceId, dlqId);
      return results;
    } catch (err) {
      if (requeueCount < maxRequeue) {
        await this.storeManager.saveRecord(this.createDLQRecord(dlq, err as Error | string | undefined));
      }

      await this.storeManager.deleteEventRecord(traceId, dlqId);
      throw err;
    }
  }

  async requeueMultipleDLQ(
    traceId: string,
    dlqIds: string[],
    handleEmit: (eventName: any, context: EventContext<any>, taskOptions?: any, emitOptions?: any) => Promise<any>,
  ): Promise<{ error?: string; id: string; success: boolean }[]> {
    const results: { error?: string; id: string; success: boolean }[] = [];

    for (const id of dlqIds) {
      try {
        await this.requeueDLQ(traceId, id, handleEmit);
        results.push({ id, success: true });
      } catch (err) {
        results.push({
          error: err instanceof Error ? err.message : String(err),
          id,
          success: false,
        });
      }
    }

    return results;
  }

  private createDLQRecord(base: EventRecord, error?: Error | string): EventRecord {
    const errMsg = error instanceof Error ? error : new Error(error);
    const timestamp = now();
    return {
      ...base,
      error: errMsg ?? base.error ?? new Error(),
      id: `dlq_${base.id}_${timestamp}`,
      state: EventState.DeadLetter,
      timestamp,
    };
  }

  private async reportError(err: unknown, context: PlainObject, type: ErrorType = 'store') {
    if (!this.handleError) {
      return;
    }

    const error = err instanceof Error ? err : new Error(String(err));
    await this.handleError(error, context, type);
  }
}
