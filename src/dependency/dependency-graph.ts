export class DependencyGraph {
  private graph = new Map<string, Set<string>>();

  addDependency(from: string, to: string): void {
    this.addNode(from);
    this.addNode(to);
    this.graph.get(from)!.add(to);
  }

  addNode(id: string): void {
    if (!this.graph.has(id)) {
      this.graph.set(id, new Set());
    }
  }

  clear(): void {
    this.graph.clear();
  }

  getDependencies(node: string): string[] {
    const deps = this.graph.get(node);
    return deps ? [...deps] : [];
  }

  hasNode(id: string): boolean {
    return this.graph.has(id);
  }

  layeredSubgraphSort(
    roots: string[],
    mode: "downstream" | "upstream" = "upstream",
  ): string[][] {
    if (roots.length === 0) {
      return [];
    }

    const subgraphNodes =
      mode === "upstream"
        ? this.collectUpstreamNodes(roots)
        : this.collectDownstreamNodes(roots);

    const { adjList, inDegree } = this.buildSubgraphStructures(subgraphNodes);
    return this.processLayeredSort(inDegree, adjList, subgraphNodes.size);
  }

  layeredTopologicalSort(): string[][] {
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    for (const [from, toSet] of this.graph.entries()) {
      inDegree.set(from, toSet.size);
      for (const to of toSet) {
        if (!adjList.has(to)) {
          adjList.set(to, []);
        }
        adjList.get(to)!.push(from);
      }
    }

    const layers: string[][] = [];
    let currentLayer = Array.from(this.graph.keys()).filter(
      (node) => inDegree.get(node) === 0,
    );

    let totalProcessed = 0;

    while (currentLayer.length > 0) {
      layers.push(currentLayer);
      totalProcessed += currentLayer.length;
      const nextLayer: string[] = [];

      for (const node of currentLayer) {
        const dependents = adjList.get(node);
        if (!dependents) {
          continue;
        }

        for (const dependent of dependents) {
          const degree = inDegree.get(dependent)! - 1;
          inDegree.set(dependent, degree);
          if (degree === 0) {
            nextLayer.push(dependent);
          }
        }
      }

      currentLayer = nextLayer;
    }

    if (totalProcessed !== this.graph.size) {
      throw new Error("Dependency graph contains cycles.");
    }

    return layers;
  }

  removeNode(id: string): void {
    this.graph.delete(id);
    for (const deps of this.graph.values()) {
      deps.delete(id);
    }
  }

  topologicalSort(): string[] {
    const visited = new Set<string>();
    const temp = new Set<string>();
    const result: string[] = [];

    const visit = (node: string) => {
      if (temp.has(node)) {
        throw new Error(`Cycle detected at ${node}.`);
      }
      if (!visited.has(node)) {
        temp.add(node);
        for (const dep of this.graph.get(node)!) {
          visit(dep);
        }
        temp.delete(node);
        visited.add(node);
        result.push(node);
      }
    };

    for (const node of this.graph.keys()) {
      visit(node);
    }

    return result.reverse();
  }

  updateDependency(from: string, toList: string[]): void {
    this.graph.set(from, new Set(toList));
  }

  private buildSubgraphStructures(subgraphNodes: Set<string>) {
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    for (const node of subgraphNodes) {
      const dependencies = this.getDependencies(node).filter((d) =>
        subgraphNodes.has(d),
      );
      inDegree.set(node, dependencies.length);
      for (const dep of dependencies) {
        if (!adjList.has(dep)) {
          adjList.set(dep, []);
        }
        adjList.get(dep)!.push(node);
      }
    }

    return { adjList, inDegree };
  }

  private collectDownstreamNodes(roots: string[]): Set<string> {
    const visited = new Set<string>();
    const queue = [...roots];

    for (let i = 0; i < queue.length; i++) {
      const node = queue[i];
      if (visited.has(node)) {
        continue;
      }
      visited.add(node);
      for (const dep of this.getDependencies(node)) {
        if (!visited.has(dep)) {
          queue.push(dep);
        }
      }
    }

    return visited;
  }

  private collectUpstreamNodes(roots: string[]): Set<string> {
    const visited = new Set<string>();
    const queue = [...roots];

    for (let i = 0; i < queue.length; i++) {
      const node = queue[i];
      if (visited.has(node)) {
        continue;
      }
      visited.add(node);
      for (const dep of this.getDependencies(node)) {
        if (!visited.has(dep)) {
          queue.push(dep);
        }
      }
    }

    return visited;
  }

  private processLayeredSort(
    inDegree: Map<string, number>,
    adjList: Map<string, string[]>,
    expectedSize: number,
  ): string[][] {
    const layers: string[][] = [];
    let currentLayer = Array.from(inDegree.entries())
      .filter(([, degree]) => degree === 0)
      .map(([node]) => node);

    let processedCount = 0;

    while (currentLayer.length > 0) {
      layers.push(currentLayer);
      processedCount += currentLayer.length;
      const nextLayer: string[] = [];

      for (const node of currentLayer) {
        for (const dependent of adjList.get(node) ?? []) {
          const newDegree = inDegree.get(dependent)! - 1;
          inDegree.set(dependent, newDegree);
          if (newDegree === 0) {
            nextLayer.push(dependent);
          }
        }
      }

      currentLayer = nextLayer;
    }

    if (processedCount !== expectedSize) {
      throw new Error(
        `Subgraph contains cycles, missing ${expectedSize - processedCount} nodes.`,
      );
    }

    return layers;
  }
}
