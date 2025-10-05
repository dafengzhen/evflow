import { beforeEach, describe, expect, it } from 'vitest';

import type { EmitResult, EventContext, EventRecord } from '../types.ts';

import { EventState } from '../enums.ts';
import { InMemoryEventStore } from './in-memory-event-store.ts';

/**
 * InMemoryEventStore.
 *
 * @author dafengzhen
 */
describe('InMemoryEventStore', () => {
  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  it('should save and load a record', async () => {
    const record: EventRecord = {
      context: {},
      id: '1',
      name: 'testEvent',
      state: EventState.Idle,
      timestamp: Date.now(),
      traceId: 'trace1',
    };

    await store.save(record);

    const loaded = await store.load('trace1');
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(record);
  });

  it('should load all records', async () => {
    await store.save({
      context: {},
      id: '1',
      name: 'a',
      state: EventState.Idle,
      timestamp: Date.now(),
      traceId: 't1',
    });
    await store.save({
      context: {},
      id: '2',
      name: 'b',
      state: EventState.Idle,
      timestamp: Date.now(),
      traceId: 't2',
    });

    const all = await store.loadAll();
    expect(all).toHaveLength(2);
  });

  it('should load by name', async () => {
    const recordA = {
      context: {},
      id: '1',
      name: 'a',
      state: EventState.Idle,
      timestamp: Date.now(),
      traceId: 't1',
    };
    const recordB = {
      context: {},
      id: '2',
      name: 'b',
      state: EventState.Idle,
      timestamp: Date.now(),
      traceId: 't2',
    };
    await store.save(recordA);
    await store.save(recordB);

    const result = await store.loadByName('a');
    expect(result).toEqual([recordA]);
  });

  it('should load by time range', async () => {
    const now = Date.now();
    const record1 = {
      context: {},
      id: '1',
      name: 'a',
      state: EventState.Idle,
      timestamp: now - 1000,
      traceId: 't1',
    };
    const record2 = {
      context: {},
      id: '2',
      name: 'b',
      state: EventState.Idle,
      timestamp: now + 1000,
      traceId: 't2',
    };
    await store.save(record1);
    await store.save(record2);

    const result = await store.loadByTimeRange(now - 2000, now);
    expect(result).toEqual([record1]);
  });

  it('should delete a record', async () => {
    const record = { context: {}, id: '1', name: 'a', state: EventState.Idle, timestamp: Date.now(), traceId: 't1' };
    await store.save(record);

    await store.delete('t1', '1');
    const loaded = await store.load('t1');
    expect(loaded).toHaveLength(0);
  });

  it('should clear all records', async () => {
    await store.save({
      context: {},
      id: '1',
      name: 'a',
      state: EventState.Idle,
      timestamp: Date.now(),
      traceId: 't1',
    });
    await store.clear();
    const all = await store.loadAll();
    expect(all).toHaveLength(0);
  });

  it('should perform health check', async () => {
    await store.save({
      context: {},
      id: '1',
      name: 'a',
      state: EventState.Idle,
      timestamp: Date.now(),
      traceId: 't1',
    });
    const health = await store.healthCheck();
    expect(health.status).toBe('healthy');
    expect(health.details?.storedTraces).toBe(1);
  });

  it('should save an error record', async () => {
    const error = new Error('test error');
    const context: EventContext = { traceId: 't1' };

    await store.saveErrorRecord(error, context, 'adapter');
    const records = await store.load('t1');
    expect(records[0].error).toEqual(error);
    expect(records[0].state).toBe(EventState.Failed);
    expect(records[0].name).toBe('adapter');
  });

  it('should save event results', async () => {
    const record = { context: {}, id: '1', name: 'a', state: EventState.Idle, timestamp: Date.now(), traceId: 't1' };
    await store.save(record);

    const result = { handlerIndex: 0, id: '1', result: 'ok', state: EventState.Succeeded, traceId: 't1' } as EmitResult;
    await store.saveEventResults({ traceId: 't1' }, [result]);

    const loaded = await store.load('t1');
    expect(loaded[0].result).toBe('ok');
    expect(loaded[0].state).toBe(EventState.Succeeded);
  });

  it('should ignore saveEventResults if traceId not exist', async () => {
    const result = {
      handlerIndex: 0,
      id: '1',
      result: 'ok',
      state: EventState.Succeeded,
      traceId: 'unknown',
    } as EmitResult;
    await store.saveEventResults({ traceId: 'unknown' }, [result]);
    // should not throw
  });

  it('should handle unknown traceId when deleting', async () => {
    await store.delete('not_exist', '1'); // should not throw
  });

  it('should handle unknown traceId when loading', async () => {
    const result = await store.load('not_exist');
    expect(result).toEqual([]);
  });

  it('should handle unknown traceId when loadingAll (empty store)', async () => {
    const result = await store.loadAll();
    expect(result).toEqual([]);
  });
});
