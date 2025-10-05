import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_EMIT_OPTIONS, genId, now, safeStoreSave } from './utils.ts';

describe('DEFAULT_EMIT_OPTIONS', () => {
  it('should have default values', () => {
    expect(DEFAULT_EMIT_OPTIONS).toEqual({
      globalTimeout: 0,
      maxConcurrency: 1,
      parallel: true,
      stopOnError: false,
    });
  });
});

describe('now', () => {
  it('should return a number close to Date.now()', () => {
    const start = Date.now();
    const result = now();
    const end = Date.now();
    expect(result).toBeGreaterThanOrEqual(start);
    expect(result).toBeLessThanOrEqual(end);
  });
});

describe('genId', () => {
  it('should generate unique IDs', () => {
    const id1 = genId('test');
    const id2 = genId('test');
    expect(id1).not.toBe(id2);
    expect(id1).toContain('test_');
    expect(id2).toContain('test_');
  });

  it('should use default prefix "id" if none provided', () => {
    const id = genId();
    expect(id.startsWith('id_')).toBe(true);
  });

  it('should call now internally', () => {
    const mockNow = vi.spyOn(Date, 'now').mockReturnValue(123456);
    const id = genId('mock');
    expect(id).toContain('123456');
    mockNow.mockRestore();
  });
});

describe('safeStoreSave', () => {
  it('should do nothing if store is undefined', async () => {
    await expect(safeStoreSave(undefined, { data: 'x', id: '1' } as any)).resolves.toBeUndefined();
  });

  it('should call store.save if store is defined', async () => {
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const store = { save: saveMock } as any;
    const rec = { data: 'x', id: '1' } as any;

    await safeStoreSave(store, rec);
    expect(saveMock).toHaveBeenCalledOnce();
    expect(saveMock).toHaveBeenCalledWith(rec);
  });

  it('should catch errors and not throw', async () => {
    const consoleWarnMock = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = { save: vi.fn().mockRejectedValue(new Error('fail')) } as any;
    const rec = { data: 'x', id: '1' } as any;

    await expect(safeStoreSave(store, rec)).resolves.toBeUndefined();
    expect(consoleWarnMock).toHaveBeenCalled();

    consoleWarnMock.mockRestore();
  });
});
