import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EventMap } from '../types.ts';

import * as utils from '../utils.ts';
import { ContextNormalizer } from './context-normalizer.ts';

// Fake EventMap
interface MyEvents extends EventMap {
  orderPaid: { amount: number; orderId: string };
  userCreated: { id: string; name: string };
}

/**
 * ContextNormalizer.
 *
 * @author dafengzhen
 */
describe('ContextNormalizer', () => {
  const normalizer = new ContextNormalizer<MyEvents>();

  beforeEach(() => {
    // mock time and ID
    vi.spyOn(utils, 'now').mockReturnValue(1234567890);
    vi.spyOn(utils, 'genId').mockReturnValue('trace-abc');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return a context with default values', () => {
    const result = normalizer.normalize('userCreated');

    expect(result).toEqual({
      name: 'userCreated',
      timestamp: 1234567890,
      traceId: 'trace-abc',
      version: 1,
    });
  });

  it('should override default values with fields from context', () => {
    const result = normalizer.normalize('orderPaid', {
      name: 'customName',
      timestamp: 999,
      traceId: 'trace-custom',
      version: 2,
    });

    expect(result).toEqual({
      name: 'customName',
      timestamp: 999,
      traceId: 'trace-custom',
      version: 2,
    });
  });

  it('should preserve additional fields from context', () => {
    const result = normalizer.normalize('userCreated', {
      extra: 'info',
      name: 'custom',
    } as any);

    expect(result).toEqual({
      extra: 'info',
      name: 'custom',
      timestamp: 1234567890,
      traceId: 'trace-abc',
      version: 1,
    });
  });

  it('should automatically set name based on eventName', () => {
    const result = normalizer.normalize('orderPaid', {});

    expect(result.name).toBe('orderPaid');
  });

  it('should generate a unique traceId automatically', () => {
    const genIdSpy = vi.spyOn(utils, 'genId').mockReturnValue('trace-xyz');
    const result = normalizer.normalize('userCreated');
    expect(genIdSpy).toHaveBeenCalledWith('trace');
    expect(result.traceId).toBe('trace-xyz');
  });
});
