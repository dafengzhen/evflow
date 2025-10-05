import type { StoreManager } from '../manager/index.ts';
import type { ErrorType, EventContext, EventMap } from '../types.ts';

/**
 * ErrorHandler.
 *
 * @author dafengzhen
 */
export class ErrorHandler<EM extends EventMap> {
  constructor(
    private readonly userErrorHandler: <K extends keyof EM>(
      error: Error,
      context: EventContext<EM[K]>,
      type: ErrorType,
    ) => void,
    private readonly storeManager: StoreManager<EM>,
  ) {}

  async handle<K extends keyof EM>(error: Error, context: EventContext<EM[K]>, type: ErrorType): Promise<void> {
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
