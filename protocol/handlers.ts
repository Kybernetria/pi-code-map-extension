/**
 * Protocol handler implementations for pi-code-map-extension.
 *
 * Uses lazy dynamic imports for heavy dependencies (ts-morph via floor_plan_manager)
 * so the extension loads without error even when node_modules are not installed.
 * Dependencies are only resolved when a provide is actually invoked.
 */

type ProtocolHandler = (input: unknown) => unknown | Promise<unknown>;

import type {
  BuildFloorPlanParams,
  FloorPlanToolOptions,
  FunctionLookupParams,
  GetSideEffectsParams,
  ToolResult,
  TraceCallFlowParams,
} from "../src/extension/types.js";

function defaultContext() {
  return { cwd: process.cwd() };
}

function textFrom(result: ToolResult): string {
  return result.content.map((part) => part.text).join("\n");
}

function normalizeResult(result: ToolResult): Record<string, unknown> {
  return { text: textFrom(result), ...(result.details ?? {}) };
}

export async function buildFloorPlanHandler(input: BuildFloorPlanParams): Promise<Record<string, unknown>> {
  const { buildFloorPlan } = await import("../src/extension/queries.js");
  const result = await buildFloorPlan(input, defaultContext());
  return {
    summary: textFrom(result),
    ...(result.details ?? {}),
  };
}

export async function getSideEffectsHandler(input: GetSideEffectsParams): Promise<Record<string, unknown>> {
  const { getSideEffects } = await import("../src/extension/queries.js");
  return normalizeResult(await getSideEffects(input, defaultContext()));
}

export async function traceCallFlowHandler(input: TraceCallFlowParams): Promise<Record<string, unknown>> {
  const { traceCallFlow } = await import("../src/extension/queries.js");
  return normalizeResult(await traceCallFlow(input, defaultContext()));
}

export async function getFunctionCallersHandler(input: FunctionLookupParams): Promise<Record<string, unknown>> {
  const { getFunctionCallers } = await import("../src/extension/queries.js");
  return normalizeResult(await getFunctionCallers(input, defaultContext()));
}

export async function getFunctionCalleesHandler(input: FunctionLookupParams): Promise<Record<string, unknown>> {
  const { getFunctionCallees } = await import("../src/extension/queries.js");
  return normalizeResult(await getFunctionCallees(input, defaultContext()));
}

export async function getEntryPointsHandler(input: FloorPlanToolOptions): Promise<Record<string, unknown>> {
  const { getEntryPoints } = await import("../src/extension/queries.js");
  return normalizeResult(await getEntryPoints(input, defaultContext()));
}

export const handlers: Record<string, ProtocolHandler> = {
  build_floor_plan: buildFloorPlanHandler,
  get_side_effects: getSideEffectsHandler,
  trace_call_flow: traceCallFlowHandler,
  get_function_callers: getFunctionCallersHandler,
  get_function_callees: getFunctionCalleesHandler,
  get_entry_points: getEntryPointsHandler,
};
