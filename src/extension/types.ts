import type { SideEffectRisk, SideEffectType } from "../types.js";

export interface ToolContext {
  cwd: string;
}

export interface FloorPlanToolOptions {
  root_dir?: string;
  include_dirs?: string[];
}

export interface BuildFloorPlanParams extends FloorPlanToolOptions {
  rebuild?: boolean;
}

export interface GetSideEffectsParams extends FloorPlanToolOptions {
  type?: SideEffectType;
  min_risk?: SideEffectRisk;
  limit?: number;
}

export interface TraceCallFlowParams extends FloorPlanToolOptions {
  from: string;
  to: string;
  max_depth?: number;
  max_paths?: number;
}

export interface FunctionLookupParams extends FloorPlanToolOptions {
  function: string;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details?: Record<string, unknown>;
}
