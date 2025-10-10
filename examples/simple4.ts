import { EventBus } from '../src/index.ts';
import { PerfMonitorPlugin } from '../src/plugins/perf-monitor-plugin.ts';

const bus = new EventBus<any>();
const perfPlugin = new PerfMonitorPlugin({ reportIntervalMs: 5000 });

bus.usePlugin(perfPlugin);

bus.on('testEvent', async () => {
  console.log('Handler 1 start');
  return 123;
});

bus.on('testEvent', async () => {
  console.log('Handler 2 start');
  throw new Error('Failing handler');
});

await bus.emit('testEvent');

console.log('Metrics snapshot:', perfPlugin.snapshotReport());
