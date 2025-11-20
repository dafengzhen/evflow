import type { BaseEventDefinitions, PlainObject } from '../src/core/types.ts';
import {
	createEventEmitter,
	createLoggingPlugin,
	PluginManager,
} from '../src/index.ts';

interface AppEvents extends BaseEventDefinitions {
	'user.created': {
		payload: {
			id: string;
			name: string;
		};
		context?: PlainObject;
	};

	'order.created': {
		payload: {
			id: string;
			amount: number;
		};
		context?: {
			requestId?: string;
		};
	};

	// ... more events
}

const LoggingPlugin = createLoggingPlugin<AppEvents>({
	logContext: false,
	logOptions: false,
	filterEvent: (name) => !name.startsWith('internal:'),
});

async function bootstrap() {
	// 1. Create emitter
	const emitter = createEventEmitter<AppEvents>();

	// 2. Create plugin manager
	const pluginManager = new PluginManager<AppEvents>(emitter);

	// 3. Register plugins
	const disposeLogger = pluginManager.use(
		{ name: 'logger', version: '1.0.0' },
		LoggingPlugin,
	);

	// 4. Use emitter normally
	emitter.on('user.created', async (payload, ctx) => {
		console.log('user.created listener payload=', payload, 'ctx=', ctx);
	});

	await emitter.emit('user.created', { id: 'u1', name: 'Alice' });

	// 5. Unload a specific plugin
	disposeLogger();
	// Or
	// pluginManager.unload('logger');

	await emitter.emit('user.created', { id: 'u2', name: 'Bob' });

	// 6. Unload all plugins
	pluginManager.unloadAll();
}

await bootstrap();
