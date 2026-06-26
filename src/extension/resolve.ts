import type { CallGraphNode, FloorPlan } from "../types.js";
import { findNodesByName } from "../tools/call_graph_builder.js";

export interface ResolvedNodeQuery {
  node?: CallGraphNode;
  matches: CallGraphNode[];
}

export function resolveNode(plan: FloorPlan, query: string): ResolvedNodeQuery {
  const exact = plan.nodes.get(query);
  if (exact) return { node: exact, matches: [exact] };

  const matches = findNodesByName(plan, query);
  if (matches.length === 1) return { node: matches[0], matches };

  const exactName = matches.filter((node) => node.name === query || node.id.endsWith(`:${query}`));
  if (exactName.length === 1) return { node: exactName[0], matches };

  return { matches };
}
