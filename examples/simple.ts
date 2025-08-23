import { Dispatcher } from '../src/core/dispatcher.ts';

const hub = new Dispatcher();

// Register dependencies
hub.add('payment_processed');
hub.add('inventory_check');

// Register main event (dependencies already exist)
hub.add('order_created', ['payment_processed', 'inventory_check']);

// Register handlers for all dependencies
hub.handle('payment_processed', async () => {
  console.log('Processing payment...');
  return { success: true };
});

hub.handle('inventory_check', async () => {
  console.log('Checking inventory...');
  return { stock: 100 };
});

hub.handle('order_created', async (_, paymentResult, inventoryResult) => {
  console.log('Order created!', paymentResult, inventoryResult);
});

// Dispatch event
await hub.run('order_created');
await hub.run('order_created');
