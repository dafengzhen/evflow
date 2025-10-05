import type { DLQManager, HandlerManager } from '../manager/index.ts';
import type {
  EmitOptions,
  EventContext,
  EventHandler,
  EventMap,
  EventTaskOptions,
  HandlerResult,
  PlainObject,
} from '../types.ts';
import type { ErrorHandler } from './error-handler.ts';

import { EventState } from '../enums.ts';
import { genId, now } from '../utils.ts';
import { EventTask } from './event-task.ts';

export class HandlerExecutor<EM extends EventMap> {
  constructor(
    private readonly handlerManager: HandlerManager<EM>,
    private readonly dlqManager: DLQManager<EM>,
    private readonly errorHandler: ErrorHandler<EM>,
  ) {}

  async executeHandlers<K extends keyof EM, R>(
    handlers: EventHandler<EM, K, R>[],
    context: EventContext<EM[K]>,
    taskOptions?: EventTaskOptions,
    emitOptions?: Required<EmitOptions>,
  ): Promise<HandlerResult<R>[]> {
    const tasks = handlers.map((h, i) => ({
      index: i,
      task: new EventTask<EM, K, R>((ctx) => this.runWithMiddlewares(ctx as EventContext<any>, h), {
        ...taskOptions,
        id: `${context.name}_${i}_${genId('task')}`,
      }),
    }));

    const runTask = async (t: (typeof tasks)[number]): Promise<HandlerResult<R>> => {
      try {
        const result = await t.task.run({ ...context, parentId: context.id });
        return { handlerIndex: t.index, result, state: t.task.state, traceId: context.traceId! };
      } catch (err) {
        await this.handleDLQOnError(err, t.task, context, t.index);
        return { error: err as Error, handlerIndex: t.index, state: t.task.state, traceId: context.traceId! };
      }
    };

    if (emitOptions?.parallel) {
      const limit = emitOptions.maxConcurrency ?? handlers.length;
      return limit >= handlers.length
        ? (await Promise.all(tasks.map(runTask))).sort((a, b) => a.handlerIndex - b.handlerIndex)
        : this.limitConcurrency(tasks, limit, runTask);
    }

    const results: HandlerResult<R>[] = [];
    for (const t of tasks) {
      const r = await runTask(t);
      results.push(r);
      if (r.error && emitOptions?.stopOnError) {
        break;
      }
    }
    return results;
  }

  private async handleDLQOnError<K extends keyof EM>(
    err: unknown,
    task: EventTask<any, any>,
    context: EventContext<EM[K]>,
    idx: number,
  ) {
    try {
      const retries = typeof task.opts?.retries === 'number' ? task.opts.retries : 0;
      const exhausted = task.attempts > retries;
      const retryable = task.opts?.isRetryable ? task.opts.isRetryable(err) : true;

      if ((!retryable || exhausted) && !context.disableAutoDLQ) {
        const errorObj = err instanceof Error ? err : new Error(String(err));
        await this.dlqManager.moveToDLQ({
          context: context as PlainObject,
          error: errorObj,
          errorStack: errorObj.stack,
          id: `dlq_${context.name}_${idx}_${now()}`,
          name: String(context.name),
          result: null,
          state: EventState.DeadLetter,
          timestamp: now(),
          traceId: context.traceId!,
          version: context.version,
        });
      }
    } catch (dlqErr) {
      await this.errorHandler.handle(dlqErr instanceof Error ? dlqErr : new Error(String(dlqErr)), context, 'store');
    }
  }

  private async limitConcurrency<T extends { index: number }, R>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let i = 0;

    const worker = async () => {
      while (true) {
        const idx = i++;
        if (idx >= items.length) {
          return;
        }
        try {
          results[idx] = await fn(items[idx]);
        } catch (e) {
          results[idx] = e as unknown as R;
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return results;
  }

  private async runWithMiddlewares<K extends keyof EM, R>(
    context: EventContext<EM[K]>,
    handler: EventHandler<EM, K, R>,
  ): Promise<R> {
    const middlewares = this.handlerManager.getMiddlewares(context.name as K) ?? [];
    let index = -1;

    const dispatch = async (): Promise<R> => {
      index++;
      if (index < middlewares.length) {
        return middlewares[index](context, dispatch);
      }
      return handler(context);
    };

    return dispatch();
  }
}
