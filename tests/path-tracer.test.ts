/**
 * Unit tests for path_tracer.ts - BFS/DFS path finding and blast radius
 */

import { describe, it, expect, beforeEach } from "vitest";
import type {
  FloorPlan,
  CallGraphNode,
  CallEdge,
  EntryPoint,
  SideEffect,
} from "../src/types.js";
import {
  tracePaths,
  tracePathsReverse,
  calculateBlastRadius,
  findAllPathsBetween,
  getCallChain,
} from "../src/tools/path_tracer.js";

describe("path_tracer", () => {
  let mockPlan: FloorPlan;

  beforeEach(() => {
    // Build a simple test graph:
    // A -> B -> C
    // A -> D -> C
    // E -> F
    // G (isolated)
    const nodes = new Map<string, CallGraphNode>();
    const edges = new Map<string, CallEdge[]>();
    const reverseEdges = new Map<string, string[]>();

    const nodeIds = ["A", "B", "C", "D", "E", "F", "G"];
    for (const id of nodeIds) {
      nodes.set(id, createMockNode(id));
    }

    // Forward edges
    edges.set("A", [
      createMockEdge("A", "B", 10),
      createMockEdge("A", "D", 15),
    ]);
    edges.set("B", [createMockEdge("B", "C", 20)]);
    edges.set("D", [createMockEdge("D", "C", 25)]);
    edges.set("E", [createMockEdge("E", "F", 30)]);

    // Reverse edges
    reverseEdges.set("B", ["A"]);
    reverseEdges.set("C", ["B", "D"]);
    reverseEdges.set("D", ["A"]);
    reverseEdges.set("F", ["E"]);

    const entryPoints: EntryPoint[] = [
      {
        id: "ep1",
        kind: "cli_command",
        name: "/test-command",
        registrationFile: "extensions/index.ts",
        handlerId: "A",
        description: "Test command",
      },
    ];

    mockPlan = {
      nodes,
      edges,
      reverseEdges,
      entryPoints,
      meta: {
        generatedAt: new Date().toISOString(),
        fileCount: 1,
        nodeCount: nodeIds.length,
        edgeCount: 5,
        analysisTimeMs: 100,
        parseErrors: [],
      },
    };
  });

  // ---------------------------------------------------------------------------
  // tracePaths - BFS forward
  // ---------------------------------------------------------------------------

  describe("tracePaths", () => {
    it("finds shortest path A -> C", () => {
      const result = tracePaths(mockPlan, "A", "C");

      expect(result.from).toBe("A");
      expect(result.to).toBe("C");
      expect(result.shortestPathLength).toBe(2);
      expect(result.paths.length).toBeGreaterThan(0);
      expect(result.truncated).toBe(false);

      // Should find both paths: A -> B -> C and A -> D -> C
      expect(result.paths.length).toBe(2);
    });

    it("returns empty paths when no path exists", () => {
      const result = tracePaths(mockPlan, "A", "F");

      expect(result.shortestPathLength).toBe(-1);
      expect(result.paths).toEqual([]);
      expect(result.truncated).toBe(false);
    });

    it("handles same node case", () => {
      const result = tracePaths(mockPlan, "A", "A");

      expect(result.shortestPathLength).toBe(0);
      expect(result.paths).toEqual([]);
      expect(result.truncated).toBe(false);
    });

    it("respects maxDepth limit", () => {
      const result = tracePaths(mockPlan, "A", "C", 1);

      expect(result.shortestPathLength).toBe(-1);
      expect(result.truncated).toBe(true);
      expect(result.maxDepthSearched).toBe(1);
    });

    it("throws error for invalid fromId", () => {
      expect(() => tracePaths(mockPlan, "INVALID", "C")).toThrow(
        'fromId "INVALID" not found in floor plan'
      );
    });

    it("throws error for invalid toId", () => {
      expect(() => tracePaths(mockPlan, "A", "INVALID")).toThrow(
        'toId "INVALID" not found in floor plan'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // tracePathsReverse - BFS backward
  // ---------------------------------------------------------------------------

  describe("tracePathsReverse", () => {
    it("finds reverse paths C -> A", () => {
      const result = tracePathsReverse(mockPlan, "C", "A");

      expect(result.from).toBe("C");
      expect(result.to).toBe("A");
      expect(result.shortestPathLength).toBeGreaterThanOrEqual(0);
      expect(result.paths.length).toBeGreaterThan(0);
    });

    it("returns empty when no reverse path exists", () => {
      const result = tracePathsReverse(mockPlan, "A", "C");

      expect(result.shortestPathLength).toBe(-1);
      expect(result.paths).toEqual([]);
    });

    it("handles same node case", () => {
      const result = tracePathsReverse(mockPlan, "B", "B");

      expect(result.shortestPathLength).toBe(0);
      expect(result.paths).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Cycle Detection
  // ---------------------------------------------------------------------------

  describe("cycle detection", () => {
    it("detects cycles and avoids infinite loops", () => {
      // Add a cycle: C -> A
      const newEdges = new Map(mockPlan.edges);
      newEdges.set("C", [createMockEdge("C", "A", 100)]);

      const newReverseEdges = new Map(mockPlan.reverseEdges);
      const aCallers = newReverseEdges.get("A") || [];
      newReverseEdges.set("A", [...aCallers, "C"]);

      const cyclicPlan: FloorPlan = {
        ...mockPlan,
        edges: newEdges,
        reverseEdges: newReverseEdges,
      };

      // Should still terminate without hanging
      const result = tracePaths(cyclicPlan, "A", "F", 20);

      expect(result.shortestPathLength).toBe(-1);
      expect(result.paths).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // calculateBlastRadius
  // ---------------------------------------------------------------------------

  describe("calculateBlastRadius", () => {
    it("calculates direct and transitive callers", () => {
      const result = calculateBlastRadius(mockPlan, "C");

      expect(result.changedFunction).toBe("C");
      expect(result.directCallers).toEqual(["B", "D"]);
      expect(result.transitiveCallers).toContain("A");
      expect(result.transitiveCallers).toContain("B");
      expect(result.transitiveCallers).toContain("D");
      expect(result.maxImpactDepth).toBeGreaterThan(0);
    });

    it("identifies affected entry points", () => {
      const result = calculateBlastRadius(mockPlan, "B");

      expect(result.affectedEntryPoints.length).toBeGreaterThan(0);
      expect(result.affectedEntryPoints[0].handlerId).toBe("A");
    });

    it("calculates risk score based on caller count", () => {
      const result = calculateBlastRadius(mockPlan, "C");

      // Base score: transitiveCallers.length * 5
      // Should have at least A, B, D
      expect(result.riskScore).toBeGreaterThan(0);
      expect(result.riskScore).toBeLessThanOrEqual(100);
    });

    it("increases risk score for order_submit side effects", () => {
      // Add order_submit side effect to node A
      const nodeA = mockPlan.nodes.get("A")!;
      nodeA.sideEffects = [createMockSideEffect("order_submit", "critical")];

      const result = calculateBlastRadius(mockPlan, "B");

      // Should have +20 bonus for order_submit
      expect(result.riskScore).toBeGreaterThan(15);
    });

    it("increases risk score for llm_call side effects", () => {
      const nodeA = mockPlan.nodes.get("A")!;
      nodeA.sideEffects = [createMockSideEffect("llm_call", "medium")];

      const result = calculateBlastRadius(mockPlan, "B");

      // Should have +15 bonus for llm_call
      expect(result.riskScore).toBeGreaterThan(10);
    });

    it("increases risk score for CLI command entry points", () => {
      const result = calculateBlastRadius(mockPlan, "B");

      // Entry point A is a cli_command, should add +10
      expect(result.riskScore).toBeGreaterThan(5);
    });

    it("caps risk score at 100", () => {
      // Create a high-impact scenario
      const nodeA = mockPlan.nodes.get("A")!;
      nodeA.sideEffects = [
        createMockSideEffect("order_submit", "critical"),
        createMockSideEffect("llm_call", "medium"),
      ];

      // Add many transitive callers
      for (let i = 0; i < 50; i++) {
        const id = `caller${i}`;
        mockPlan.nodes.set(id, createMockNode(id));
        mockPlan.reverseEdges.set("A", [
          ...(mockPlan.reverseEdges.get("A") || []),
          id,
        ]);
      }

      const result = calculateBlastRadius(mockPlan, "B");

      expect(result.riskScore).toBeLessThanOrEqual(100);
    });

    it("throws error for invalid nodeId", () => {
      expect(() => calculateBlastRadius(mockPlan, "INVALID")).toThrow(
        'nodeId "INVALID" not found in floor plan'
      );
    });
  });

  // ---------------------------------------------------------------------------
  // findAllPathsBetween - DFS
  // ---------------------------------------------------------------------------

  describe("findAllPathsBetween", () => {
    it("finds all paths between two nodes", () => {
      const result = findAllPathsBetween(mockPlan, "A", "C");

      // Should find both: A -> B -> C and A -> D -> C
      expect(result.length).toBe(2);
    });

    it("respects maxPaths limit", () => {
      // Add more edges to create many paths
      const newEdges = new Map(mockPlan.edges);
      const newNodes = new Map(mockPlan.nodes);

      // Add X -> C edges
      for (let i = 0; i < 25; i++) {
        const id = `X${i}`;
        newNodes.set(id, createMockNode(id));
        newEdges.set("A", [
          ...(newEdges.get("A") || []),
          createMockEdge("A", id, 100 + i),
        ]);
        newEdges.set(id, [createMockEdge(id, "C", 200 + i)]);
      }

      const manyPathPlan: FloorPlan = {
        ...mockPlan,
        nodes: newNodes,
        edges: newEdges,
      };

      const result = findAllPathsBetween(manyPathPlan, "A", "C", 10);

      expect(result.length).toBeLessThanOrEqual(10);
    });

    it("respects maxDepth limit", () => {
      const result = findAllPathsBetween(mockPlan, "A", "C", 20, 1);

      // maxDepth=1 means we can only go one hop, so can't reach C from A
      expect(result.length).toBe(0);
    });

    it("returns empty array when no path exists", () => {
      const result = findAllPathsBetween(mockPlan, "A", "F");

      expect(result).toEqual([]);
    });

    it("returns empty array for same node", () => {
      const result = findAllPathsBetween(mockPlan, "A", "A");

      expect(result).toEqual([]);
    });

    it("handles cycles without infinite loop", () => {
      // Add cycle: C -> B
      const newEdges = new Map(mockPlan.edges);
      newEdges.set("C", [createMockEdge("C", "B", 999)]);

      const cyclicPlan: FloorPlan = {
        ...mockPlan,
        edges: newEdges,
      };

      const result = findAllPathsBetween(cyclicPlan, "A", "C", 20, 10);

      // Should still find paths and terminate
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // getCallChain
  // ---------------------------------------------------------------------------

  describe("getCallChain", () => {
    it("formats call chain correctly", () => {
      const result = getCallChain(mockPlan, "A", 5);

      // A -> B (first edge) -> C
      expect(result).toContain("A");
      expect(result).toContain("->");
      expect(result.split("->").length).toBeGreaterThan(1);
    });

    it("respects depth limit", () => {
      const result = getCallChain(mockPlan, "A", 1);

      // Should only show A
      const parts = result.split("->").map((s) => s.trim());
      expect(parts.length).toBe(1);
      expect(parts[0]).toBe("A");
    });

    it("handles nodes with no outgoing edges", () => {
      const result = getCallChain(mockPlan, "G", 5);

      expect(result).toBe("G");
    });

    it("stops at visited nodes to avoid infinite loops", () => {
      // Add cycle: C -> B
      const newEdges = new Map(mockPlan.edges);
      newEdges.set("C", [createMockEdge("C", "B", 999)]);

      const cyclicPlan: FloorPlan = {
        ...mockPlan,
        edges: newEdges,
      };

      const result = getCallChain(cyclicPlan, "B", 10);

      // Should terminate without hanging
      expect(result).toBeTruthy();
      expect(result.split("->").length).toBeLessThanOrEqual(10);
    });

    it("returns unknown for invalid node", () => {
      const result = getCallChain(mockPlan, "INVALID");

      expect(result).toContain("Unknown");
      expect(result).toContain("INVALID");
    });

    it("uses default depth of 5", () => {
      const result = getCallChain(mockPlan, "A");

      // Should work without specifying depth
      expect(result).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createMockNode(id: string): CallGraphNode {
  return {
    id,
    name: id,
    file: `test/${id}.ts`,
    lineStart: 1,
    lineEnd: 10,
    signature: "()",
    kind: "function",
    exported: true,
    isAsync: false,
    sideEffects: [],
  };
}

function createMockEdge(
  callerId: string,
  calleeId: string,
  line: number
): CallEdge {
  return {
    callerId,
    calleeId,
    callSiteLine: line,
    isAsync: false,
    isConditional: false,
    isInTry: false,
    isInLoop: false,
    callText: `${calleeId}()`,
  };
}

function createMockSideEffect(
  type: "order_submit" | "llm_call",
  riskLevel: "low" | "medium" | "high" | "critical"
): SideEffect {
  return {
    type,
    line: 5,
    description: `Mock ${type}`,
    riskLevel,
  };
}
