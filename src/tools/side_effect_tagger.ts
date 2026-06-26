/**
 * @fileoverview side_effect_tagger — tagSideEffects, getSideEffectSummary, getHighRiskNodes.
 * Key exports: tagSideEffects, getSideEffectSummary, getHighRiskNodes, getSideEffectsByType
 * Depends on: node:fs, node:path
 * Side effects: exec, file_write, file_read
 */
/**
 * side_effect_tagger.ts - Side effect detection for call graph nodes
 *
 * Scans function bodies for side effect patterns and populates each
 * CallGraphNode.sideEffects array. Uses regex-based detection on source code.
 *
 * Part of pi-floor-plan Phase 1 -- transforms the call graph into a
 * side-effect-aware structure for risk analysis and blast radius calculation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  CallGraphNode,
  SideEffect,
  SideEffectType,
  SideEffectRisk,
  FloorPlan,
} from "../types.js";

// ---------------------------------------------------------------------------
// Side Effect Detection Patterns
// ---------------------------------------------------------------------------

interface SideEffectPattern {
  type: SideEffectType;
  patterns: RegExp[];
  riskLevel: SideEffectRisk;
  descriptionTemplate: string;
}

const SIDE_EFFECT_PATTERNS: SideEffectPattern[] = [
  {
    type: "db_write",
    patterns: [
      /\.insertInto\(/,
      /\.updateTable\(/,
      /\.deleteFrom\(/,
      /\.run\(/,
      /db\.exec\(/,
    ],
    riskLevel: "high",
    descriptionTemplate: "Database write operation",
  },
  {
    type: "db_read",
    patterns: [
      /\.selectFrom\(/,
      /\.prepare\(.*?\)\.get\(/,
      /\.prepare\(.*?\)\.all\(/,
      /getDatabase\(\)/,
    ],
    riskLevel: "low",
    descriptionTemplate: "Database read operation",
  },
  {
    type: "llm_call",
    patterns: [
      /llmCall\(/,
      /anthropic\.messages\.create\(/,
      /openai\.(chat\.)?completions\.create\(/,
      /generateText\(/,
      /streamText\(/,
    ],
    riskLevel: "high",
    descriptionTemplate: "LLM API call",
  },
  {
    type: "order_submit",
    patterns: [/submitTradeOrder/, /alpacaClient/, /placeOrder\(/],
    riskLevel: "critical",
    descriptionTemplate: "Trade order submission",
  },
  {
    type: "api_call",
    patterns: [
      /\bfetch\(/,
      /axios\./,
      /\.get\(.*https?:/,
      /\.post\(.*https?:/,
    ],
    riskLevel: "medium",
    descriptionTemplate: "External API call",
  },
  {
    type: "file_write",
    patterns: [
      /fs\.writeFileSync\(/,
      /fs\.writeFile\(/,
      /fs\.mkdirSync\(/,
      /fs\.appendFileSync\(/,
      /\bwriteFileSync\(/,
      /\bwriteFile\(/,
      /\bappendFileSync\(/,
    ],
    riskLevel: "medium",
    descriptionTemplate: "File system write",
  },
  {
    type: "file_read",
    patterns: [
      /fs\.readFileSync\(/,
      /fs\.readFile\(/,
      /fs\.readdirSync\(/,
      /fs\.existsSync\(/,
      /\breadFileSync\(/,
      /\breadFile\(/,
      /\breaddirSync\(/,
    ],
    riskLevel: "low",
    descriptionTemplate: "File system read",
  },
  {
    type: "exec",
    patterns: [/child_process/, /execSync\(/, /spawn\(/, /spawnSync\(/, /execFile\(/, /exec\(/],
    riskLevel: "high",
    descriptionTemplate: "Process execution",
  },
  {
    type: "env_access",
    patterns: [/process\.env\./, /process\.env\[/],
    riskLevel: "low",
    descriptionTemplate: "Environment variable access",
  },
  {
    type: "state_mutation",
    patterns: [/\bmodule\.\w+\s*=/],
    riskLevel: "medium",
    descriptionTemplate: "Module state mutation",
  },
  {
    type: "network",
    patterns: [/new WebSocket\(/, /createServer\(/, /\.listen\(/],
    riskLevel: "high",
    descriptionTemplate: "Network connection",
  },
  {
    type: "console_output",
    patterns: [/console\.(log|warn|error|info|debug)\(/],
    riskLevel: "low",
    descriptionTemplate: "Console output",
  },
];

// ---------------------------------------------------------------------------
// Side Effect Detection
// ---------------------------------------------------------------------------

/**
 * Detect side effects in a slice of source code.
 * Returns array of SideEffect entries (deduplicated by type).
 */
