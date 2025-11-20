import type {
	BaseEventDefinitions,
	EventMiddleware,
	EventPlugin,
	PlainObject,
	PluginContext,
} from '../src/core/event.d.ts';
import { createEventEmitter, PluginManager } from '../src/index.ts';

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

const LoggingPlugin: EventPlugin<AppEvents> = (
	ctx: PluginContext<AppEvents>,
) => {
	const middleware: EventMiddleware<AppEvents> = async (emitCtx, next) => {
		const { eventName, payload, context, options } = emitCtx;

		console.log(
			`[${ctx.meta.name}] before emit:`,
			eventName,
			JSON.stringify(payload),
			context,
			options?.__eventName__,
		);

		const start = Date.now();
		try {
			await next();
			const cost = Date.now() - start;
			console.log(
				`[${ctx.meta.name}] after emit:`,
				eventName,
				`cost=${cost}ms`,
			);
		} catch (error) {
			const cost = Date.now() - start;
			console.error(
				`[${ctx.meta.name}] error in emit:`,
				eventName,
				`cost=${cost}ms`,
				error,
			);
			throw error;
		}
	};

	ctx.use(middleware);
};

const MetricsPlugin: EventPlugin<AppEvents> = (ctx) => {
	const counters = new Map<string, number>();

	// Capture all events: pattern = "#"
	ctx.onPattern(
		'#',
		async (_payload, _context, options) => {
			const name = options?.__eventName__ ?? 'unknown';
			const prev = counters.get(name) ?? 0;
			counters.set(name, prev + 1);
		},
		{ priority: -1 },
	);

	// Of course, you can also periodically report, expose getSnapshot, etc. Here is a simple example.
	ctx.registerCleanup(() => {
		console.log(`[${ctx.meta.name}] counters snapshot:`, counters);
	});
};

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

	const _disposeMetrics = pluginManager.use(
		{ name: 'metrics', version: '1.0.0' },
		MetricsPlugin,
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
