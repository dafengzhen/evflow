import { Dispatcher } from '../src';

class SubgraphTestRunner {
  private dispatcher = new Dispatcher();
  private executionLog = new Map<string, { end: number; start: number }>();

  async runTests() {
    await this.testBasicSubgraph();
    await this.testIndependentSubgraphs();
    await this.testCycleDetection();
    console.log('All tests passed ✅');
  }

  private configureCycleDependency() {
    this.registerEvent('X', ['Y']);
    this.registerEvent('Y', ['Z']);
    this.registerEvent('Z', ['X']); // Creates cycle: X→Y→Z→X
  }

  private configureDiamondDependency() {
    /*
      D ↗↖
     /   \
    B1 → C1   B2 → A2
     \   /
      A1
    */
    this.registerEvent('D');
    this.registerEvent('B1', ['D'], 150);
    this.registerEvent('C1', ['B1'], 100);
    this.registerEvent('A1', ['B1', 'C1'], 50);
    this.registerEvent('B2', ['D'], 200);
    this.registerEvent('A2', ['B2'], 80);
    this.registerEvent('C2', [], 120); // Independent event
  }

  private configureParallelChains() {
    /*
      A1 → B1 → C1 (Chain 1)
      A2 → B2      (Chain 2)
    */
    this.registerEvent('A1', [], 100);
    this.registerEvent('B1', ['A1'], 150);
    this.registerEvent('C1', ['B1'], 200);
    this.registerEvent('A2', [], 120);
    this.registerEvent('B2', ['A2'], 180);
  }

  private isSetEqual(a: Set<string>, b: Set<string>) {
    return a.size === b.size && [...a].every((x) => b.has(x));
  }

  private printTimeline() {
    console.log('\nExecution timeline:');
    Array.from(this.executionLog.entries())
      .sort((a, b) => a[1].start - b[1].start)
      .forEach(([id, time]) => {
        console.log(
          `${id.padEnd(3)} | Duration ${Math.round(time.end - time.start)}ms | ` +
            `[${time.start.toFixed(2)}, ${time.end.toFixed(2)}]`,
        );
      });
  }

  private registerEvent(id: string, deps: string[] = [], delay = 0) {
    this.dispatcher.add({ id }, deps);
    this.dispatcher.handle(id, async () => {
      const start = performance.now();
      this.executionLog.set(id, { end: 0, start });
      await new Promise((resolve) => setTimeout(resolve, delay));
      this.executionLog.get(id)!.end = performance.now();
      return `${id}_result`;
    });
  }

  private reset() {
    this.dispatcher = new Dispatcher();
    this.executionLog.clear();
  }

  private async testBasicSubgraph() {
    console.log('\n=== Testing basic subgraph scheduling ===');
    this.reset();
    this.configureDiamondDependency();

    await this.dispatcher.runAll(['C1', 'B2']);

    this.validateExecution({
      expected: ['D', 'B1', 'C1', 'B2'],
      forbidden: ['A1', 'A2', 'C2'],
    });
    this.printTimeline();
  }

  private async testCycleDetection() {
    console.log('\n=== Testing cycle detection ===');
    this.reset();
    this.configureCycleDependency();

    try {
      await this.dispatcher.runAll(['X']);
      throw new Error('Cycle dependency not detected');
    } catch (err) {
      if (!(err as Error).message.includes('contains cycles')) {
        throw new Error('Incorrect cycle detection');
      }
      console.log('✓ Cycle detection validated');
    }
  }

  private async testIndependentSubgraphs() {
    console.log('\n=== Testing independent subgraph concurrency ===');
    this.reset();
    this.configureParallelChains();

    await this.dispatcher.runAll(['C1', 'A2'], 'downstream');
    this.validateConcurrencyLayers([['A1', 'A2'], ['B1'], ['C1']]);
    this.printTimeline();
  }

  private validateConcurrencyLayers(expectedLayers: string[][]) {
    const layers = this.dispatcher['graph'].layeredSubgraphSort(Array.from(this.executionLog.keys()));

    if (layers.length !== expectedLayers.length) {
      throw new Error(`Layer count mismatch. Expected ${expectedLayers.length}, got ${layers.length}`);
    }

    layers.forEach((layer, index) => {
      const expected = new Set(expectedLayers[index]);
      const actual = new Set(layer);
      if (!this.isSetEqual(expected, actual)) {
        throw new Error(`Layer ${index} mismatch\nExpected: ${expectedLayers[index]}\nActual: ${layer}`);
      }
    });
  }

  private validateExecution(config: { expected: string[]; forbidden: string[] }) {
    config.expected.forEach((id) => {
      if (!this.executionLog.has(id)) {
        throw new Error(`Missing expected event: ${id}`);
      }
    });

    config.forbidden.forEach((id) => {
      if (this.executionLog.has(id)) {
        throw new Error(`Unexpected execution: ${id}`);
      }
    });

    const validateDependency = (parent: string, child: string) => {
      const parentEnd = this.executionLog.get(parent)?.end || 0;
      const childStart = this.executionLog.get(child)?.start || Infinity;
      if (childStart < parentEnd) {
        throw new Error(`${child} started before ${parent} completed`);
      }
    };

    validateDependency('D', 'B1');
    validateDependency('B1', 'C1');
    validateDependency('D', 'B2');
    validateDependency('B2', 'A2');
  }
}

// Run tests
const tester = new SubgraphTestRunner();
await tester.runTests();
