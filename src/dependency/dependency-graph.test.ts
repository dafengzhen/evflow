import { beforeEach, describe, expect, it } from 'vitest';

import { DependencyGraph } from './dependency-graph.ts';

describe('DependencyGraph', () => {
  let graph: DependencyGraph;

  beforeEach(() => {
    graph = new DependencyGraph();
  });

  describe('Node Management', () => {
    it('should add node and check existence', () => {
      graph.addNode('A');
      expect(graph.hasNode('A')).toBe(true);
      expect(graph.hasNode('B')).toBe(false);
    });

    it('should remove node and its dependencies', () => {
      graph.addDependency('A', 'B');
      graph.removeNode('A');
      expect(graph.hasNode('A')).toBe(false);
      expect(graph.getDependencies('A')).toEqual([]);
    });

    it('should safely remove non-existent node', () => {
      expect(() => graph.removeNode('Ghost')).not.toThrow();
    });

    it('should auto-create nodes when adding dependencies', () => {
      graph.addDependency('Ghost', 'Phantom');
      expect(graph.hasNode('Ghost')).toBe(true);
      expect(graph.getDependencies('Ghost')).toEqual(['Phantom']);
    });
  });

  describe('Dependency Management', () => {
    it('should add single dependency', () => {
      graph.addDependency('A', 'B');
      expect(graph.getDependencies('A')).toEqual(['B']);
    });

    it('should add multiple dependencies to a node', () => {
      graph.addDependency('A', 'B');
      graph.addDependency('A', 'C');
      expect(graph.getDependencies('A')).toEqual(['B', 'C']);
    });

    it('should update existing dependencies', () => {
      graph.addDependency('A', 'B');
      graph.updateDependency('A', ['C']);
      expect(graph.getDependencies('A')).toEqual(['C']);
    });

    it('should clear all nodes and dependencies', () => {
      graph.addDependency('A', 'B');
      graph.clear();
      expect(graph.hasNode('A')).toBe(false);
      expect(graph.hasNode('B')).toBe(false);
    });

    it('should handle dependency removal from multiple sources', () => {
      graph.addDependency('X', 'Z');
      graph.addDependency('Y', 'Z');
      graph.removeNode('Z');
      expect(graph.getDependencies('X')).toEqual([]);
      expect(graph.getDependencies('Y')).toEqual([]);
    });
  });

  describe('Topological Sorting', () => {
    it('should sort simple acyclic graph', () => {
      graph.addDependency('A', 'B');
      graph.addDependency('B', 'C');
      expect(graph.topologicalSort()).toEqual(['A', 'B', 'C']);
    });

    it('should sort diamond-shaped dependencies into layers', () => {
      graph.addDependency('A', 'B');
      graph.addDependency('A', 'C');
      graph.addDependency('B', 'D');
      graph.addDependency('C', 'D');
      expect(graph.layeredTopologicalSort()).toEqual([['D'], ['B', 'C'], ['A']]);
    });

    it('should sort nodes with multiple dependents', () => {
      graph.addDependency('X', 'Z');
      graph.addDependency('Y', 'Z');
      expect(graph.layeredTopologicalSort()).toEqual([['Z'], ['X', 'Y']]);
    });

    it('should include isolated nodes in topological layers', () => {
      graph.addNode('A');
      expect(graph.layeredTopologicalSort()).toEqual([['A']]);
    });

    it('should throw error when cycle is detected', () => {
      graph.addDependency('A', 'B');
      graph.addDependency('B', 'A');
      expect(() => graph.topologicalSort()).toThrow('Cycle detected at A.');
    });

    it('should throw layered sort error when graph has partial cycle', () => {
      graph.addDependency('A', 'B');
      graph.addDependency('B', 'C');
      graph.addDependency('C', 'B');
      expect(() => graph.layeredSubgraphSort(['A'], 'downstream')).toThrow(
        'Subgraph contains cycles, missing 3 nodes.',
      );
    });

    it('should throw error in layeredTopologicalSort for full cycle', () => {
      graph.addDependency('A', 'B');
      graph.addDependency('B', 'C');
      graph.addDependency('C', 'A');
      expect(() => graph.layeredTopologicalSort()).toThrow('Dependency graph contains cycles.');
    });
  });

  describe('Subgraph Processing', () => {
    it('should return empty array for empty roots', () => {
      expect(graph.layeredSubgraphSort([], 'downstream')).toEqual([]);
    });

    it('should collect upstream dependencies for single node', () => {
      graph.addDependency('A', 'B');
      expect(graph.layeredSubgraphSort(['B'], 'upstream')).toEqual([['B']]);
    });

    it('should collect downstream dependents for node', () => {
      graph.addDependency('X', 'Z');
      graph.addDependency('Y', 'Z');
      expect(graph.layeredSubgraphSort(['Z'], 'downstream')).toEqual([['Z']]);
    });

    it('should throw error when subgraph contains cycles', () => {
      graph.addDependency('A', 'B');
      graph.addDependency('B', 'C');
      graph.addDependency('C', 'A');
      expect(() => graph.layeredSubgraphSort(['A'], 'downstream')).toThrow(
        'Subgraph contains cycles, missing 3 nodes.',
      );
    });

    it('should build valid adjacency list for subgraph', () => {
      graph.addDependency('A', 'B');
      const { adjList, inDegree } = graph['buildSubgraphStructures'](new Set(['A', 'B']));
      expect(adjList.get('B')).toEqual(['A']);
      expect(inDegree.get('A')).toBe(1);
      expect(inDegree.get('B')).toBe(0);
    });

    it('should handle complex upstream collection with duplicates', () => {
      graph.addDependency('B', 'A');
      graph.addDependency('C', 'B');
      graph.addDependency('C', 'A'); // 添加重复依赖
      const upstream = graph['collectUpstreamNodes'](['C']);
      expect(upstream).toEqual(new Set(['A', 'B', 'C']));
    });

    it('should handle node self-reference in upstream collection', () => {
      graph.addDependency('A', 'A');
      const upstream = graph['collectUpstreamNodes'](['A']);
      expect(upstream).toEqual(new Set(['A']));
    });

    it('should skip duplicate nodes in downstream collection', () => {
      graph.addDependency('A', 'B');
      graph.addDependency('B', 'C');

      const downstream = graph['collectDownstreamNodes'](['A', 'A']);

      expect(Array.from(downstream)).toEqual(['A', 'B', 'C']);
    });
  });

  describe('Edge Cases', () => {
    it('should handle node with no dependencies', () => {
      graph.addNode('A');
      expect(graph.topologicalSort()).toEqual(['A']);
    });

    it('should process layered subgraph with deep dependencies', () => {
      graph.addDependency('A', 'B');
      graph.addDependency('B', 'C');
      expect(graph.layeredSubgraphSort(['A'], 'upstream')).toEqual([['C'], ['B'], ['A']]);
    });

    it('should skip duplicate nodes during downstream collection', () => {
      graph.addDependency('D', 'B');
      graph.addDependency('D', 'C');
      const downstream = graph['collectDownstreamNodes'](['B', 'C']);
      expect(Array.from(downstream)).toEqual(['B', 'C']);
    });
  });
});
