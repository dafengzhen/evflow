import type { EventMap } from '../src/types.js';

import { InMemoryEventStore } from '../src/in-memory-event-store.js';
import { EventBus } from '../src/index.js';

interface MyEvents extends EventMap {
  orderPlaced: { amount: number; orderId: string };
  userCreated: { name: string; userId: string };
}

const store = new InMemoryEventStore();
const bus = new EventBus<MyEvents>(store);

bus.on('userCreated', async (ctx) => {
  console.log('Processing userCreated:', ctx.meta);
  return { status: 'ok' };
});

await bus.emit('userCreated', { meta: { name: 'Alice', userId: 'u1' } });

const records = await store.loadByName('userCreated');
console.log('Audit log:', records);
