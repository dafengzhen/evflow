import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventStore } from '../types.ts';

import { EventState } from '../enums.ts';
import * as utils from '../utils.ts';
import { StoreManager } from './store-manager.ts';

/**
 * StoreManager.
 *
 * @author dafengzhen
 */
describe('StoreManager', () => {
  let mockStore: EventStore;
  let handleError: any;
  let storeManager: StoreManager;

  beforeEach(() => {
    handleError = vi.fn();
    mockStore = {
      clear: vi.fn(),
      delete: vi.fn(),
      healthCheck: vi.fn(),
      load: vi.fn(),
      loadAll: vi.fn(),
      loadByTimeRange: vi.fn(),
      save: vi.fn(),
      saveEventResults: vi.fn(),
    } as any;
    storeManager = new StoreManager(mockStore, handleError);
  });

  it('should check store health correctly', async () => {
    mockStore.healthCheck = vi.fn().mockResolvedValue(undefined);
    const result = await storeManager.checkStoreHealth();
    expect(result.status).toBe('healthy');

    storeManager = new StoreManager(undefined);
    expect(await storeManager.checkStoreHealth()).toEqual({ status: 'not_configured' });

    const badStore = { healthCheck: vi.fn().mockRejectedValue(new Error('fail')) } as any;
    storeManager = new StoreManager(badStore, handleError);
    const res = await storeManager.checkStoreHealth();
    expect(res.status).toBe('unhealthy');
    expect(res.error).toBe('fail');
  });

  it('should delete event record and handle error', async () => {
    mockStore.delete = vi.fn().mockRejectedValue(new Error('fail'));
    await storeManager.deleteEventRecord('trace1', 'id1');
    expect(handleError).toHaveBeenCalled();
  });

  it('should destroy store and handle error', async () => {
    mockStore.clear = vi.fn().mockRejectedValue(new Error('fail'));
    await storeManager.destroy();
    expect(handleError).toHaveBeenCalled();
  });

  it('should return correct store presence', () => {
    expect(storeManager.hasStore()).toBe(true);
    expect(storeManager.getStore()).toBe(mockStore);
  });

  it('should load all records with fallback', async () => {
    mockStore.loadAll = vi
      .fn()
      .mockResolvedValue([
        { context: {}, id: '1', name: 'n', state: EventState.Idle, timestamp: Date.now(), traceId: 't' },
      ]);
    const res = await storeManager.loadAllRecords();
    expect(res.length).toBe(1);
  });

  it('should save error record', async () => {
    const error = new Error('test');
    const ctx = { traceId: 'trace1' };
    await storeManager.saveErrorRecord(error, ctx, 'adapter');
    expect(mockStore.save).toHaveBeenCalled();
  });

  it('should save event results', async () => {
    const ctx = { name: 'event1', timestamp: Date.now(), traceId: 'trace1' };
    await storeManager.saveEventResults(ctx, [{ handlerIndex: 0, state: EventState.Succeeded, traceId: 'trace1' }]);
    expect(mockStore.save).toHaveBeenCalled();
  });

  it('should save record safely and handle error', async () => {
    vi.spyOn(utils, 'safeStoreSave').mockImplementation(() => {
      throw new Error('fail');
    });

    await storeManager.saveRecord({
      context: {},
      id: '1',
      name: 'n',
      state: EventState.Idle,
      timestamp: Date.now(),
      traceId: 't',
    });

    expect(handleError).toHaveBeenCalled();
  });

  it('should load by time range safely', async () => {
    mockStore.loadByTimeRange = vi.fn().mockRejectedValue(new Error('fail'));
    await storeManager.loadByTimeRange(0, 1);
    expect(handleError).toHaveBeenCalled();
  });

  it('should load event records safely', async () => {
    mockStore.load = vi.fn().mockRejectedValue(new Error('fail'));
    const res = await storeManager.loadEventRecords('trace1');
    expect(res).toEqual([]);
    expect(handleError).toHaveBeenCalled();
  });
});
