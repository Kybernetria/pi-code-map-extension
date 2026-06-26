export type {
  CallableKind,
  CallGraphNode,
  CapabilityAnnotation,
  CallEdge,
  SideEffectType,
  SideEffectRisk,
  SideEffect,
  EntryPointKind,
  EntryPoint,
  FloorPlanMeta,
  FloorPlan,
  PathTrace,
  BlastRadius,
  ModuleSummary,
  EntryPointChain,
  CompactFloorPlan,
  FileCacheEntry,
  CallGraphBuilderOptions,
} from "./types.js";

export type { CallableNode, ExtractedNode, ResolutionContext } from "./tools/call_graph_helpers.js";
export {
  setProjectRoot,
  getRelativePath,
  syntaxKindToCallableKind,
  isExported,
  isAsyncNode,
  extractSignature,
  extractDocComment,
  buildNodeId,
  getNodeSymbol,
  extractCallablesFromFile,
  isInsideConditional,
  isInsideTry,
  isInsideLoop,
  isAwaitedCall,
} from "./tools/call_graph_helpers.js";

export {
  buildCallGraph,
  getNodeById,
  getDirectCallers,
  getDirectCallees,
  findNodesByName,
  getEdgesBetween,
  serializeFloorPlan,
  deserializeFloorPlan,
} from "./tools/call_graph_builder.js";

export {
  tagSideEffects,
  getSideEffectSummary,
  getHighRiskNodes,
  getSideEffectsByType,
} from "./tools/side_effect_tagger.js";

export {
  mapEntryPoints,
  getEntryPointByName,
  getEntryPointChains,
  getHandlerChainForEntry,
} from "./tools/entry_point_mapper.js";

export {
  tracePaths,
  tracePathsReverse,
  calculateBlastRadius,
  findAllPathsBetween,
  getCallChain,
} from "./tools/path_tracer.js";

export type { FloorPlanManagerOptions } from "./floor_plan_manager.js";
export {
  ensureFloorPlan,
  rebuildFloorPlan,
  formatNode,
} from "./floor_plan_manager.js";
