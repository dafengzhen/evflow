import type { EventMap } from '../src/types/types.ts';

import { EventBusFactory as factory } from '../src/core/event-bus-factory.ts';
import { LoggerPlugin } from '../src/index.ts';

interface MyEvents extends EventMap {
	'user:login': { username: string };
	'user:logout': { userId: number };
}

const bus = factory.create<MyEvents>({
	plugins: [new LoggerPlugin()],
});

bus.on('user:login', async (ctx) => {
	console.log('handling login', ctx.data.username);
	await new Promise((r) => setTimeout(r, 120));
	if (ctx.data.username === 'error') {
		throw new Error('bad user');
	}
	return { ok: true };
});

await bus.emit('user:login', {
	data: { username: 'alice' },
	meta: { eventName: 'user:login' },
});
await bus
	.emit('user:login', {
		data: { username: 'error' },
		meta: { eventName: 'user:login' },
	})
	.catch(() => {});
