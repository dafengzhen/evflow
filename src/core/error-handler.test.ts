import type { Mock } from 'vitest';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoreManager } from '../manager/index.ts';
import type { ErrorType, PlainObject } from '../types.ts';

import { ErrorHandler } from './error-handler.ts';

/**
 * ErrorHandler.
 *
 * @author dafengzhen
 */
describe('ErrorHandler', () => {
  let mockStoreManager: Partial<StoreManager>;
  let mockUserErrorHandler: Mock;
  let errorHandler: ErrorHandler;

  beforeEach(() => {
    mockStoreManager = {
      saveErrorRecord: vi.fn(),
    };
    mockUserErrorHandler = vi.fn();

    errorHandler = new ErrorHandler(mockUserErrorHandler as any, mockStoreManager as StoreManager);
  });

  it('should call storeManager.saveErrorRecord and userErrorHandler', async () => {
    const error = new Error('Test error');
    const context: PlainObject = { some: 'context' };
    const type: ErrorType = 'store';

    await errorHandler.handle(error, context, type);

    expect(mockStoreManager.saveErrorRecord).toHaveBeenCalledWith(error, context, type);
    expect(mockUserErrorHandler).toHaveBeenCalledWith(error, context, type);
  });

  it('should log if storeManager.saveErrorRecord throws', async () => {
    const error = new Error('Test error');
    const context: PlainObject = {};
    const type: ErrorType = 'store';

    (mockStoreManager.saveErrorRecord as any).mockRejectedValue(new Error('DB failed'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await errorHandler.handle(error, context, type);

    expect(consoleSpy).toHaveBeenCalledWith('[EventBus error] Failed to persist error record', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('should log if userErrorHandler throws', async () => {
    const error = new Error('Test error');
    const context: PlainObject = {};
    const type: ErrorType = 'store';

    mockUserErrorHandler.mockImplementation(() => {
      throw new Error('User handler failed');
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await errorHandler.handle(error, context, type);

    expect(consoleSpy).toHaveBeenCalledWith('[EventBus error] User error handler failed', expect.any(Error));

    consoleSpy.mockRestore();
  });
});
