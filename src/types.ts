/**
 * @fileoverview TypeScript type definitions and interfaces.
 * Key exports: CallableKind, CallGraphNode, CapabilityAnnotation, CallEdge, SideEffectType, SideEffectRisk
 * Side effects: exec, file_write, file_read, db_write, network, console_output, env_access
 */
/**
 * pi-code-map-extension: Core type definitions for function-level codebase structural analysis.
 *
 * These types describe the call graph, side effects, entry points, and query results
 * that pi-floor-plan produces. Used by all floor-plan tools and their consumers
 * (sommelier, dev agents, complexity management).
 */

// ---------------------------------------------------------------------------
// Call Graph Nodes
// ---------------------------------------------------------------------------

/** Kind of callable entity in the codebase */
export type CallableKind =
  | "function"
  | "method"
  | "arrow"
  | "class_constructor"
  | "getter"
  | "setter";

/**
 * A function, method, or callable extracted from the codebase.
 * Each node has a unique ID of the form "relativePath:functionName".
 */
export interface CallGraphNode {
  /** Unique ID: "file:functionName" or "file:ClassName.methodName" */
  id: string;

  /** Function/method name */
  name: string;

  /** Relative file path from project root */
  file: string;

  /** Line number where function starts */
  lineStart: number;

  /** Line number where function ends */
  lineEnd: number;

  /** Function signature (params + return type), truncated to 200 chars */
  signature: string;

  /** Kind of callable */
  kind: CallableKind;

  /** Is this exported from its module? */
  exported: boolean;

  /** Is this async? */
  isAsync: boolean;

  /** Side effects this function performs (populated by side_effect_tagger) */
  sideEffects: SideEffect[];

  /** JSDoc comment if present (first 200 chars) */
  docComment?: string;

  /** Optional protocol/capability annotations from downstream consumers. */
  capabilities?: CapabilityAnnotation[];

  /** True if this node is synthetic (e.g., for anonymous registration handlers) */
  synthetic?: boolean;

  /** Tags for grouping/filtering (e.g., "registration-handler") */
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Protocol Capabilities
// ---------------------------------------------------------------------------

/** Protocol capability metadata attached to a call graph node */
export interface CapabilityAnnotation {
  /** Capability name, when annotated by a downstream protocol mapper. */
  capabilityName: string;

  /** The node that provides this capability */
  nodeId: string;

  /** Effects declared in the manifest */
  declaredEffects: string[];

  /** Model hints from the manifest */
  modelHints?: Record<string, unknown>;

  /** Budget constraints from the manifest */
  budget?: { maxTokensPerCall?: number; maxCallsPerMinute?: number };

  /** Whether the handler function was found in the call graph */
  handlerResolved: boolean;
}

// ---------------------------------------------------------------------------
// Call Edges
// ---------------------------------------------------------------------------

/**
 * A directed edge from one function to another (caller -> callee).
 */
export interface CallEdge {
  /** ID of the calling function */
  callerId: string;

  /** ID of the called function */
  calleeId: string;

  /** Line number of the call site in the caller */
  callSiteLine: number;

  /** Is this an await call? */
  isAsync: boolean;

  /** Is this inside a conditional (if/ternary/switch)? */
  isConditional: boolean;

  /** Is this inside a try block? */
  isInTry: boolean;

  /** Is this inside a loop (for/while/do-while/for-of/for-in)? */
  isInLoop: boolean;

  /** Call expression text, truncated to 100 chars */
  callText: string;
}

// ---------------------------------------------------------------------------
// Side Effects
// ---------------------------------------------------------------------------

/** Categories of side effects we track */
export type SideEffectType =
  | "db_read"        // getDatabase(), db.select, db.prepare().get
  | "db_write"       // db.insert, db.update, db.delete, db.run
  | "api_call"       // fetch(), external API clients
  | "file_read"      // fs.readFileSync, fs.readFile
  | "file_write"     // fs.writeFileSync, fs.writeFile, fs.mkdir
  | "llm_call"       // llmCall(), AI API calls
  | "order_submit"   // submitTradeOrderAlpaca, broker order calls
  | "state_mutation" // modifying module-level variables
  | "env_access"     // process.env access
  | "exec"           // child_process.exec, spawn, execSync
  | "network"        // WebSocket, HTTP server creation
  | "console_output"; // console.log/warn/error (low risk but trackable)

/** Risk level for a side effect */
export type SideEffectRisk = "low" | "medium" | "high" | "critical";

export interface SideEffect {
  type: SideEffectType;

  /** Line number where side effect occurs */
  line: number;

  /** Brief description of the effect */
  description: string;

  /** Risk level */
  riskLevel: SideEffectRisk;
}

// ---------------------------------------------------------------------------
// Entry Points
// ---------------------------------------------------------------------------

/** Type of entry point into the codebase */
export type EntryPointKind =
  | "cli_command"
  | "extension_tool"
  | "api_endpoint"
  | "scheduled_task"
  | "event_handler";

/**
 * An entry point -- a place where external input enters the codebase.
 */
export interface EntryPoint {
  /** Unique identifier */
  id: string;

  /** Type of entry point */
  kind: EntryPointKind;

  /** Name (e.g., "/tray", "audit_package_security") */
  name: string;

  /** File where entry point is registered */
  registrationFile: string;

