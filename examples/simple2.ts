import type { BaseEventDefinitions } from '../src/core/types.ts';
import { createEventEmitter } from '../src/index.ts';

interface MicroEvents extends BaseEventDefinitions {
	'order:paid': { payload: { orderId: string } };
	'order:shipped': { payload: { orderId: string; expressId: string } };
}

const emitter = createEventEmitter<MicroEvents>();

// Order payment → Trigger shipment
emitter.on('order:paid', async ({ orderId }) => {
	console.log(`[Order] Paid ${orderId}`);
	await emitter.emit('order:shipped', {
		expressId: 'SF123456',
		orderId,
	});
});

// Shipment event → Write log
emitter.on('order:shipped', async ({ orderId, expressId }) => {
	console.log(
		`[Shipment] Order ${orderId} has been shipped (Tracking number: ${expressId})`,
	);
});

await emitter.emit('order:paid', { orderId: 'o008' });
