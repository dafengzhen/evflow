import type { EventMap } from '../src/types.js';

import { EventBus } from '../src/index.js';

interface MyEvents extends EventMap {
  'user.created': { userId: string };
  'user.deleted': { userId: string };
}

const bus = new EventBus<MyEvents>();

bus.on('user.created', (ctx) => {
  console.log('traceId', ctx.traceId, 'created user', ctx.meta?.userId);
  return { ok: true };
});

const results = await bus.emit('user.created', { meta: { userId: '42' } });
console.log(results);
