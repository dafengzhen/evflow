type Events = {
  'order.created': { payload: { orderId: string } };
  'user.created': { payload: { id: string } };
  'user.deleted': { payload: { id: string } };
};

const bus = new EventBus<Events>();

bus.on('user.created', async (payload) => {
  // payload: { id: string }
});

(bus as MatchSupport<Events>).match('user.*', async (payload) => {
  console.log('any user event', payload);
});

(bus as MiddlewareSupport<Events>).use(async (ctx, next) => {
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
