import type { BaseEventDefinitions } from '../src/core/types.ts';
import { createEventEmitter } from '../src/index.ts';

interface Events extends BaseEventDefinitions {
	'user.created': { payload: { id: string; name: string } };
	'user.deleted': { payload: { id: string } };
	'order.created': { payload: { id: string; amount: number } };
	'order.updated': { payload: { id: string; status: string } };
	'order.payment.completed': { payload: { id: string; paymentId: string } };
}

const emitter = createEventEmitter<Events>();

// Precise subscription
emitter.on('user.created', async (p) => {
	console.log('user created', p.id, p.name);
});

emitter.on('user.deleted', async (p) => {
	console.log('user deleted', p.id);
});

emitter.on('order.created', async (p) => {
	console.log('order created', p.id, p.amount);
});

// Wildcard: All user.* events
emitter.onPattern('user.*', async (p, _ctx, opts) => {
	console.log('user event:', opts?.__eventName__, p);
});

// Wildcard: All order.# events
emitter.onPattern('order.#', async (p, _ctx, opts) => {
	console.log('order related:', opts?.__eventName__, p);
});

// Wildcard: All events
emitter.onPattern('#', async (p, _ctx, opts) => {
	console.log('all events:', opts?.__eventName__, p);
});

// Use emit to publish events
async function main() {
	// Publish user-related events
	await emitter.emit('user.created', {
		id: 'user-123',
		name: 'John Doe',
	});

	await emitter.emit('user.deleted', {
		id: 'user-456',
	});

	// Publish order-related events
	await emitter.emit('order.created', {
		amount: 99.99,
		id: 'order-789',
	});

	await emitter.emit('order.updated', {
		id: 'order-789',
		status: 'shipped',
	});

	await emitter.emit('order.payment.completed', {
		id: 'order-789',
		paymentId: 'pay-123',
	});
}

// Run the example
main().catch(console.error);

// user.* matches: user.created, user.deleted
// order.# matches: order.created, order.updated, order.payment.completed
// # matches all events
