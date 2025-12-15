import type { Types } from '../src/index.ts';

import { EventEmitter } from '../src/index.ts';

interface MyEvents extends Types.BaseEventDefinitions {
  orderPlaced: { payload: { amount: number; id: string } };
  userCreated: { payload: { id: string; name: string } };
}

const emitter = new EventEmitter<MyEvents>();

emitter.use(async (ctx, next) => {
  console.log(`[event] ${ctx.eventName} start`, ctx.payload);
  const start = Date.now();

  try {
    await next();
    console.log(`[event] ${ctx.eventName} done in ${Date.now() - start}ms`);
  } catch (err) {
    console.error(`[event] ${ctx.eventName} error`, err);
    throw err;
  }
});

const disposeTrim = emitter.use(async (ctx, next) => {
  if (ctx.eventName === 'userCreated' && ctx.payload) {
    ctx.payload = {
      ...ctx.payload,
      name: (ctx.payload as any).name.trim()
    };
  }
  await next();
});

disposeTrim();

emitter.on('userCreated', async (payload) => {
  console.log('save user to db:', payload);
});

emitter.on('userCreated', async (payload) => {
  console.log('send welcome email:', payload.id);
});

await emitter.emit('userCreated', {
  id: 'u_1',
  name: '  Alice  '
});
