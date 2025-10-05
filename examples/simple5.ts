import { EventBus, MemoryBroadcastAdapter } from '../src/index.ts';

async function correctTestExpectations() {
  console.log('=== CORRECT Test Expectations ===\n');

  const eventBus1 = new EventBus();
  const eventBus2 = new EventBus();

  console.log(`Node IDs: EventBus1=${eventBus1.getNodeId()}, EventBus2=${eventBus2.getNodeId()}\n`);

  const adapter1 = new MemoryBroadcastAdapter('ADAPTER-1');
  const adapter2 = new MemoryBroadcastAdapter('ADAPTER-2');

  eventBus1.addBroadcastAdapter(adapter1);
  eventBus2.addBroadcastAdapter(adapter2);

  await eventBus1.subscribeBroadcast(['test-channel']);
  await eventBus2.subscribeBroadcast(['test-channel']);

  const counts = {
    eventBus1: { test1: 0, test2: 0 },
    eventBus2: { test1: 0, test2: 0 },
  };

  eventBus1.on('test.event', async (context) => {
    if (context.meta?.test === 'test1') {
      counts.eventBus1.test1++;
    } else if (context.meta?.test === 'test2') {
      counts.eventBus1.test2++;
    }
    const type = context.broadcast ? 'BROADCAST' : 'LOCAL';
    console.log(
      `📥 [EventBus1] ${type} - ${context.meta?.test} - total: ${counts.eventBus1.test1 + counts.eventBus1.test2}`,
    );
  });
  eventBus2.on('test.event', async (context) => {
    if (context.meta?.test === 'test1') {
      counts.eventBus2.test1++;
    } else if (context.meta?.test === 'test2') {
      counts.eventBus2.test2++;
    }
    const type = context.broadcast ? 'BROADCAST' : 'LOCAL';
    console.log(
      `📥 [EventBus2] ${type} - ${context.meta?.test} - total: ${counts.eventBus2.test1 + counts.eventBus2.test2}`,
    );
  });

  console.log('🎯 TEST 1: excludeSelf=true');
  console.log('Expected: EventBus1=1 (local), EventBus2=1 (broadcast)');

  await eventBus1.broadcast(
    'test.event',
    { meta: { test: 'test1' } },
    { channels: ['test-channel'], excludeSelf: true },
  );

  await new Promise((resolve) => setTimeout(resolve, 100));

  console.log(`📊 Test1 Results: EventBus1=${counts.eventBus1.test1}, EventBus2=${counts.eventBus2.test1}`);
  const test1Passed = counts.eventBus1.test1 === 1 && counts.eventBus2.test1 === 1;
  console.log(`Test1: ${test1Passed ? '✅ PASS' : '❌ FAIL'}\n`);

  console.log('🎯 TEST 2: excludeSelf=false');
  console.log('Expected: EventBus1=1 (local) + 1 (broadcast) = 2, EventBus2=1 (broadcast)');

  await eventBus1.broadcast(
    'test.event',
    { meta: { test: 'test2' } },
    { channels: ['test-channel'], excludeSelf: false },
  );

  await new Promise((resolve) => setTimeout(resolve, 100));

  console.log(`📊 Test2 Results: EventBus1=${counts.eventBus1.test2}, EventBus2=${counts.eventBus2.test2}`);
  const test2Passed = counts.eventBus1.test2 === 2 && counts.eventBus2.test2 === 1;
  console.log(`Test2: ${test2Passed ? '✅ PASS' : '❌ FAIL'}`);

  console.log('\n🎯 FINAL VERIFICATION');
  const totalEventBus1 = counts.eventBus1.test1 + counts.eventBus1.test2;
  const totalEventBus2 = counts.eventBus2.test1 + counts.eventBus2.test2;
  console.log(`EventBus1 Total: ${totalEventBus1} events (expected: 3)`);
  console.log(`EventBus2 Total: ${totalEventBus2} events (expected: 2)`);

  const allPassed = test1Passed && test2Passed && totalEventBus1 === 3 && totalEventBus2 === 2;
  console.log(`\n🎉 OVERALL RESULT: ${allPassed ? '✅ ALL TESTS PASSED!' : '❌ TESTS FAILED'}`);
}

correctTestExpectations().catch(console.error);
