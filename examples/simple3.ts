import type { BaseEventDefinitions } from '../src/core/types.ts';
import { createEventEmitter } from '../src/index.ts';

interface TaskEvents extends BaseEventDefinitions {
	'task:run': {
		payload: { taskId: string };
		context?: { signal: AbortSignal };
	};
}

const emitter = createEventEmitter<TaskEvents>();

emitter.on('task:run', async (payload, ctx) => {
	console.log(`[Task] Starting execution ${payload.taskId}`);

	await new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => resolve(), 3000);

		ctx?.signal?.addEventListener('abort', () => {
			clearTimeout(timer);
			console.log(`[Task] ${payload.taskId} has been canceled`);
			reject(new Error('Task canceled'));
		});
	});

	console.log(`[Task] Completed ${payload.taskId}`);
});

await emitter.emit(
	'task:run',
	{ taskId: 't001' },
	{ signal: undefined },
	{
		onTimeout: (t) => console.log(`Task timed out (${t}ms)`),
		timeout: 1000, // 1 second timeout
	},
);
