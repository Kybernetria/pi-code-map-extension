/**
 * Unit tests for side_effect_tagger.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  tagSideEffects,
  getSideEffectSummary,
  getHighRiskNodes,
  getSideEffectsByType,
} from "../src/tools/side_effect_tagger.js";
import type {
  FloorPlan,
  CallGraphNode,
  SideEffectType,
} from "../src/types.js";

describe("side_effect_tagger", () => {
  let tempDir: string;
  let testFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "side-effect-test-"));
    testFile = path.join(tempDir, "test.ts");
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createMockFloorPlan(
    nodes: CallGraphNode[]
  ): FloorPlan {
    const nodeMap = new Map<string, CallGraphNode>();
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    return {
      nodes: nodeMap,
      edges: new Map(),
      reverseEdges: new Map(),
      entryPoints: [],
      meta: {
        generatedAt: new Date().toISOString(),
        fileCount: 1,
        nodeCount: nodes.length,
        edgeCount: 0,
        analysisTimeMs: 0,
        parseErrors: [],
      },
    };
  }

  function createMockNode(
    id: string,
    file: string,
    lineStart: number,
    lineEnd: number
  ): CallGraphNode {
    return {
      id,
      name: "testFunc",
      file,
      lineStart,
      lineEnd,
      signature: "() => void",
      kind: "function",
      exported: true,
      isAsync: false,
      sideEffects: [],
    };
  }

  describe("tagSideEffects", () => {
    it("should detect db_write side effects", () => {
      const source = `
function writeToDb() {
  db.insertInto("users").values({ name: "test" });
}
`;
      fs.writeFileSync(testFile, source);

      const node = createMockNode("test.ts:writeToDb", "test.ts", 2, 4);
      const plan = createMockFloorPlan([node]);
      const tagged = tagSideEffects(plan, tempDir);

      const taggedNode = tagged.nodes.get(node.id)!;
      expect(taggedNode.sideEffects).toHaveLength(1);
      expect(taggedNode.sideEffects[0].type).toBe("db_write");
      expect(taggedNode.sideEffects[0].riskLevel).toBe("high");
    });

    it("should detect db_read side effects", () => {
      const source = `
function readFromDb() {
  const result = db.selectFrom("users").selectAll().execute();
}
`;
      fs.writeFileSync(testFile, source);

      const node = createMockNode("test.ts:readFromDb", "test.ts", 2, 4);
      const plan = createMockFloorPlan([node]);
      const tagged = tagSideEffects(plan, tempDir);

      const taggedNode = tagged.nodes.get(node.id)!;
      expect(taggedNode.sideEffects).toHaveLength(1);
      expect(taggedNode.sideEffects[0].type).toBe("db_read");
      expect(taggedNode.sideEffects[0].riskLevel).toBe("low");
    });

    it("should detect llm_call side effects", () => {
      const source = `
async function callLLM() {
  const response = await llmCall("gpt-4", "test prompt");
}
`;
      fs.writeFileSync(testFile, source);

      const node = createMockNode("test.ts:callLLM", "test.ts", 2, 4);
      const plan = createMockFloorPlan([node]);
      const tagged = tagSideEffects(plan, tempDir);

      const taggedNode = tagged.nodes.get(node.id)!;
      expect(taggedNode.sideEffects).toHaveLength(1);
      expect(taggedNode.sideEffects[0].type).toBe("llm_call");
      expect(taggedNode.sideEffects[0].riskLevel).toBe("high");
    });

    it("should detect order_submit side effects as critical", () => {
      const source = `
async function submitOrder() {
  await submitTradeOrder({ ticker: "AAPL", strike: 150 });
}
`;
      fs.writeFileSync(testFile, source);

      const node = createMockNode("test.ts:submitOrder", "test.ts", 2, 4);
      const plan = createMockFloorPlan([node]);
      const tagged = tagSideEffects(plan, tempDir);

      const taggedNode = tagged.nodes.get(node.id)!;
      expect(taggedNode.sideEffects).toHaveLength(1);
      expect(taggedNode.sideEffects[0].type).toBe("order_submit");
      expect(taggedNode.sideEffects[0].riskLevel).toBe("critical");
    });

    it("should detect api_call side effects", () => {
      const source = `
async function fetchData() {
  const response = await fetch("https://api.example.com/data");
}
`;
      fs.writeFileSync(testFile, source);

      const node = createMockNode("test.ts:fetchData", "test.ts", 2, 4);
      const plan = createMockFloorPlan([node]);
      const tagged = tagSideEffects(plan, tempDir);

      const taggedNode = tagged.nodes.get(node.id)!;
      expect(taggedNode.sideEffects).toHaveLength(1);
      expect(taggedNode.sideEffects[0].type).toBe("api_call");
      expect(taggedNode.sideEffects[0].riskLevel).toBe("medium");
    });

    it("should detect file_write side effects", () => {
      const source = `
function writeFile() {
  fs.writeFileSync("output.txt", "data");
}
`;
      fs.writeFileSync(testFile, source);

      const node = createMockNode("test.ts:writeFile", "test.ts", 2, 4);
      const plan = createMockFloorPlan([node]);
      const tagged = tagSideEffects(plan, tempDir);

      const taggedNode = tagged.nodes.get(node.id)!;
      expect(taggedNode.sideEffects).toHaveLength(1);
      expect(taggedNode.sideEffects[0].type).toBe("file_write");
      expect(taggedNode.sideEffects[0].riskLevel).toBe("medium");
    });

    it("should detect file_read side effects", () => {
      const source = `
function readFile() {
  const content = fs.readFileSync("input.txt", "utf-8");
}
`;
      fs.writeFileSync(testFile, source);

      const node = createMockNode("test.ts:readFile", "test.ts", 2, 4);
      const plan = createMockFloorPlan([node]);
      const tagged = tagSideEffects(plan, tempDir);

      const taggedNode = tagged.nodes.get(node.id)!;
      expect(taggedNode.sideEffects).toHaveLength(1);
      expect(taggedNode.sideEffects[0].type).toBe("file_read");
      expect(taggedNode.sideEffects[0].riskLevel).toBe("low");
    });

    it("should detect exec side effects", () => {
      const source = `
function runCommand() {
  const result = execSync("ls -la");
}
`;
      fs.writeFileSync(testFile, source);

      const node = createMockNode("test.ts:runCommand", "test.ts", 2, 4);
      const plan = createMockFloorPlan([node]);
      const tagged = tagSideEffects(plan, tempDir);

      const taggedNode = tagged.nodes.get(node.id)!;
      expect(taggedNode.sideEffects).toHaveLength(1);
      expect(taggedNode.sideEffects[0].type).toBe("exec");
      expect(taggedNode.sideEffects[0].riskLevel).toBe("high");
    });

    it("should detect env_access side effects", () => {
      const source = `
function getEnv() {
  const apiKey = process.env.API_KEY;
}
`;
      fs.writeFileSync(testFile, source);

      const node = createMockNode("test.ts:getEnv", "test.ts", 2, 4);
      const plan = createMockFloorPlan([node]);
      const tagged = tagSideEffects(plan, tempDir);

      const taggedNode = tagged.nodes.get(node.id)!;
      expect(taggedNode.sideEffects).toHaveLength(1);
      expect(taggedNode.sideEffects[0].type).toBe("env_access");
      expect(taggedNode.sideEffects[0].riskLevel).toBe("low");
    });

    it("should detect state_mutation side effects", () => {
      const source = `
let moduleState = {};
function mutateState() {
  module.exports = { test: true };
}
`;
      fs.writeFileSync(testFile, source);

      const node = createMockNode("test.ts:mutateState", "test.ts", 3, 5);
      const plan = createMockFloorPlan([node]);
      const tagged = tagSideEffects(plan, tempDir);

      const taggedNode = tagged.nodes.get(node.id)!;
      expect(taggedNode.sideEffects).toHaveLength(1);
      expect(taggedNode.sideEffects[0].type).toBe("state_mutation");
      expect(taggedNode.sideEffects[0].riskLevel).toBe("medium");
    });

    it("should detect network side effects", () => {
      const source = `
function createWs() {
  const ws = new WebSocket("wss://example.com");
}
`;
      fs.writeFileSync(testFile, source);

      const node = createMockNode("test.ts:createWs", "test.ts", 2, 4);
      const plan = createMockFloorPlan([node]);
      const tagged = tagSideEffects(plan, tempDir);

      const taggedNode = tagged.nodes.get(node.id)!;
      expect(taggedNode.sideEffects).toHaveLength(1);
      expect(taggedNode.sideEffects[0].type).toBe("network");
      expect(taggedNode.sideEffects[0].riskLevel).toBe("high");
    });

    it("should detect console_output side effects as low risk", () => {
      const source = `
function logData() {
  console.log("test message");
}
`;
      fs.writeFileSync(testFile, source);

      const node = createMockNode("test.ts:logData", "test.ts", 2, 4);
      const plan = createMockFloorPlan([node]);
      const tagged = tagSideEffects(plan, tempDir);

      const taggedNode = tagged.nodes.get(node.id)!;
      expect(taggedNode.sideEffects).toHaveLength(1);
      expect(taggedNode.sideEffects[0].type).toBe("console_output");
      expect(taggedNode.sideEffects[0].riskLevel).toBe("low");
    });

    it("should deduplicate side effects of the same type", () => {
      const source = `
function multipleWrites() {
  db.insertInto("users").values({ name: "test1" });
  db.insertInto("posts").values({ title: "test2" });
  db.insertInto("comments").values({ text: "test3" });
}
`;
      fs.writeFileSync(testFile, source);

      const node = createMockNode("test.ts:multipleWrites", "test.ts", 2, 6);
      const plan = createMockFloorPlan([node]);
      const tagged = tagSideEffects(plan, tempDir);

      const taggedNode = tagged.nodes.get(node.id)!;
      // Should only have 1 db_write effect despite 3 occurrences
      expect(taggedNode.sideEffects).toHaveLength(1);
      expect(taggedNode.sideEffects[0].type).toBe("db_write");
    });

    it("should detect multiple different side effect types", () => {
      const source = `
async function complexFunc() {
  console.log("starting");
  const data = await fetch("https://api.example.com/data");
  db.insertInto("cache").values({ data });
  fs.writeFileSync("output.json", JSON.stringify(data));
}
`;
      fs.writeFileSync(testFile, source);

      const node = createMockNode("test.ts:complexFunc", "test.ts", 2, 7);
      const plan = createMockFloorPlan([node]);
      const tagged = tagSideEffects(plan, tempDir);

      const taggedNode = tagged.nodes.get(node.id)!;
      expect(taggedNode.sideEffects.length).toBeGreaterThan(1);

      const types = taggedNode.sideEffects.map((e) => e.type);
      expect(types).toContain("console_output");
      expect(types).toContain("api_call");
      expect(types).toContain("db_write");
      expect(types).toContain("file_write");
    });

    it("should handle missing files gracefully", () => {
      const node = createMockNode(
        "nonexistent.ts:func",
        "nonexistent.ts",
        1,
        3
      );
      const plan = createMockFloorPlan([node]);
      const tagged = tagSideEffects(plan, tempDir);

      const taggedNode = tagged.nodes.get(node.id)!;
      // Should keep node unchanged with empty side effects
      expect(taggedNode.sideEffects).toHaveLength(0);
    });

    it("should handle invalid line ranges gracefully", () => {
      const source = `
function test() {
  console.log("test");
}
`;
      fs.writeFileSync(testFile, source);

      // Invalid line range (beyond file length)
      const node = createMockNode("test.ts:test", "test.ts", 100, 200);
      const plan = createMockFloorPlan([node]);
      const tagged = tagSideEffects(plan, tempDir);

      const taggedNode = tagged.nodes.get(node.id)!;
      expect(taggedNode.sideEffects).toHaveLength(0);
    });
  });

  describe("getSideEffectSummary", () => {
    it("should return empty string for no side effects", () => {
      const node = createMockNode("test.ts:func", "test.ts", 1, 3);
      expect(getSideEffectSummary(node)).toBe("");
    });

    it("should format single side effect correctly", () => {
      const node = createMockNode("test.ts:func", "test.ts", 1, 3);
      node.sideEffects = [
        {
          type: "db_write",
          line: 2,
          description: "Database write operation",
          riskLevel: "high",
        },
      ];
      expect(getSideEffectSummary(node)).toBe("db_write(1)");
    });

    it("should format multiple side effects correctly", () => {
      const node = createMockNode("test.ts:func", "test.ts", 1, 5);
      node.sideEffects = [
        {
          type: "db_write",
          line: 2,
          description: "Database write operation",
          riskLevel: "high",
        },
        {
          type: "llm_call",
          line: 3,
          description: "LLM API call",
          riskLevel: "high",
        },
        {
          type: "console_output",
          line: 4,
          description: "Console output",
          riskLevel: "low",
        },
      ];

      const summary = getSideEffectSummary(node);
      expect(summary).toContain("db_write(1)");
      expect(summary).toContain("llm_call(1)");
      expect(summary).toContain("console_output(1)");
    });
  });

  describe("getHighRiskNodes", () => {
    it("should return nodes with critical risk side effects", () => {
      const node1 = createMockNode("test.ts:func1", "test.ts", 1, 3);
      node1.sideEffects = [
        {
          type: "order_submit",
          line: 2,
          description: "Trade order submission",
          riskLevel: "critical",
        },
      ];

      const node2 = createMockNode("test.ts:func2", "test.ts", 5, 7);
      node2.sideEffects = [
        {
          type: "console_output",
          line: 6,
          description: "Console output",
          riskLevel: "low",
        },
      ];

      const plan = createMockFloorPlan([node1, node2]);
      const highRisk = getHighRiskNodes(plan);

      expect(highRisk).toHaveLength(1);
      expect(highRisk[0].id).toBe("test.ts:func1");
    });

    it("should return nodes with high risk side effects", () => {
      const node1 = createMockNode("test.ts:func1", "test.ts", 1, 3);
      node1.sideEffects = [
        {
          type: "llm_call",
          line: 2,
          description: "LLM API call",
          riskLevel: "high",
        },
      ];

      const node2 = createMockNode("test.ts:func2", "test.ts", 5, 7);
      node2.sideEffects = [
        {
          type: "file_read",
          line: 6,
          description: "File system read",
          riskLevel: "low",
        },
      ];

      const plan = createMockFloorPlan([node1, node2]);
      const highRisk = getHighRiskNodes(plan);

      expect(highRisk).toHaveLength(1);
      expect(highRisk[0].id).toBe("test.ts:func1");
    });

    it("should not return nodes with only medium or low risk", () => {
      const node1 = createMockNode("test.ts:func1", "test.ts", 1, 3);
      node1.sideEffects = [
        {
          type: "api_call",
          line: 2,
          description: "External API call",
          riskLevel: "medium",
        },
      ];

      const node2 = createMockNode("test.ts:func2", "test.ts", 5, 7);
      node2.sideEffects = [
        {
          type: "console_output",
          line: 6,
          description: "Console output",
          riskLevel: "low",
        },
      ];

      const plan = createMockFloorPlan([node1, node2]);
      const highRisk = getHighRiskNodes(plan);

      expect(highRisk).toHaveLength(0);
    });
  });

  describe("getSideEffectsByType", () => {
    it("should return all nodes with a specific side effect type", () => {
      const node1 = createMockNode("test.ts:func1", "test.ts", 1, 3);
      node1.sideEffects = [
        {
          type: "db_write",
          line: 2,
          description: "Database write operation",
          riskLevel: "high",
        },
      ];

      const node2 = createMockNode("test.ts:func2", "test.ts", 5, 7);
      node2.sideEffects = [
        {
          type: "db_write",
          line: 6,
          description: "Database write operation",
          riskLevel: "high",
        },
      ];

      const node3 = createMockNode("test.ts:func3", "test.ts", 9, 11);
      node3.sideEffects = [
        {
          type: "console_output",
          line: 10,
          description: "Console output",
          riskLevel: "low",
        },
      ];

      const plan = createMockFloorPlan([node1, node2, node3]);
      const dbWriteNodes = getSideEffectsByType(plan, "db_write");

      expect(dbWriteNodes).toHaveLength(2);
      expect(dbWriteNodes.map((n) => n.id).sort()).toEqual([
        "test.ts:func1",
        "test.ts:func2",
      ]);
    });

    it("should return empty array when no nodes have the side effect type", () => {
      const node1 = createMockNode("test.ts:func1", "test.ts", 1, 3);
      node1.sideEffects = [
        {
          type: "console_output",
          line: 2,
          description: "Console output",
          riskLevel: "low",
        },
      ];

      const plan = createMockFloorPlan([node1]);
      const dbWriteNodes = getSideEffectsByType(plan, "db_write");

      expect(dbWriteNodes).toHaveLength(0);
    });
  });
});
