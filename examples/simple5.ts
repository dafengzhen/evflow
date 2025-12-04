import type { BaseEventDefinitions } from '../src/core/types.ts';
import { createEventEmitter } from '../src/index.ts';

// Event definitions
interface AppEvents extends BaseEventDefinitions {
	'user:login': { payload: { userId: string; username: string } };
	'user:logout': { payload: { userId: string } };
	'order:create': { payload: { orderId: string; amount: number } };
	'order:cancel': { payload: { orderId: string; reason: string } };
}

const emitter = createEventEmitter<AppEvents>();

// 1. Performance monitoring middleware
emitter.use(async (ctx, next) => {
	const start = Date.now();
	await next();
	const cost = Date.now() - start;
	console.log(`⏱️ ${ctx.eventName} took: ${cost}ms`);
});

// 2. Error handling middleware
emitter.use(async (ctx, next) => {
	try {
		await next();
	} catch (error) {
		console.error(`❌ Event handling failed: ${ctx.eventName}`, error);
		throw error;
	}
});

// 3. Register event listeners
emitter.on('user:login', async (user) => {
	console.log(`👤 User logged in: ${user.username} (ID: ${user.userId})`);

	// Simulate some business operations
	await updateLastLoginTime(user.userId);
	await sendWelcomeNotification(user.userId);
});

emitter.on('user:logout', async (user) => {
	console.log(`🚪 User logged out: ${user.userId}`);
	await updateUserStatus(user.userId, 'offline');
});

// One event can have multiple listeners
emitter.on('order:create', async (order) => {
	console.log(`🛒 Order created: ${order.orderId}`);
});

emitter.on('order:create', async (order) => {
	console.log(`💰 Order amount: ¥${order.amount}`);
	await validateOrderAmount(order.amount);
});

emitter.on('order:cancel', async (order) => {
	console.log(`❌ Order canceled: ${order.orderId}, reason: ${order.reason}`);
	await refundOrder(order.orderId);
});

// 4. One-time listener (executes only once)
emitter.once('user:login', async (user) => {
	console.log(`🎉 Welcome new user for first login: ${user.username}`);
});

// 5. Async business functions
async function updateLastLoginTime(userId: string) {
	await delay(50);
	console.log(`📊 Updated last login time: ${userId}`);
}

async function sendWelcomeNotification(userId: string) {
	await delay(100);
	console.log(`📢 Sent welcome notification: ${userId}`);
}

async function updateUserStatus(userId: string, status: string) {
	await delay(30);
	console.log(`🔄 Updated user status: ${userId} -> ${status}`);
}

async function validateOrderAmount(amount: number) {
	if (amount <= 0) {
		throw new Error('Order amount must be greater than 0');
	}
	await delay(20);
}

async function refundOrder(orderId: string) {
	await delay(150);
	console.log(`💸 Refund processed: ${orderId}`);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// 6. Demo function
async function demo() {
	console.log('=== Starting Demo ===\n');

	// User login
	await emitter.emit('user:login', {
		userId: 'user_001',
		username: 'Zhang San',
	});

	console.log('\n---\n');

	// Login again (testing one-time listener)
	await emitter.emit('user:login', {
		userId: 'user_001',
		username: 'Zhang San',
	});

	console.log('\n---\n');

	// Create order
	await emitter.emit('order:create', {
		amount: 199.99,
		orderId: 'order_001',
	});

	console.log('\n---\n');

	// Cancel order
	await emitter.emit('order:cancel', {
		orderId: 'order_001',
		reason: 'User initiated cancellation',
	});

	console.log('\n---\n');

	// User logout
	await emitter.emit('user:logout', {
		userId: 'user_001',
	});

	console.log('\n=== Demo Finished ===');
}

// Run the demo
demo().catch(console.error);
