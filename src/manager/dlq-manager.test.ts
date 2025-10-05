import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EventState } from '../enums.ts';
import { DLQManager } from './dlq-manager.ts';

const mockNow = Date.now();
vi.mock('../utils', () => ({
  now: () => mockNow,
}));

/**
 * DLQManager.
 *
 * @author dafengzhen
 */
describe('DLQManager', () => {
  let storeManager: any;
  let handleError: any;
  let dlqManager: DLQManager;

  beforeEach(() => {
    handleError = vi.fn().mockResolvedValue(undefined);
    storeManager = {
      deleteEventRecord: vi.fn(),
      hasStore: vi.fn().mockReturnValue(true),
      loadAllRecords: vi.fn(),
      loadEventRecords: vi.fn(),
      saveErrorRecord: vi.fn(),
      saveRecord: vi.fn(),
    };
    dlqManager = new DLQManager(storeManager, handleError);
  });

  it('destroy should exist and not throw', () => {
    expect(() => dlqManager.destroy()).not.toThrow();
  });

  it('getDLQStats should return empty stats if store missing', async () => {
    storeManager.hasStore.mockReturnValue(false);
    const stats = await dlqManager.getDLQStats();
    expect(stats).toEqual({ byEvent: {}, newest: null, oldest: null, total: 0 });
  });

  it('listDLQ should return empty if store missing', async () => {
    storeManager.hasStore.mockReturnValue(false);
    const list = await dlqManager.listDLQ();
    expect(list).toEqual([]);
  });

  it('moveToDLQ should call saveRecord', async () => {
    const record = { context: {}, id: '1', name: 'evt', state: EventState.Idle, timestamp: mockNow, traceId: 't1' };
    await dlqManager.moveToDLQ(record);
    expect(storeManager.saveRecord).toHaveBeenCalled();
  });

  it('purgeDLQ should return false if DLQ not found', async () => {
    storeManager.loadEventRecords.mockResolvedValue([]);
    const result = await dlqManager.purgeDLQ('t1', 'dlq1');
    expect(result).toBe(false);
  });

  it('purgeDLQ should delete record and save error record', async () => {
    const dlq = {
      context: {},
      id: 'dlq1',
      name: 'evt',
      state: EventState.DeadLetter,
      timestamp: mockNow,
      traceId: 't1',
    };
    storeManager.loadEventRecords.mockResolvedValue([dlq]);
    const result = await dlqManager.purgeDLQ('t1', 'dlq1');
    expect(result).toBe(true);
    expect(storeManager.deleteEventRecord).toHaveBeenCalledWith('t1', 'dlq1');
    expect(storeManager.saveErrorRecord).toHaveBeenCalled();
  });

  it('purgeMultipleDLQ should handle success and errors', async () => {
    const purgeSpy = vi.spyOn(dlqManager, 'purgeDLQ').mockImplementation(async (traceId, id) => {
      if (id === 'ok') {
        return true;
      }
      throw new Error('fail');
    });
    const results = await dlqManager.purgeMultipleDLQ('t1', ['ok', 'fail']);
    expect(results).toEqual([
      { id: 'ok', success: true },
      { error: expect.any(String), id: 'fail', success: false },
    ]);
    purgeSpy.mockRestore();
  });

  it('requeueDLQ should throw if DLQ not found', async () => {
    storeManager.loadEventRecords.mockResolvedValue([]);
    await expect(dlqManager.requeueDLQ('t1', 'dlq1', vi.fn())).rejects.toThrow('DLQ record dlq1 not found');
  });

  it('requeueDLQ should call handleEmit and delete record', async () => {
    const dlq = {
      context: {},
      id: 'dlq1',
      name: 'evt',
      state: EventState.DeadLetter,
      timestamp: mockNow,
      traceId: 't1',
    };
    storeManager.loadEventRecords.mockResolvedValue([dlq]);
    const handleEmit = vi.fn().mockResolvedValue([{ result: 'ok' }]);
    const result = await dlqManager.requeueDLQ('t1', 'dlq1', handleEmit);
    expect(result).toEqual([{ result: 'ok' }]);
    expect(storeManager.deleteEventRecord).toHaveBeenCalledWith('t1', 'dlq1');
  });

  it('requeueMultipleDLQ should return results with success and errors', async () => {
    const spy = vi.spyOn(dlqManager, 'requeueDLQ');
    spy
      .mockImplementationOnce(async () => {})
      .mockImplementationOnce(async () => {
        throw new Error('fail');
      });
    const results = await dlqManager.requeueMultipleDLQ('t1', ['ok', 'fail'], vi.fn());
    expect(results).toEqual([
      { id: 'ok', success: true },
      { error: 'fail', id: 'fail', success: false },
    ]);
    spy.mockRestore();
  });
});
