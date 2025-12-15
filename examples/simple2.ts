import { EventEmitter } from '../src/index.ts';

type Events = {
  'order.created': { payload: { orderId: string } };
  'user.created': { payload: { id: string } };
  'user.deleted': { payload: { id: string } };
};

const emitter = new EventEmitter<Events>();

emitter.on('user.created', async (payload) => {
  console.log(payload);
});

emitter.match('user.*', async (payload) => {
  console.log('any user event', payload);
});

emitter.use(async (ctx, next) => {
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

await emitter.emit('user.created', { id: '123' });
