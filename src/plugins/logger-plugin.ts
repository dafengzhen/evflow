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
      const start = performance.now();

      this.log('log', `[EventBus] ▶ ${eventName} started`, {
        data: context.data,
        time: new Date().toISOString(),
      });

      try {
        const result = await next();
        this.logEventDone('✔', eventName, start);
        return result;
      } catch (error) {
        this.logEventFail('✖', eventName, start, error);
        throw error;
      }
    });
    this.cleanupFns.add(removeGlobalMiddleware);

    const removeMatchHandler = bus.match('*', (context) => {
      const eventName = context.meta?.eventName ?? 'unknown';
      this.log('debug', `[EventBus] 🔔 ${eventName} emitted`, {
        data: context.data,
        global: context.global,
        meta: context.meta,
        time: new Date().toISOString(),
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
      } catch (error) {
        this.log('warn', '[EventBus] LoggerPlugin cleanup error', error);
      }
    }
    this.cleanupFns.clear();
  }

  private log(level: keyof Console, message: string, data?: any): void {
    const fn: any = this.logger[level] ?? this.logger.log;
    try {
      if (data) {
        fn.call(this.logger, message, data);
      } else {
        fn.call(this.logger, message);
      }
    } catch {
      console.log(`[LoggerPlugin:${level}] ${message}`, data);
    }
  }

  private logEventDone(icon: string, eventName: string, start: number): void {
    const duration = (performance.now() - start).toFixed(2);
    this.log('log', `[EventBus] ${icon} ${eventName} completed`, {
      duration: `${duration}ms`,
      time: new Date().toISOString(),
    });
  }

  private logEventFail(icon: string, eventName: string, start: number, error: unknown): void {
    const duration = (performance.now() - start).toFixed(2);
    const err = error instanceof Error ? { message: error.message, stack: error.stack } : error;
    this.log('error', `[EventBus] ${icon} ${eventName} failed`, {
      duration: `${duration}ms`,
      error: err,
      time: new Date().toISOString(),
    });
  }
}