  /** Handler function ID (links to CallGraphNode.id) */
  handlerId: string;

  /** Description from tool/command metadata */
  description?: string;
}

// ---------------------------------------------------------------------------
// Floor Plan (the complete graph)
// ---------------------------------------------------------------------------

/** Metadata about the floor plan generation */
export interface FloorPlanMeta {
  /** When this floor plan was generated */
  generatedAt: string;

  /** Number of files analyzed */
  fileCount: number;

  /** Total function/callable count */
  nodeCount: number;

  /** Total call edge count */
  edgeCount: number;

  /** Analysis duration in ms */
  analysisTimeMs: number;

  /** Files that failed to parse */
  parseErrors: Array<{ file: string; error: string }>;

  /** Directories actually scanned (for diagnostics) */
  scannedDirs?: string[];

  /** Warning message when 0 nodes found */
  warning?: string;
}

/**
 * Complete floor plan of the codebase -- the full call graph with metadata.
 */
export interface FloorPlan {
  /** All function nodes, keyed by ID */
  nodes: Map<string, CallGraphNode>;

  /** Forward edges: caller ID -> CallEdge[] */
  edges: Map<string, CallEdge[]>;

  /** Reverse edges: callee ID -> caller IDs (for "who calls this" queries) */
  reverseEdges: Map<string, string[]>;

  /** All entry points */
  entryPoints: EntryPoint[];

  /** Metadata */
  meta: FloorPlanMeta;
}

// ---------------------------------------------------------------------------
// Query Results
// ---------------------------------------------------------------------------

/**
 * Result of tracing paths between two functions.
 */
export interface PathTrace {
  /** Starting function ID */
  from: string;

  /** Target function ID */
  to: string;

  /** All paths found (each path is a list of edge steps) */
  paths: CallEdge[][];

  /** Shortest path length (in call hops) */
  shortestPathLength: number;

  /** Did we hit the max depth limit? */
  truncated: boolean;

  /** Max depth we searched */
  maxDepthSearched: number;
}

/**
 * Blast radius analysis result -- what's affected if a function changes.
 */
export interface BlastRadius {
  /** Function that was changed */
  changedFunction: string;

  /** Direct callers (1 hop) */
  directCallers: string[];

  /** All transitive callers (up to maxDepth) */
  transitiveCallers: string[];

  /** Entry points that could be affected */
  affectedEntryPoints: EntryPoint[];

  /** Max depth of impact chain */
  maxImpactDepth: number;

  /** Risk score (0-100) based on side effects in the caller chain */
  riskScore: number;
}

// ---------------------------------------------------------------------------
// Compact representation for AI agent context injection (~2500 tokens)
// ---------------------------------------------------------------------------

/** Module-level summary for compact injection */
export interface ModuleSummary {
  /** Relative path */
  path: string;

  /** Number of functions in this module */
  functionCount: number;

  /** Names of exported functions (up to 8) */
  exportedFunctions: string[];

  /** Summary of side effects: "db_write(3), llm_call(2)" */
  sideEffectSummary: string;
}

/** Entry point chain for compact injection */
export interface EntryPointChain {
  /** Entry point name */
  name: string;

  /** Entry point kind */
  kind: EntryPointKind;

  /** Short call chain: "debateCommand -> runCouncilDebate -> llmCall" */
  chain: string;
}

/**
 * Token-efficient floor plan for system prompt injection.
 * Target: ~2500 tokens.
 */
export interface CompactFloorPlan {
  /** Module summaries (top 30 by function count) */
  modules: ModuleSummary[];

  /** Entry point chains (top 20) */
  entryPointChains: EntryPointChain[];

  /** Functions with critical/high-risk side effects */
  highRiskFunctions: Array<{
    id: string;
    effects: SideEffectType[];
  }>;

  /** Estimated token count */
  estimatedTokens: number;
}

// ---------------------------------------------------------------------------
// Cache types
// ---------------------------------------------------------------------------

/** Per-file cache entry for incremental rebuilds */
export interface FileCacheEntry {
  /** Relative file path */
  filePath: string;

  /** SHA-256 hash of file content */
  contentHash: string;

  /** When this file was last analyzed */
  lastAnalyzed: string;

  /** Number of nodes extracted from this file */
  nodeCount: number;

  /** Number of edges originating from this file */
  edgeCount: number;
}

// ---------------------------------------------------------------------------
// Builder options
// ---------------------------------------------------------------------------

/** Options for building the call graph */
export interface CallGraphBuilderOptions {
  /** Project root directory (default: process.cwd()) */
  rootDir?: string;

  /** Directories to scan (default: ["src", "extensions", "packages", "skills", "shared", "database"]) */
  includeDirs?: string[];

  /** Patterns to exclude (default: ["node_modules", ".git", "dist", ".pi"]) */
  excludePatterns?: string[];

  /** Skip test files (default: true) */
  skipTests?: boolean;

  /** Maximum depth for cross-file resolution (default: 10) */
  maxResolutionDepth?: number;

  /** Use cached results when file hash matches (default: true) */
  useCache?: boolean;

  /** Force rebuild even if cache is valid (default: false) */
  forceRebuild?: boolean;

  /** Informational deadline hint (milliseconds since Unix epoch). */
  deadlineMs?: number;
}
