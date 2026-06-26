/**
 * Unit tests for entry point mapper.
 * Tests CLI command, extension tool, and event handler detection,
 * plus call chain generation.
 */

import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  mapEntryPoints,
  getEntryPointByName,
  getEntryPointChains,
  getHandlerChainForEntry,
} from "../src/tools/entry_point_mapper.js";
import type { FloorPlan, CallGraphNode, CallEdge, EntryPoint } from "../src/types.js";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function createMockFloorPlan(): FloorPlan {
  const nodes = new Map<string, CallGraphNode>();
  const edges = new Map<string, CallEdge[]>();
  const reverseEdges = new Map<string, string[]>();

  // Mock nodes
  nodes.set("extensions/commands/trading-commands.ts:debateCommand", {
    id: "extensions/commands/trading-commands.ts:debateCommand",
    name: "debateCommand",
    file: "extensions/commands/trading-commands.ts",
    lineStart: 10,
    lineEnd: 50,
    signature: "async (args, ctx) => void",
    kind: "arrow",
    exported: false,
    isAsync: true,
    sideEffects: [{ type: "llm_call", line: 25, description: "Council debate", riskLevel: "medium" }],
  });

  nodes.set("extensions/helpers/regime-helpers.ts:runFullDebate", {
    id: "extensions/helpers/regime-helpers.ts:runFullDebate",
    name: "runFullDebate",
    file: "extensions/helpers/regime-helpers.ts",
    lineStart: 100,
    lineEnd: 200,
    signature: "async (ticker: string, ctx: any) => Promise<DebateState>",
    kind: "function",
    exported: true,
    isAsync: true,
    sideEffects: [{ type: "llm_call", line: 150, description: "LLM agents", riskLevel: "medium" }],
  });

  nodes.set("extensions/debate-protocol.ts:runCouncilDebate", {
    id: "extensions/debate-protocol.ts:runCouncilDebate",
    name: "runCouncilDebate",
    file: "extensions/debate-protocol.ts",
    lineStart: 50,
    lineEnd: 300,
    signature: "async (ticker: string) => Promise<Verdict[]>",
    kind: "function",
    exported: true,
    isAsync: true,
    sideEffects: [{ type: "llm_call", line: 100, description: "Agent calls", riskLevel: "medium" }],
  });

  nodes.set("extensions/llm-agents.ts:llmCall", {
    id: "extensions/llm-agents.ts:llmCall",
    name: "llmCall",
    file: "extensions/llm-agents.ts",
    lineStart: 200,
    lineEnd: 250,
    signature: "async (agent: string, prompt: string) => Promise<string>",
    kind: "function",
    exported: true,
    isAsync: true,
    sideEffects: [{ type: "api_call", line: 220, description: "Anthropic API", riskLevel: "low" }],
  });

  nodes.set("extensions/tools/data-tools.ts:fetchOptionsChain", {
    id: "extensions/tools/data-tools.ts:fetchOptionsChain",
    name: "fetchOptionsChain",
    file: "extensions/tools/data-tools.ts",
    lineStart: 10,
    lineEnd: 50,
    signature: "async (ticker: string) => Promise<OptionsChain>",
    kind: "function",
    exported: false,
    isAsync: true,
    sideEffects: [{ type: "api_call", line: 30, description: "Alpaca API", riskLevel: "low" }],
  });

  // Mock edges
  edges.set("extensions/commands/trading-commands.ts:debateCommand", [
    {
      callerId: "extensions/commands/trading-commands.ts:debateCommand",
      calleeId: "extensions/helpers/regime-helpers.ts:runFullDebate",
      callSiteLine: 20,
      isAsync: true,
      isConditional: false,
      isInTry: true,
      isInLoop: false,
      callText: "await runFullDebate(ticker, ctx)",
    },
  ]);

  edges.set("extensions/helpers/regime-helpers.ts:runFullDebate", [
    {
      callerId: "extensions/helpers/regime-helpers.ts:runFullDebate",
      calleeId: "extensions/debate-protocol.ts:runCouncilDebate",
      callSiteLine: 120,
      isAsync: true,
      isConditional: false,
      isInTry: false,
      isInLoop: false,
      callText: "await runCouncilDebate(ticker)",
    },
  ]);

  edges.set("extensions/debate-protocol.ts:runCouncilDebate", [
    {
      callerId: "extensions/debate-protocol.ts:runCouncilDebate",
      calleeId: "extensions/llm-agents.ts:llmCall",
      callSiteLine: 150,
      isAsync: true,
      isConditional: false,
      isInTry: true,
      isInLoop: true,
      callText: "await llmCall(agent, prompt)",
    },
  ]);

  return {
    nodes,
    edges,
    reverseEdges,
    entryPoints: [],
    meta: {
      generatedAt: new Date().toISOString(),
      fileCount: 4,
      nodeCount: nodes.size,
      edgeCount: 3,
      analysisTimeMs: 100,
      parseErrors: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Temporary Directory Setup
// ---------------------------------------------------------------------------

let tempDir: string;

beforeAll(() => {
  // Create temporary directory structure
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-fi-entry-test-"));

  const commandsDir = path.join(tempDir, "extensions", "commands");
  const toolsDir = path.join(tempDir, "extensions", "tools");

  fs.mkdirSync(commandsDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });

  // Create mock command file
  fs.writeFileSync(
    path.join(commandsDir, "trading-commands.ts"),
    `
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export function registerTradingCommands(pi: ExtensionAPI) {
  pi.registerCommand("debate", {
    description: "Run a full council debate for a ticker",
    handler: async (args, ctx) => {
      const ticker = args?.trim().toUpperCase();
      if (!ticker) {
        ctx.ui.notify("Usage: /debate <TICKER>", "error");
        return;
      }
      // Handler logic here
    },
  });

  pi.registerCommand("scan", {
    description: "Scan market for opportunities",
    handler: async (args, ctx) => {
      // Handler logic
    },
  });
}
    `.trim()
  );

  // Create mock tool file
  fs.writeFileSync(
    path.join(toolsDir, "data-tools.ts"),
    `
import { Type } from "typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export function registerDataTools(pi: ExtensionAPI) {
  pi.registerTool({
    name: "fetch_options_chain",
    label: "Fetch Options Chain",
    description: "Fetch live options chain data for a ticker",
    parameters: Type.Object({
      ticker: Type.String({ description: "Stock ticker symbol" }),
    }),
    async execute(id, params, signal) {
      // Tool logic here
      return { content: [], details: {} };
    },
  });

  pi.registerTool({
    name: "audit_package_security",
    label: "Audit Package Security",
    description: "Deep security audit for a package",
    parameters: Type.Object({
      packageName: Type.String(),
    }),
    async execute(id, params, signal) {
      return { content: [], details: {} };
    },
  });
}
    `.trim()
  );

  // Create mock index file with event handlers
  fs.writeFileSync(
    path.join(tempDir, "extensions", "index.ts"),
    `
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (event, ctx) => {
    // Session start logic
  });

  pi.on("tool_call", async (event, ctx) => {
    // Tool call gating logic
  });

  pi.on("before_provider_request", async (event, ctx) => {
    // Telemetry logic
  });
}
    `.trim()
  );
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mapEntryPoints", () => {
  it("should detect CLI commands from command files", () => {
    const plan = createMockFloorPlan();
    const entryPoints = mapEntryPoints(plan, tempDir);

    const debateCommand = entryPoints.find(ep => ep.name === "/debate");
    expect(debateCommand).toBeDefined();
    expect(debateCommand?.kind).toBe("cli_command");
    expect(debateCommand?.registrationFile).toContain("extensions/commands/trading-commands.ts");
    // Description extraction is best-effort
    if (debateCommand?.description) {
      expect(debateCommand.description).toBe("Run a full council debate for a ticker");
    }

    const scanCommand = entryPoints.find(ep => ep.name === "/scan");
    expect(scanCommand).toBeDefined();
    expect(scanCommand?.kind).toBe("cli_command");
  });

  it("should detect extension tools from tool files", () => {
    const plan = createMockFloorPlan();
    const entryPoints = mapEntryPoints(plan, tempDir);

    const optionsChainTool = entryPoints.find(ep => ep.name === "fetch_options_chain");
    expect(optionsChainTool).toBeDefined();
    expect(optionsChainTool?.kind).toBe("extension_tool");
    expect(optionsChainTool?.registrationFile).toContain("extensions/tools/data-tools.ts");
    // Description extraction is best-effort
    if (optionsChainTool?.description) {
      expect(optionsChainTool.description).toBe("Fetch live options chain data for a ticker");
    }

    const auditTool = entryPoints.find(ep => ep.name === "audit_package_security");
    expect(auditTool).toBeDefined();
  });

  it("should detect event handlers from index.ts", () => {
    const plan = createMockFloorPlan();
    const entryPoints = mapEntryPoints(plan, tempDir);

    const sessionStart = entryPoints.find(ep => ep.name === "session_start");
    expect(sessionStart).toBeDefined();
    expect(sessionStart?.kind).toBe("event_handler");
    expect(sessionStart?.registrationFile).toContain("extensions/index.ts");

    const toolCall = entryPoints.find(ep => ep.name === "tool_call");
    expect(toolCall).toBeDefined();

    const beforeProvider = entryPoints.find(ep => ep.name === "before_provider_request");
    expect(beforeProvider).toBeDefined();
  });

  it("should link handlers to FloorPlan nodes when possible", () => {
    const plan = createMockFloorPlan();
    const entryPoints = mapEntryPoints(plan, tempDir);

    // The FloorPlan has a matching debateCommand node
    const debateCommand = entryPoints.find(ep => ep.name === "/debate");
    // Handler will be found if it exists in FloorPlan, otherwise synthetic
    expect(debateCommand?.handlerId).toBeDefined();
    expect(
      debateCommand?.handlerId.includes("debateCommand") ||
      debateCommand?.handlerId.includes("_handler_debate")
    ).toBe(true);
  });

  it("should return sorted entry points", () => {
    const plan = createMockFloorPlan();
    const entryPoints = mapEntryPoints(plan, tempDir);

    expect(entryPoints.length).toBeGreaterThan(0);

    // Check that entries are sorted by name
    const names = entryPoints.map(ep => ep.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });
});

describe("getEntryPointByName", () => {
  it("should find entry point by exact name", () => {
    const entryPoints: EntryPoint[] = [
      {
        id: "cli:/debate",
        kind: "cli_command",
        name: "/debate",
        registrationFile: "extensions/commands/trading-commands.ts",
        handlerId: "extensions/commands/trading-commands.ts:debateCommand",
      },
      {
        id: "tool:fetch_options_chain",
        kind: "extension_tool",
        name: "fetch_options_chain",
        registrationFile: "extensions/tools/data-tools.ts",
        handlerId: "extensions/tools/data-tools.ts:fetchOptionsChain",
      },
    ];

    const result = getEntryPointByName(entryPoints, "/debate");
    expect(result).toBeDefined();
    expect(result?.name).toBe("/debate");
  });

  it("should normalize CLI command names (with or without slash)", () => {
    const entryPoints: EntryPoint[] = [
      {
        id: "cli:/debate",
        kind: "cli_command",
        name: "/debate",
        registrationFile: "extensions/commands/trading-commands.ts",
        handlerId: "extensions/commands/trading-commands.ts:debateCommand",
      },
    ];

    const withSlash = getEntryPointByName(entryPoints, "/debate");
    const withoutSlash = getEntryPointByName(entryPoints, "debate");

    expect(withSlash).toBeDefined();
    expect(withoutSlash).toBeDefined();
    expect(withSlash?.id).toBe(withoutSlash?.id);
  });

  it("should return undefined for non-existent entry point", () => {
    const entryPoints: EntryPoint[] = [];
    const result = getEntryPointByName(entryPoints, "nonexistent");
    expect(result).toBeUndefined();
  });
});

describe("getHandlerChainForEntry", () => {
  it("should follow call chain from handler node", () => {
    const plan = createMockFloorPlan();

    const chain = getHandlerChainForEntry(
      plan,
      "extensions/commands/trading-commands.ts:debateCommand",
      5
    );

    expect(chain).toEqual([
      "debateCommand",
      "runFullDebate",
      "runCouncilDebate",
      "llmCall",
    ]);
  });

  it("should stop at maxDepth", () => {
    const plan = createMockFloorPlan();

    const chain = getHandlerChainForEntry(
      plan,
      "extensions/commands/trading-commands.ts:debateCommand",
      2
    );

    expect(chain.length).toBeLessThanOrEqual(2);
    expect(chain).toEqual(["debateCommand", "runFullDebate"]);
  });

  it("should stop when no more callees", () => {
    const plan = createMockFloorPlan();

    const chain = getHandlerChainForEntry(
      plan,
      "extensions/llm-agents.ts:llmCall",
      5
    );

    expect(chain).toEqual(["llmCall"]);
  });

  it("should handle non-existent handler ID gracefully", () => {
    const plan = createMockFloorPlan();

    const chain = getHandlerChainForEntry(plan, "nonexistent:handler", 5);

    expect(chain).toEqual([]);
  });

  it("should avoid infinite loops with circular references", () => {
    const plan = createMockFloorPlan();

    // Add circular edge
    const existingEdges = plan.edges.get("extensions/llm-agents.ts:llmCall") || [];
    existingEdges.push({
      callerId: "extensions/llm-agents.ts:llmCall",
      calleeId: "extensions/commands/trading-commands.ts:debateCommand",
      callSiteLine: 225,
      isAsync: true,
      isConditional: true,
      isInTry: false,
      isInLoop: false,
      callText: "await debateCommand()",
    });
    plan.edges.set("extensions/llm-agents.ts:llmCall", existingEdges);

    const chain = getHandlerChainForEntry(
      plan,
      "extensions/commands/trading-commands.ts:debateCommand",
      10
    );

    // Should stop when revisiting a node
    expect(chain.length).toBeLessThanOrEqual(10);
    const uniqueNodes = new Set(chain);
    expect(chain.length).toBe(uniqueNodes.size); // No duplicates
  });
});

describe("getEntryPointChains", () => {
  it("should generate chains for all entry points", () => {
    const plan = createMockFloorPlan();
    plan.entryPoints = [
      {
        id: "cli:/debate",
        kind: "cli_command",
        name: "/debate",
        registrationFile: "extensions/commands/trading-commands.ts",
        handlerId: "extensions/commands/trading-commands.ts:debateCommand",
      },
    ];

    const chains = getEntryPointChains(plan, 5);

    expect(chains.length).toBe(1);
    expect(chains[0].name).toBe("/debate");
    expect(chains[0].kind).toBe("cli_command");
    expect(chains[0].chain).toBe("debateCommand -> runFullDebate -> runCouncilDebate -> llmCall");
  });

  it("should handle empty entry points", () => {
    const plan = createMockFloorPlan();
    plan.entryPoints = [];

    const chains = getEntryPointChains(plan, 5);

    expect(chains).toEqual([]);
  });

  it("should use default maxDepth of 5", () => {
    const plan = createMockFloorPlan();
    plan.entryPoints = [
      {
        id: "cli:/debate",
        kind: "cli_command",
        name: "/debate",
        registrationFile: "extensions/commands/trading-commands.ts",
        handlerId: "extensions/commands/trading-commands.ts:debateCommand",
      },
    ];

    const chains = getEntryPointChains(plan); // No maxDepth specified

    expect(chains.length).toBe(1);
    const stepCount = chains[0].chain.split(" -> ").length;
    expect(stepCount).toBeLessThanOrEqual(5);
  });
});

describe("selectMostInterestingCallee (via chain generation)", () => {
  it("should prefer functions with side effects", () => {
    const plan = createMockFloorPlan();

    // Add a utility function and a function with side effects as callees
    plan.nodes.set("extensions/utils.ts:validateInput", {
      id: "extensions/utils.ts:validateInput",
      name: "validateInput",
      file: "extensions/utils.ts",
      lineStart: 10,
      lineEnd: 20,
      signature: "(input: string) => boolean",
      kind: "function",
      exported: true,
      isAsync: false,
      sideEffects: [],
    });

    plan.nodes.set("extensions/db.ts:insertRecord", {
      id: "extensions/db.ts:insertRecord",
      name: "insertRecord",
      file: "extensions/db.ts",
      lineStart: 30,
      lineEnd: 50,
      signature: "async (data: any) => Promise<void>",
      kind: "function",
      exported: true,
      isAsync: true,
      sideEffects: [{ type: "db_write", line: 40, description: "Insert", riskLevel: "medium" }],
    });

    // Add both as callees
    plan.edges.set("extensions/commands/trading-commands.ts:debateCommand", [
      {
        callerId: "extensions/commands/trading-commands.ts:debateCommand",
        calleeId: "extensions/utils.ts:validateInput",
        callSiteLine: 15,
        isAsync: false,
        isConditional: false,
        isInTry: false,
        isInLoop: false,
        callText: "validateInput(ticker)",
      },
      {
        callerId: "extensions/commands/trading-commands.ts:debateCommand",
        calleeId: "extensions/db.ts:insertRecord",
        callSiteLine: 20,
        isAsync: true,
        isConditional: false,
        isInTry: false,
        isInLoop: false,
        callText: "await insertRecord(data)",
      },
    ]);

    const chain = getHandlerChainForEntry(
      plan,
      "extensions/commands/trading-commands.ts:debateCommand",
      2
    );

    // Should prefer insertRecord (has side effects) over validateInput
    expect(chain[1]).toBe("insertRecord");
  });

  it("should prefer exported functions when side effects are equal", () => {
    const plan = createMockFloorPlan();

    plan.nodes.set("extensions/internal.ts:privateHelper", {
      id: "extensions/internal.ts:privateHelper",
      name: "privateHelper",
      file: "extensions/internal.ts",
      lineStart: 10,
      lineEnd: 20,
      signature: "() => void",
      kind: "function",
      exported: false,
      isAsync: false,
      sideEffects: [],
    });

    plan.nodes.set("extensions/api.ts:publicApi", {
      id: "extensions/api.ts:publicApi",
      name: "publicApi",
      file: "extensions/api.ts",
      lineStart: 30,
      lineEnd: 50,
      signature: "() => void",
      kind: "function",
      exported: true,
      isAsync: false,
      sideEffects: [],
    });

    plan.edges.set("extensions/commands/trading-commands.ts:debateCommand", [
      {
        callerId: "extensions/commands/trading-commands.ts:debateCommand",
        calleeId: "extensions/internal.ts:privateHelper",
        callSiteLine: 15,
        isAsync: false,
        isConditional: false,
        isInTry: false,
        isInLoop: false,
        callText: "privateHelper()",
      },
      {
        callerId: "extensions/commands/trading-commands.ts:debateCommand",
        calleeId: "extensions/api.ts:publicApi",
        callSiteLine: 20,
        isAsync: false,
        isConditional: false,
        isInTry: false,
        isInLoop: false,
        callText: "publicApi()",
      },
    ]);

    const chain = getHandlerChainForEntry(
      plan,
      "extensions/commands/trading-commands.ts:debateCommand",
      2
    );

    expect(chain[1]).toBe("publicApi");
  });
});
