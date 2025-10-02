import type { EventMiddleware } from '../src/types.ts';

import { EventBus } from '../src/index.ts';

const authMiddleware: EventMiddleware<{ userRole: string }> = async (ctx, next) => {
  if (ctx.meta?.userRole !== 'admin') {
    throw new Error('Permission denied');
  }
  return next();
};

const transformMiddleware: EventMiddleware<{ payload: any }> = async (ctx, next) => {
  if (ctx.meta?.payload) {
    ctx.meta.payload = { ...ctx.meta.payload, transformed: true };
  }
  return next();
};

const loggerMiddleware: EventMiddleware = async (ctx, next) => {
  console.log(`[Event Start] ${ctx.name} - ${ctx.traceId}`);
  const result = await next();
  console.log(`[Event End] ${ctx.name} - ${ctx.traceId}`);
  return result;
};

const perfMiddleware: EventMiddleware = async (ctx, next) => {
  const start = Date.now();
  const result = await next();
  const duration = Date.now() - start;
  console.log(`[Perf] ${ctx.name} took ${duration}ms`);
  return result;
};

const bus = new EventBus<{ testEvent: { payload: any; userRole: string } }>();

bus.use('testEvent', authMiddleware);
bus.use('testEvent', transformMiddleware);
bus.use('testEvent', loggerMiddleware);
bus.use('testEvent', perfMiddleware);

bus.on('testEvent', async (ctx) => {
  console.log('Handler payload:', ctx.meta?.payload);
  return 'done';
});

await bus.emit('testEvent', { meta: { payload: { foo: 123 }, userRole: 'admin' } });
