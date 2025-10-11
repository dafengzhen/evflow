import type { EventBusPlugin, EventMap, IEventBus, PlainObject } from '../types/types.ts';

/**
 * LoggerPlugin.
 *
 * @author dafengzhen
 */
export class LoggerPlugin<EM extends EventMap, GC extends PlainObject> implements EventBusPlugin<EM, GC> {
  private readonly cleanupFns = new Set<() => void>();

  private readonly logger: Console;

  constructor(logger: Console = console) {
    this.logger = logger;
  }

  async install(bus: IEventBus<EM, GC>): Promise<void> {
    this.cleanup();

    const removeGlobalMiddleware = bus.useGlobalMiddleware(async (context, next) => {
      const eventName = context.meta?.eventName ?? 'unknown';
      const startTime = performance.now();

      this.log('log', `[EventBus] ▶ Event started: ${eventName}`, {
        data: context.data,
        timestamp: new Date().toISOString(),
      });

      try {
        const result = await next();
        const duration = (performance.now() - startTime).toFixed(2);

        this.log('log', `[EventBus] ✔ Event completed: ${eventName}`, {
          duration: `${duration}ms`,
          timestamp: new Date().toISOString(),
        });

        return result;
      } catch (error) {
        const duration = (performance.now() - startTime).toFixed(2);

        this.log('error', `[EventBus] ✖ Event failed: ${eventName}`, {
          duration: `${duration}ms`,
          error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
          timestamp: new Date().toISOString(),
        });

        throw error;
      }
    });
    this.cleanupFns.add(removeGlobalMiddleware);

    const removeMatchHandler = bus.match('*', (context) => {
      const eventName = context.meta?.eventName ?? 'unknown';
      this.log('debug', `[EventBus] 🔔 Event emitted: ${eventName}`, {
        data: context.data,
        globalContext: context.global,
        meta: context.meta,
        timestamp: new Date().toISOString(),
      });
    });
    this.cleanupFns.add(removeMatchHandler);

    this.log('info', '[EventBus] LoggerPlugin installed');
  }

  async uninstall(): Promise<void> {
    this.cleanup();
    this.log('info', '[EventBus] LoggerPlugin uninstalled');
  }

  private cleanup(): void {
    for (const fn of this.cleanupFns) {
      try {
        fn();
      } catch (err) {
        this.log('warn', '[EventBus] LoggerPlugin cleanup error', err);
      }
    }
    this.cleanupFns.clear();
  }

  private log(level: keyof Console, message: string, data?: any): void {
    const loggerFn: any = this.logger[level] ?? this.logger.log;
    try {
      if (data) {
        loggerFn.call(this.logger, message, data);
      } else {
        loggerFn.call(this.logger, message);
      }
    } catch {
      console.log(`[LoggerPlugin: ${level}] ${message}`, data);
    }
  }
}
