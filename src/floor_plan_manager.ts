/**
 * Floor plan manager -- module-level cache and build helpers for pi-code-map-extension.
 *
 * Cache is keyed by rootDir + sorted includeDirs so different projects/configs
 * get independent cached results. Call rebuildFloorPlan() to force refresh.
 */

import type { FloorPlan, CallGraphNode } from "./types.js";

// Cache key: "rootDir|dir1,dir2,dir3" (includeDirs sorted) or "rootDir|__auto__" when auto-detected
const planCache = new Map<string, FloorPlan>();
// In-flight build promises — prevents concurrent cold-start races
const buildPromises = new Map<string, Promise<FloorPlan>>();

/**
 * Build a stable cache key from rootDir + includeDirs.
 * When includeDirs is undefined (auto-detect), uses "__auto__" sentinel.
 */
function makeCacheKey(rootDir?: string, includeDirs?: string[]): string {
  const root = rootDir ?? process.cwd();
  const dirs = includeDirs !== undefined ? [...includeDirs].sort().join(",") : "__auto__";
  return `${root}|${dirs}`;
}

/** Options accepted by ensureFloorPlan and rebuildFloorPlan. */
export interface FloorPlanManagerOptions {
  rootDir?: string;
  includeDirs?: string[];
  /** Informational deadline hint (milliseconds since Unix epoch). */
  deadlineMs?: number;
}

/**
 * Return the cached floor plan for the given options, or build one if not yet built.
 * Concurrent callers share a single in-flight build promise (mutex pattern).
 */
export async function ensureFloorPlan(options?: FloorPlanManagerOptions): Promise<FloorPlan> {
  const key = makeCacheKey(options?.rootDir, options?.includeDirs);

  const cached = planCache.get(key);
  if (cached) return cached;

  const pending = buildPromises.get(key);
  if (pending) return pending;

  const promise = (async () => {
    const { buildCallGraph } = await import("./tools/call_graph_builder.js");
    const { tagSideEffects } = await import("./tools/side_effect_tagger.js");
    const { mapEntryPoints } = await import("./tools/entry_point_mapper.js");

    const rootDir = options?.rootDir;
    let plan = buildCallGraph({ rootDir, includeDirs: options?.includeDirs });
    plan = tagSideEffects(plan, rootDir);
    const entryPoints = mapEntryPoints(plan, rootDir);
    plan = { ...plan, entryPoints };

    planCache.set(key, plan);
    buildPromises.delete(key);
    return plan;
  })();

  buildPromises.set(key, promise);
  return promise;
}

/**
 * Force rebuild: clear cache entry and rebuild.
 */
export async function rebuildFloorPlan(options?: FloorPlanManagerOptions): Promise<FloorPlan> {
  const key = makeCacheKey(options?.rootDir, options?.includeDirs);
  planCache.delete(key);
  buildPromises.delete(key);
  return ensureFloorPlan(options);
}

/**
 * Format a single call graph node for JSON output.
 */
export function formatNode(node: CallGraphNode): Record<string, unknown> {
  return {
    id: node.id,
    name: node.name,
    file: node.file,
    line: node.lineStart,
    kind: node.kind,
    exported: node.exported,
    isAsync: node.isAsync,
    sideEffects: node.sideEffects.map((e) => ({
      type: e.type,
      line: e.line,
      risk: e.riskLevel,
    })),
  };
}