function detectSideEffects(
  lines: string[],
  startLine: number
): SideEffect[] {
  const effects: SideEffect[] = [];
  const seenTypes = new Set<SideEffectType>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = startLine + i;

    for (const pattern of SIDE_EFFECT_PATTERNS) {
      // Skip if we already found this effect type
      if (seenTypes.has(pattern.type)) {
        continue;
      }

      // Test all patterns for this type
      const matched = pattern.patterns.some((regex) => regex.test(line));

      if (matched) {
        effects.push({
          type: pattern.type,
          line: lineNumber,
          description: pattern.descriptionTemplate,
          riskLevel: pattern.riskLevel,
        });
        seenTypes.add(pattern.type);
      }
    }
  }

  return effects;
}

// ---------------------------------------------------------------------------
// File Cache
// ---------------------------------------------------------------------------

interface FileCache {
  content: string;
  lines: string[];
}

const fileCache = new Map<string, FileCache>();

/**
 * Get file content and split into lines (cached).
 */
function getFileLines(filePath: string): string[] | undefined {
  const cached = fileCache.get(filePath);
  if (cached) {
    return cached.lines;
  }

  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    fileCache.set(filePath, { content, lines });
    return lines;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Main Tagging Function
// ---------------------------------------------------------------------------

/**
 * Tag side effects for all nodes in a FloorPlan.
 * Does NOT mutate input -- returns new FloorPlan with updated nodes.
 */
export function tagSideEffects(
  plan: FloorPlan,
  rootDir: string = process.cwd()
): FloorPlan {
  // Clear file cache for fresh run
  fileCache.clear();

  // Group nodes by file
  const nodesByFile = new Map<string, CallGraphNode[]>();
  for (const node of Array.from(plan.nodes.values())) {
    const nodes = nodesByFile.get(node.file) || [];
    nodes.push(node);
    nodesByFile.set(node.file, nodes);
  }

  // Create new node map with side effects populated
  const newNodes = new Map<string, CallGraphNode>();

  for (const [relativeFile, nodes] of Array.from(nodesByFile.entries())) {
    const absolutePath = path.join(rootDir, relativeFile);
    const fileLines = getFileLines(absolutePath);

    if (!fileLines) {
      // File not found or read error -- keep nodes unchanged
      for (const node of nodes) {
        newNodes.set(node.id, node);
      }
      continue;
    }

    for (const node of nodes) {
      // Extract function body lines (1-indexed to 0-indexed)
      const startIdx = node.lineStart - 1;
      const endIdx = node.lineEnd - 1;

      if (startIdx < 0 || endIdx >= fileLines.length || startIdx > endIdx) {
        // Invalid line range -- keep node unchanged
        newNodes.set(node.id, node);
        continue;
      }

      const bodyLines = fileLines.slice(startIdx, endIdx + 1);
      const effects = detectSideEffects(bodyLines, node.lineStart);

      // Create new node with side effects populated
      newNodes.set(node.id, {
        ...node,
        sideEffects: effects,
      });
    }
  }

  // Return new FloorPlan with updated nodes
  return {
    nodes: newNodes,
    edges: plan.edges,
    reverseEdges: plan.reverseEdges,
    entryPoints: plan.entryPoints,
    meta: plan.meta,
  };
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Get a summary string of side effects for a node.
 * Format: "db_write(3), llm_call(1)"
 */
export function getSideEffectSummary(node: CallGraphNode): string {
  if (node.sideEffects.length === 0) {
    return "";
  }

  // Count effects by type
  const counts = new Map<SideEffectType, number>();
  for (const effect of node.sideEffects) {
    counts.set(effect.type, (counts.get(effect.type) || 0) + 1);
  }

  // Format as "type(count), type(count), ..."
  const parts: string[] = [];
  for (const [type, count] of Array.from(counts.entries())) {
    parts.push(`${type}(${count})`);
  }

  return parts.join(", ");
}

/**
 * Get all nodes with critical or high risk side effects.
 */
export function getHighRiskNodes(plan: FloorPlan): CallGraphNode[] {
  const highRisk: CallGraphNode[] = [];

  for (const node of Array.from(plan.nodes.values())) {
    const hasCritical = node.sideEffects.some(
      (e) => e.riskLevel === "critical"
    );
    const hasHigh = node.sideEffects.some((e) => e.riskLevel === "high");

    if (hasCritical || hasHigh) {
      highRisk.push(node);
    }
  }

  return highRisk;
}

/**
 * Get all nodes with a specific side effect type.
 */
export function getSideEffectsByType(
  plan: FloorPlan,
  type: SideEffectType
): CallGraphNode[] {
  const result: CallGraphNode[] = [];

  for (const node of Array.from(plan.nodes.values())) {
    const hasType = node.sideEffects.some((e) => e.type === type);
    if (hasType) {
      result.push(node);
    }
  }

  return result;
}
