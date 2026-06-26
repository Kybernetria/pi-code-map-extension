import type { SideEffectRisk } from "../types.js";
import { ensureFloorPlan, rebuildFloorPlan } from "../floor_plan_manager.js";
import { getDirectCallers, getDirectCallees } from "../tools/call_graph_builder.js";
import { tracePaths } from "../tools/path_tracer.js";
import { formatNodeLine, formatNodes, resolveRoot, summarizeBuild, textResult } from "./format.js";
import { resolveNode } from "./resolve.js";
import type {
  BuildFloorPlanParams,
  FloorPlanToolOptions,
  FunctionLookupParams,
  GetSideEffectsParams,
  ToolContext,
  ToolResult,
  TraceCallFlowParams,
} from "./types.js";

const riskRank: Record<SideEffectRisk, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function planOptions(params: FloorPlanToolOptions, ctx: ToolContext) {
  return { rootDir: resolveRoot(params.root_dir, ctx.cwd), includeDirs: params.include_dirs };
}

export async function buildFloorPlan(params: BuildFloorPlanParams, ctx: ToolContext): Promise<ToolResult> {
  const options = planOptions(params, ctx);
  const plan = params.rebuild ? await rebuildFloorPlan(options) : await ensureFloorPlan(options);
  return textResult(summarizeBuild(plan), {
    meta: plan.meta,
    entryPointCount: plan.entryPoints.length,
  });
}

export async function getSideEffects(params: GetSideEffectsParams, ctx: ToolContext): Promise<ToolResult> {
  const plan = await ensureFloorPlan(planOptions(params, ctx));
  const minRank = params.min_risk ? riskRank[params.min_risk] : 1;
  const nodes = Array.from(plan.nodes.values())
    .filter((node) => node.sideEffects.some((effect) => (!params.type || effect.type === params.type) && riskRank[effect.riskLevel] >= minRank))
    .sort((a, b) => Math.max(...b.sideEffects.map((effect) => riskRank[effect.riskLevel]), 0) - Math.max(...a.sideEffects.map((effect) => riskRank[effect.riskLevel]), 0))
    .slice(0, params.limit ?? 50);

  return textResult(
    nodes.length ? nodes.map(formatNodeLine).join("\n") : "No matching side effects found.",
    { nodes: formatNodes(nodes) },
  );
}

export async function traceCallFlow(params: TraceCallFlowParams, ctx: ToolContext): Promise<ToolResult> {
  const plan = await ensureFloorPlan(planOptions(params, ctx));
  const from = resolveNode(plan, params.from);
  const to = resolveNode(plan, params.to);
  if (!from.node || !to.node) {
    return textResult("Could not resolve unique from/to nodes.", {
      fromMatches: formatNodes(from.matches),
      toMatches: formatNodes(to.matches),
    });
  }

  const trace = tracePaths(plan, from.node.id, to.node.id, params.max_depth ?? 10);
  const paths = trace.paths.slice(0, params.max_paths ?? 5).map((path) => path.map((edge) => ({
    from: edge.callerId,
    to: edge.calleeId,
    line: edge.callSiteLine,
    call: edge.callText,
  })));
  const pathText = paths.length
    ? paths.map((path, index) => `${index + 1}. ${[path[0]?.from, ...path.map((step) => step.to)].filter(Boolean).join(" -> ")}`).join("\n")
    : "No call path found.";

  return textResult(pathText, { trace: { ...trace, paths } });
}

export async function getFunctionCallers(params: FunctionLookupParams, ctx: ToolContext): Promise<ToolResult> {
  const plan = await ensureFloorPlan(planOptions(params, ctx));
  const resolved = resolveNode(plan, params.function);
  if (!resolved.node) return textResult("Could not resolve a unique function.", { matches: formatNodes(resolved.matches) });

  const nodes = getDirectCallers(plan, resolved.node.id);
  return textResult(nodes.map(formatNodeLine).join("\n") || "No direct callers found.", { nodes: formatNodes(nodes) });
}

export async function getFunctionCallees(params: FunctionLookupParams, ctx: ToolContext): Promise<ToolResult> {
  const plan = await ensureFloorPlan(planOptions(params, ctx));
  const resolved = resolveNode(plan, params.function);
  if (!resolved.node) return textResult("Could not resolve a unique function.", { matches: formatNodes(resolved.matches) });

  const nodes = getDirectCallees(plan, resolved.node.id);
  return textResult(nodes.map(formatNodeLine).join("\n") || "No direct callees found.", { nodes: formatNodes(nodes) });
}

export async function getEntryPoints(params: FloorPlanToolOptions, ctx: ToolContext): Promise<ToolResult> {
  const plan = await ensureFloorPlan(planOptions(params, ctx));
  const lines = plan.entryPoints.map((entryPoint) => `${entryPoint.kind} ${entryPoint.name} -> ${entryPoint.handlerId} (${entryPoint.registrationFile})`);
  return textResult(lines.join("\n") || "No entry points detected.", { entryPoints: plan.entryPoints });
}
