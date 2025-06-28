import { Dispatcher } from '../src/core/dispatcher';

const hub = new Dispatcher();

hub.add('payment_processed');
hub.add('order_created', ['payment_processed']);

hub.handle('payment_processed', async (event) => {
  console.log('Processing payment for:', event.context.payload.userId);
  return { success: true };
});

hub.handle('order_created', async (event, paymentResult) => {
  console.log('Order created for:', event.context.payload.userId);
  console.log(paymentResult);
});

await hub.run('payment_processed', {
  payload: { amount: 100, userId: 'user123' },
});

await hub.runAll(['payment_processed', 'order_created'], 'upstream', {
  payloadMap: {
    order_created: { items: ['item1', 'item2'], userId: 'user456' },
    payment_processed: { amount: 200, userId: 'user456' },
  },
});
