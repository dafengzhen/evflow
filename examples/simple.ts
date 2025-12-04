import type { BaseEventDefinitions } from '../src/core/types.ts';
import { createEventEmitter } from '../src/index.ts';

interface AppEvents extends BaseEventDefinitions {
	'user:registered': {
		payload: {
			userId: string;
			email: string;
		};
	};
}

const emitter = createEventEmitter<AppEvents>();

// High priority: Send welcome email
emitter.on(
	'user:registered',
	async ({ email }) => {
		console.log(`[Email] Sending welcome email to ${email}`);
		// Simulate success
	},
	{ priority: 10 },
);

// Low priority: Create default user configuration
emitter.on(
	'user:registered',
	async ({ userId }) => {
		console.log(`[Config] Creating initial configuration for ${userId}`);
	},
	{ priority: 0 },
);

await emitter.emit(
	'user:registered',
	{ email: 'test@example.com', userId: 'u_001' },
	undefined,
	{
		isRetryable: () => true,
		maxRetries: 2,
	},
);
