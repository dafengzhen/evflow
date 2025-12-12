import { createEventEmitter } from '../src/index.ts';

type Events = {
  'order.created': { payload: { orderId: string } };
  'user.created': { payload: { id: string } };
  'user.deleted': { payload: { id: string } };
};

const bus = createEventEmitter<
  Events,
  {
    middleware: true;
    wildcard: true;
  }
>({
  middleware: true,
  wildcard: true
});

bus.on('user.created', async (payload) => {
  console.log(payload);
});

bus.match('user.*', async (payload) => {
  console.log('any user event', payload);
});

bus.use(async (ctx, next) => {
  const start = Date.now();
  console.log('[event]', ctx.eventName, ctx.payload);
  try {
    await next();
    console.log('[event-ok]', ctx.eventName, Date.now() - start, 'ms');
  } catch (e) {
    console.error('[event-error]', ctx.eventName, e);
    throw e;
  }
});

await bus.emit('user.created', { id: '123' });
