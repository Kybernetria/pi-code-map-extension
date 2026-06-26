/**
 * Protocol handler implementations for pi-code-map-extension.
 *
 * The handlers adapt plain pi-protocol JSON input/output to the same query
 * functions used by the Pi extension tools. This keeps the protocol surface
 * and tool surface behavior in lockstep.
 */

import {
  buildFloorPlan,
  getEntryPoints as queryEntryPoints,
  getFunctionCallees as queryFunctionCallees,
  getFunctionCallers as queryFunctionCallers,
  getSideEffects as querySideEffects,
  traceCallFlow as queryTraceCallFlow,
} from "../src/extension/queries.js";
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
  const result = await buildFloorPlan(input, defaultContext());
  return {
    summary: textFrom(result),
    ...(result.details ?? {}),
  };
}

export async function getSideEffectsHandler(input: GetSideEffectsParams): Promise<Record<string, unknown>> {
  return normalizeResult(await querySideEffects(input, defaultContext()));
}

export async function traceCallFlowHandler(input: TraceCallFlowParams): Promise<Record<string, unknown>> {
  return normalizeResult(await queryTraceCallFlow(input, defaultContext()));
}

export async function getFunctionCallersHandler(input: FunctionLookupParams): Promise<Record<string, unknown>> {
  return normalizeResult(await queryFunctionCallers(input, defaultContext()));
}

export async function getFunctionCalleesHandler(input: FunctionLookupParams): Promise<Record<string, unknown>> {
  return normalizeResult(await queryFunctionCallees(input, defaultContext()));
}

export async function getEntryPointsHandler(input: FloorPlanToolOptions): Promise<Record<string, unknown>> {
  return normalizeResult(await queryEntryPoints(input, defaultContext()));
}

export const handlers = {
  build_floor_plan: buildFloorPlanHandler,
  get_side_effects: getSideEffectsHandler,
  trace_call_flow: traceCallFlowHandler,
  get_function_callers: getFunctionCallersHandler,
  get_function_callees: getFunctionCalleesHandler,
  get_entry_points: getEntryPointsHandler,
};
