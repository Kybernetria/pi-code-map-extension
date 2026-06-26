/**
 * @fileoverview path_tracer — tracePaths, tracePathsReverse, calculateBlastRadius.
 * Key exports: tracePaths, tracePathsReverse, calculateBlastRadius, findAllPathsBetween, getCallChain
 */
/**
 * path_tracer.ts - Path finding and blast radius analysis for the call graph
 *
 * Provides BFS/DFS algorithms to:
 * - Find execution paths between functions
 * - Calculate blast radius (what breaks if X changes)
 * - Generate readable call chains for debugging
 *
 * Part of pi-floor-plan Phase 1.
 */

import type {
  FloorPlan,
  CallEdge,
  PathTrace,
  BlastRadius,
  EntryPoint,
} from "../types.js";

// ---------------------------------------------------------------------------
// BFS: Shortest Path Finding
// ---------------------------------------------------------------------------

/**
 * Find paths from one function to another using BFS (forward direction).
 * Returns all paths found up to maxDepth, with shortest path highlighted.
 */
export function tracePaths(
  plan: FloorPlan,
  fromId: string,
  toId: string,
  maxDepth: number = 10
): PathTrace {
  // Validate IDs
  if (!plan.nodes.has(fromId)) {
    throw new Error(`fromId "${fromId}" not found in floor plan`);
  }
  if (!plan.nodes.has(toId)) {
    throw new Error(`toId "${toId}" not found in floor plan`);
  }

  // Edge case: same node
  if (fromId === toId) {
    return {
      from: fromId,
      to: toId,
      paths: [],
      shortestPathLength: 0,
      truncated: false,
      maxDepthSearched: 0,
    };
  }

  const paths: CallEdge[][] = [];
  const queue: Array<{ nodeId: string; path: CallEdge[]; depth: number }> = [
    { nodeId: fromId, path: [], depth: 0 },
  ];
  const visited = new Set<string>();
  let shortestLength = -1;
  let truncated = false;

  while (queue.length > 0) {
    const current = queue.shift()!;

    // Skip if visited
    if (visited.has(current.nodeId)) {
      continue;
    }
    visited.add(current.nodeId);

    // Stop if max depth reached
    if (current.depth >= maxDepth) {
      truncated = true;
      continue;
    }

    // Get outgoing edges
    const edges = plan.edges.get(current.nodeId) || [];

    for (const edge of edges) {
      const newPath = [...current.path, edge];

      // Found target
      if (edge.calleeId === toId) {
        paths.push(newPath);
        if (shortestLength === -1 || newPath.length < shortestLength) {
          shortestLength = newPath.length;
        }
        continue;
      }

      // Continue BFS
      queue.push({
        nodeId: edge.calleeId,
        path: newPath,
        depth: current.depth + 1,
      });
    }
  }

  return {
    from: fromId,
    to: toId,
    paths,
    shortestPathLength: shortestLength,
    truncated,
    maxDepthSearched: maxDepth,
  };
}

// ---------------------------------------------------------------------------
// BFS: Reverse Path Finding
// ---------------------------------------------------------------------------

/**
 * Find paths from one function to another using reverse edges (callee -> caller).
 * Useful for "who calls X, and who calls those callers?"
 */
export function tracePathsReverse(
  plan: FloorPlan,
  fromId: string,
  toId: string,
  maxDepth: number = 10
): PathTrace {
  // Validate IDs
  if (!plan.nodes.has(fromId)) {
    throw new Error(`fromId "${fromId}" not found in floor plan`);
  }
  if (!plan.nodes.has(toId)) {
    throw new Error(`toId "${toId}" not found in floor plan`);
  }

  // Edge case: same node
  if (fromId === toId) {
    return {
      from: fromId,
      to: toId,
      paths: [],
      shortestPathLength: 0,
      truncated: false,
      maxDepthSearched: 0,
    };
  }

  const paths: CallEdge[][] = [];
  const queue: Array<{ nodeId: string; reverseCallers: string[]; depth: number }> = [
    { nodeId: fromId, reverseCallers: [], depth: 0 },
  ];
  const visited = new Set<string>();
  let shortestLength = -1;
  let truncated = false;

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (visited.has(current.nodeId)) {
      continue;
    }
    visited.add(current.nodeId);

    if (current.depth >= maxDepth) {
      truncated = true;
      continue;
    }

    const callers = plan.reverseEdges.get(current.nodeId) || [];

    for (const callerId of callers) {
      const newCallers = [...current.reverseCallers, callerId];

      if (callerId === toId) {
        // Reconstruct edge path from caller chain
        const edgePath = reconstructEdgesFromCallers([fromId, ...newCallers], plan);
        paths.push(edgePath);
        if (shortestLength === -1 || edgePath.length < shortestLength) {
          shortestLength = edgePath.length;
        }
        continue;
      }

      queue.push({
        nodeId: callerId,
        reverseCallers: newCallers,
        depth: current.depth + 1,
      });
    }
  }

  return {
    from: fromId,
    to: toId,
    paths,
    shortestPathLength: shortestLength,
    truncated,
    maxDepthSearched: maxDepth,
  };
}

/**
 * Helper: Reconstruct CallEdge[] from a sequence of node IDs.
 */
