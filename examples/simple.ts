import { EventTaskImpl } from '../src/core/event-task.ts';

const task = new EventTaskImpl(
  { data: { x: 1 } },
  async (ctx) => {
    console.log('executing', ctx.data);
    if (Math.random() < 0.7) {
      throw new Error('random fail');
    }
    return 'OK';
  },
  {
    maxRetries: 3,
    onRetry: (a, e) => console.log(`Retry #${a}`, e.message),
    onStateChange: (s) => console.log('State:', s),
    retryDelay: (n) => n * 500,
    timeout: 2000,
  },
);

task.execute().then(console.log);
