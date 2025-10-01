import { InMemoryEventStore } from '../src/in-memory-event-store.js';
import { EventBus } from '../src/index.js';

const store = new InMemoryEventStore();
const bus = new EventBus<any>(store);

// Register a handler that will definitely fail
bus.on('order.created', async (ctx) => {
  console.log(`[handler] processing order:`, ctx.meta?.orderId);
  throw new Error('Simulated processing failure'); // Force throw error to trigger retry
});

// Emit event (set retries=3)
await bus.emit(
  'order.created',
  { meta: { orderId: 123 }, traceId: 'trace_xxx' },
  { retries: 3 }, // Maximum 3 retries, enter DLQ after failure
);

// Wait for asynchronous tasks to complete
await new Promise((resolve) => setTimeout(resolve, 2000));

// Check dead letter queue
const dlqItems = await bus.listDLQ('trace_xxx');
console.log('[DLQ]', dlqItems);

// Manual requeue
// await bus.requeueDLQ('trace_xxx', dlqItems[0].id);

// Manual purge of a specific DLQ item
// await bus.purgeDLQ('trace_xxx', dlqItems[0].id);