function reconstructEdgesFromCallers(
  callerChain: string[],
  plan: FloorPlan
): CallEdge[] {
  const edges: CallEdge[] = [];
  for (let i = 0; i < callerChain.length - 1; i++) {
    const callerId = callerChain[i];
    const calleeId = callerChain[i + 1];
    const outgoingEdges = plan.edges.get(callerId) || [];
    const edge = outgoingEdges.find((e) => e.calleeId === calleeId);
    if (edge) {
      edges.push(edge);
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Blast Radius Analysis
// ---------------------------------------------------------------------------

/**
 * Calculate the impact of changing a function: who calls it, transitively,
 * and what entry points are affected.
 */
export function calculateBlastRadius(
  plan: FloorPlan,
  nodeId: string,
  maxDepth: number = 10
): BlastRadius {
  if (!plan.nodes.has(nodeId)) {
    throw new Error(`nodeId "${nodeId}" not found in floor plan`);
  }

  const directCallers: string[] = plan.reverseEdges.get(nodeId) || [];
  const transitiveCallers = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: nodeId, depth: 0 }];
  const visited = new Set<string>();
  let maxImpactDepth = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (visited.has(current.id)) {
      continue;
    }
    visited.add(current.id);

    if (current.depth >= maxDepth) {
      continue;
    }

    const callers = plan.reverseEdges.get(current.id) || [];
    for (const callerId of callers) {
      transitiveCallers.add(callerId);
      maxImpactDepth = Math.max(maxImpactDepth, current.depth + 1);
      queue.push({ id: callerId, depth: current.depth + 1 });
    }
  }

  // Find affected entry points
  const affectedEntryPoints: EntryPoint[] = [];
  for (const ep of plan.entryPoints) {
    if (transitiveCallers.has(ep.handlerId)) {
      affectedEntryPoints.push(ep);
    }
  }

  // Calculate risk score
  const riskScore = calculateRiskScore(
    Array.from(transitiveCallers),
    affectedEntryPoints,
    plan
  );

  return {
    changedFunction: nodeId,
    directCallers,
    transitiveCallers: Array.from(transitiveCallers),
    affectedEntryPoints,
    maxImpactDepth,
    riskScore,
  };
}

/**
 * Risk scoring algorithm.
 */
function calculateRiskScore(
  transitiveCallers: string[],
  affectedEntryPoints: EntryPoint[],
  plan: FloorPlan
): number {
  let score = Math.min(100, transitiveCallers.length * 5);

  // Bonus for critical side effects
  for (const callerId of transitiveCallers) {
    const node = plan.nodes.get(callerId);
    if (node) {
      const hasOrderSubmit = node.sideEffects.some((e) => e.type === "order_submit");
      const hasLlmCall = node.sideEffects.some((e) => e.type === "llm_call");
      if (hasOrderSubmit) {
        score += 20;
      }
      if (hasLlmCall) {
        score += 15;
      }
    }
  }

  // Bonus for CLI command entry points
  for (const ep of affectedEntryPoints) {
    if (ep.kind === "cli_command") {
      score += 10;
    }
  }

  return Math.min(100, score);
}

// ---------------------------------------------------------------------------
// DFS: All Paths Enumeration
// ---------------------------------------------------------------------------

/**
 * Find ALL paths between two functions using DFS with cycle detection.
 * Limited by maxPaths and maxDepth for performance.
 */
export function findAllPathsBetween(
  plan: FloorPlan,
  fromId: string,
  toId: string,
  maxPaths: number = 20,
  maxDepth: number = 10
): CallEdge[][] {
  if (!plan.nodes.has(fromId) || !plan.nodes.has(toId)) {
    return [];
  }

  if (fromId === toId) {
    return [];
  }

  const allPaths: CallEdge[][] = [];
  const visited = new Set<string>();

  function dfs(currentId: string, path: CallEdge[], depth: number): void {
    if (allPaths.length >= maxPaths || depth >= maxDepth) {
      return;
    }

    if (visited.has(currentId)) {
      return;
    }

    visited.add(currentId);

    const edges = plan.edges.get(currentId) || [];
    for (const edge of edges) {
      const newPath = [...path, edge];

      if (edge.calleeId === toId) {
        allPaths.push(newPath);
        if (allPaths.length >= maxPaths) {
          return;
        }
        continue;
      }

      dfs(edge.calleeId, newPath, depth + 1);
    }

    visited.delete(currentId);
  }

  dfs(fromId, [], 0);
  return allPaths;
}

// ---------------------------------------------------------------------------
// Call Chain Formatting
// ---------------------------------------------------------------------------

/**
 * Get a readable call chain starting from nodeId.
 * Returns: "functionA -> functionB -> functionC -> ..."
 */
export function getCallChain(
  plan: FloorPlan,
  nodeId: string,
  depth: number = 5
): string {
  if (!plan.nodes.has(nodeId)) {
    return `[Unknown: ${nodeId}]`;
  }

  const chain: string[] = [];
  const visited = new Set<string>();
  let currentId = nodeId;

  for (let i = 0; i < depth; i++) {
    const node = plan.nodes.get(currentId);
    if (!node || visited.has(currentId)) {
      break;
    }

    chain.push(node.name);
    visited.add(currentId);

    const edges = plan.edges.get(currentId) || [];
    if (edges.length === 0) {
      break;
    }

    // Follow first edge (arbitrary choice for simple chains)
    currentId = edges[0].calleeId;
  }

  return chain.join(" -> ");
}
