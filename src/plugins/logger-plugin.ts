import type { EventBus, EventBusPlugin, EventMap, PlainObject } from '../types/types.ts';

/**
 * LoggerPlugin.
 *
 * @author dafengzhen
 */
export class LoggerPlugin<EM extends EventMap, GC extends PlainObject> implements EventBusPlugin<EM, GC> {
  private logger: Console;

  constructor(logger: Console = console) {
    this.logger = logger;
  }

  async install(bus: EventBus<EM, GC>): Promise<void> {
    bus.useGlobalMiddleware(async (context, next) => {
      const eventName = context.meta?.eventName ?? 'unknown';
      const startTime = Date.now();

      this.logger.log(`[EventBus] Event started: ${eventName}`, {
        data: context.data,
        timestamp: new Date().toISOString(),
      });

      try {
        const result = await next();
        const duration = Date.now() - startTime;

        this.logger.log(`[EventBus] Event completed: ${eventName}`, {
          duration: `${duration}ms`,
          result,
          timestamp: new Date().toISOString(),
        });

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;

        this.logger.error(`[EventBus] Event failed: ${eventName}`, {
          duration: `${duration}ms`,
          error,
          timestamp: new Date().toISOString(),
        });

        throw error;
      }
    });

    bus.match('*', (context) => {
      const eventName = context.meta?.eventName ?? 'unknown';
      this.logger.debug(`[EventBus] Event emitted: ${eventName}`, {
        data: context.data,
        globalContext: context.global,
        meta: context.meta,
        timestamp: new Date().toISOString(),
      });
    });
  }

  async uninstall(bus: EventBus<EM, GC>): Promise<void> {
    this.logger.log('[EventBus] LoggingPlugin uninstalled');
  }
}
