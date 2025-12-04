import type {
	BaseEventDefinitions,
	EventListener,
	EventMiddleware,
	EventName,
	EventPlugin,
	IEventEmitterWithMiddleware,
	IWildcardEventEmitter,
	LoadedPlugin,
	OnceOptions,
	OnOptions,
	PluginContext,
	PluginMeta,
	WildcardEventListener,
} from './types.ts';

/**
 * PluginManager.
 *
 * @author dafengzhen
 */
export class PluginManager<T extends BaseEventDefinitions> {
	private readonly emitter: IEventEmitterWithMiddleware<T> &
		IWildcardEventEmitter<T>;

	private readonly plugins = new Map<string, LoadedPlugin>();

	constructor(
		emitter: IEventEmitterWithMiddleware<T> & IWildcardEventEmitter<T>,
	) {
		this.emitter = emitter;
	}

	use(meta: PluginMeta, plugin: EventPlugin<T>): () => void {
		if (this.plugins.has(meta.name)) {
			throw new Error(`Plugin "${meta.name}" already loaded.`);
		}

		const cleanups = new Set<() => void>();

		const registerCleanup = (fn: () => void) => {
			cleanups.add(fn);
		};

		const ctx: PluginContext<T> = {
			emitter: this.emitter,
			meta,

			on: <K extends EventName<T>>(
				eventName: K,
				listener: EventListener<T, K>,
				options?: OnOptions,
			) => {
				const off = this.emitter.on(eventName, listener, options);
				registerCleanup(off);
				return off;
			},

			once: <K extends EventName<T>>(
				eventName: K,
				listener: EventListener<T, K>,
				options?: OnceOptions,
			) => {
				const off = this.emitter.once(eventName, listener, options);
				registerCleanup(off);
				return off;
			},

			oncePattern: (
				pattern: string,
				listener: WildcardEventListener<T>,
				options?: OnceOptions,
			) => {
				const off = this.emitter.oncePattern(pattern, listener, options);
				registerCleanup(off);
				return off;
			},

			onPattern: (
				pattern: string,
				listener: WildcardEventListener<T>,
				options?: OnOptions,
			) => {
				const off = this.emitter.onPattern(pattern, listener, options);
				registerCleanup(off);
				return off;
			},

			registerCleanup,

			use: (middleware: EventMiddleware<T>) => {
				const off = this.emitter.use(middleware);
				registerCleanup(off);
				return off;
			},
		};

		plugin(ctx);

		const dispose = () => {
			for (const fn of cleanups) {
				try {
					fn();
				} catch {}
			}

			this.plugins.delete(meta.name);
		};

		this.plugins.set(meta.name, { dispose, meta });

		return dispose;
	}

	unload(name: string): void {
		const loaded = this.plugins.get(name);

		if (!loaded) {
			return;
		}

		loaded.dispose();
	}

	unloadAll(): void {
		for (const [name, loaded] of this.plugins) {
			loaded.dispose();
			this.plugins.delete(name);
		}
	}

	has(name: string): boolean {
		return this.plugins.has(name);
	}

	list(): PluginMeta[] {
		return [...this.plugins.values()].map((p) => p.meta);
	}
}
