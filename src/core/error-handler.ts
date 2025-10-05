import type { StoreManager } from '../manager/index.ts';
import type { ErrorType, PlainObject } from '../types.ts';

/**
 * ErrorHandler.
 *
 * @author dafengzhen
 */
export class ErrorHandler {
  constructor(
    private readonly userErrorHandler: (error: Error, context: PlainObject, type: ErrorType) => void,
    private readonly storeManager: StoreManager,
  ) {}

  async handle(error: Error, context: PlainObject, type: ErrorType): Promise<void> {
    this.logError(`type: ${type}`, error);

    try {
      await this.storeManager.saveErrorRecord(error, context, type);
    } catch (storeErr) {
      this.logError('Failed to persist error record', storeErr);
    }

    try {
      this.userErrorHandler(error, context, type);
    } catch (userErr) {
      this.logError('User error handler failed', userErr);
    }
  }

  private logError(message: string, error: unknown) {
    console.error(`[EventBus error] ${message}`, error);
  }
}
