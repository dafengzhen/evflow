import { Dispatcher } from '../src/index.ts';

class ConcurrencyTest {
  private readonly dispatcher: Dispatcher;
  private executionLog: Map<string, { end: number; start: number }> = new Map();

  constructor() {
    this.dispatcher = new Dispatcher();
    this.configureEvents();
    this.configureHandlers();
  }

  public async run(): Promise<void> {
    console.log('Starting concurrency scheduling test...');
    const startTime = Date.now();

    await this.dispatcher.runAll();

    console.log('\nExecution log analysis:');
    this.printExecutionLog();
    this.validateConcurrency();
    this.validateDependencies();
    console.log(`\nTotal duration: ${Date.now() - startTime}ms`);
  }

  private configureEvents(): void {
    // Test dependency graph: D → B → A
    //                       ↘ C ↗
    this.dispatcher.add({ id: 'D' }); // Leaf node
    this.dispatcher.add({ id: 'C' }, ['D']); // Depends on D
    this.dispatcher.add({ id: 'B' }, ['D']); // Depends on D
    this.dispatcher.add({ id: 'A' }, ['B', 'C']); // Depends on B and C

    // Independent events for concurrency test
    this.dispatcher.add({ id: 'X' });
    this.dispatcher.add({ id: 'Y' }, ['X']);
  }

  private configureHandlers(): void {
    const createHandler = (id: string, delay: number) => async () => {
      console.log('Executing:', id);
      const start = Date.now();
      this.executionLog.set(id, { end: 0, start });
      await new Promise((resolve) => setTimeout(resolve, delay));
      this.executionLog.get(id)!.end = Date.now();
      return `${id}_result`;
    };

    this.dispatcher.handle('D', createHandler('D', 100));
    this.dispatcher.handle('C', createHandler('C', 200));
    this.dispatcher.handle('B', createHandler('B', 150));
    this.dispatcher.handle('A', createHandler('A', 50));
    this.dispatcher.handle('X', createHandler('X', 80));
    this.dispatcher.handle('Y', createHandler('Y', 30));
  }

  private printExecutionLog(): void {
    Array.from(this.executionLog.entries())
      .sort((a, b) => a[1].start - b[1].start)
      .forEach(([id, timing]) => {
        console.log(
          `${id.padEnd(2)} | Duration ${timing.end - timing.start}ms | ` +
            `Execution window: [${timing.start}, ${timing.end}]`,
        );
      });
  }

  private validateConcurrency(): void {
    const layers = this.dispatcher['graph'].layeredTopologicalSort();
    console.log('Concurrency layers:', layers);

    layers.forEach((layer, index) => {
      const executions = layer.filter((id) => this.executionLog.has(id)).map((id) => this.executionLog.get(id)!);

      const minEnd = Math.min(...executions.map((e) => e.end));
      const maxStart = Math.max(...executions.map((e) => e.start));
      if (maxStart > minEnd) {
        throw new Error(`Layer ${index} lacks concurrent execution`);
      }
      console.log(`✓ Layer ${index} [${layer}] concurrency validated`);
    });
  }

  private validateDependencies(): void {
    const validateOrder = (parent: string, child: string) => {
      const parentEnd = this.executionLog.get(parent)?.end;
      const childStart = this.executionLog.get(child)?.start;

      if (parentEnd && childStart && childStart < parentEnd) {
        throw new Error(`Dependency violation: ${child} started before ${parent} completed`);
      }
    };

    validateOrder('D', 'B');
    validateOrder('D', 'C');
    validateOrder('B', 'A');
    validateOrder('C', 'A');
    validateOrder('X', 'Y');
    console.log('✓ All dependencies validated');
  }
}

// Run test
const test = new ConcurrencyTest();
await test.run();
