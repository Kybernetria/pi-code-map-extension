import type { CallGraphNode, FloorPlan } from "../types.js";
import { formatNode } from "../floor_plan_manager.js";
import type { ToolResult } from "./types.js";

export function textResult(text: string, details?: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], details };
}

export function resolveRoot(inputRoot: string | undefined, cwd: string): string {
  return inputRoot || cwd;
}

export function formatNodeLine(node: CallGraphNode): string {
  const effects = node.sideEffects.length
    ? ` effects=${node.sideEffects.map((effect) => `${effect.type}:${effect.riskLevel}`).join(",")}`
    : "";
  return `${node.id} (${node.file}:${node.lineStart})${effects}`;
}

export function formatNodes(nodes: CallGraphNode[]): Record<string, unknown>[] {
  return nodes.map(formatNode);
}

export function summarizeBuild(plan: FloorPlan): string {
  const warnings = [
    plan.meta.warning,
    ...plan.meta.parseErrors.slice(0, 5).map((error) => `${error.file}: ${error.error}`),
  ].filter(Boolean);

  return [
    "Code map built.",
    `- files analyzed: ${plan.meta.fileCount}`,
    `- nodes: ${plan.meta.nodeCount}`,
    `- edges: ${plan.meta.edgeCount}`,
    `- entry points: ${plan.entryPoints.length}`,
    `- scanned dirs: ${(plan.meta.scannedDirs ?? []).join(", ") || "(unknown)"}`,
    `- analysis time: ${plan.meta.analysisTimeMs}ms`,
    warnings.length ? `- warnings: ${warnings.join("; ")}` : "- warnings: none",
  ].join("\n");
}
