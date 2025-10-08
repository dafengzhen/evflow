import type { EventMap } from '../src/types/types.ts';

import { EventBusImpl } from '../src/core/event-bus.ts';

interface MyEventMap extends EventMap {
  numberEvent: { value: number };
  testEvent: { data: string };
}

const bus = new EventBusImpl<MyEventMap>();

bus.on('testEvent', async (ctx) => {
  console.log('handler1:', ctx.data.data);
  return 'result1';
});

bus.on(
  'testEvent',
  async (ctx) => {
    console.log('handler2 (once):', ctx.data.data);
    return 'result2';
  },
  { once: true },
);

bus.use('testEvent', async (ctx, next) => {
  console.log('middleware before');
  const result = await next();
  console.log('middleware after');
  return result;
});

bus.useGlobalMiddleware(async (ctx, next) => {
  console.log('global middleware before');
  const result = await next();
  console.log('global middleware after');
  return result;
});

const results = await bus.emit(
  'testEvent',
  { data: { data: 'hello world' } },
  { maxRetries: 2 },
  {
    globalTimeout: 3000,
    maxConcurrency: 2,
    parallel: true,
    stopOnError: false,
    traceId: 'trace-123',
  },
);

console.log('emit results:', results);

const results2 = await bus.emit('testEvent', { data: { data: 'second call' } });
console.log('emit results 2:', results2);
