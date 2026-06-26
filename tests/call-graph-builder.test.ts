/**
 * Unit tests for call_graph_builder.ts
 *
 * Tests the core AST-based call graph extraction functionality.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import {
  buildCallGraph,
  getNodeById,
  getDirectCallers,
  getDirectCallees,
  findNodesByName,
  getEdgesBetween,
  serializeFloorPlan,
  deserializeFloorPlan,
} from "../src/tools/call_graph_builder.js";
import type { FloorPlan } from "../src/types.js";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

const TEST_FILE_SIMPLE = `
/**
 * Simple function with JSDoc.
 */
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export function sayHello(): void {
  const message = greet("World");
  console.log(message);
}

const helper = (x: number): number => {
  return x * 2;
};

export async function processData(items: number[]): Promise<number[]> {
  const results: number[] = [];
  for (const item of items) {
    results.push(helper(item));
  }
  return results;
}
`;

const TEST_FILE_CLASS = `
export class Calculator {
  private value: number = 0;

  constructor(initial: number) {
    this.value = initial;
  }

  add(n: number): Calculator {
    this.value += n;
    return this;
  }

  multiply(n: number): Calculator {
    this.value *= n;
    return this;
  }

  getResult(): number {
    return this.value;
  }
}

export function useCalculator(): number {
  const calc = new Calculator(10);
  calc.add(5);
  calc.multiply(2);
  return calc.getResult();
}
`;

const TEST_FILE_CROSS_CALL = `
import { greet } from "./simple.js";

export function welcome(name: string): string {
  return greet(name) + " Welcome!";
}
`;

// Test file for dynamic imports
const TEST_FILE_DYNAMIC_TARGET = `
/**
 * Target module for dynamic import testing.
 */
export function dynamicHelper(x: number): number {
  return x * 3;
}

export function anotherDynamicFn(s: string): string {
  return s.toUpperCase();
}
`;

// Test file for registration handlers (CXM-ORPHAN)
const TEST_FILE_REGISTRATION_TARGET = `
/**
 * Helper functions called from registration handlers.
 */
export function toolHelper(x: number): number {
  return x * 10;
}

export function commandHelper(s: string): string {
  return s.toLowerCase();
}

export function nestedHelper(): void {
  console.log("nested");
}
`;

const TEST_FILE_REGISTRATION_HANDLERS = `
/**
 * Mock registration handlers for testing synthetic node creation.
 */
import { toolHelper, commandHelper, nestedHelper } from "./registration-target.js";

// Mock api object with registration methods
const api = {
  registerTool: (config: any, handler?: any) => {},
  registerCommand: (config: any, handler?: any) => {},
};

// Pattern 1: Separate handler argument (arrow function)
// This anonymous handler should create a synthetic node: handler:my_tool
api.registerTool({ name: "my_tool", description: "A test tool" }, async (req: any) => {
  const result = toolHelper(req.value);
  return { result };
});

// This anonymous handler should create a synthetic node: handler:my_cmd
api.registerCommand({ command: "/my_cmd" }, () => {
  commandHelper("TEST");
});

// Nested calls inside handler
api.registerTool({ name: "nested_tool" }, async () => {
  nestedHelper();
  toolHelper(1);
});

// Named function handlers should NOT create synthetic nodes (they already exist)
export async function namedHandler(req: any) {
  return toolHelper(req.x);
}

api.registerTool({ name: "named_ref" }, namedHandler);

// Pattern 2: execute method inside object literal (object-literal execute pattern)
api.registerTool({
  name: "execute_method_tool",
  description: "Tool using execute method pattern",
  async execute(_id: string, params: any) {
    const result = toolHelper(params.value);
    nestedHelper();
    return { result };
  }
});

// Pattern 2b: execute as property assignment with arrow function
api.registerTool({
  name: "execute_arrow_tool",
  execute: async (_id: string, params: any) => {
    return commandHelper(params.text);
  }
});
`;

const TEST_FILE_DYNAMIC_IMPORTER = `
/**
 * Module that uses dynamic imports.
 */
export async function useDynamicImport(value: number): Promise<number> {
  const { dynamicHelper, anotherDynamicFn } = await import("./dynamic-target.js");
  const result = dynamicHelper(value);
  console.log(anotherDynamicFn("test"));
  return result;
}

export async function useSingleDynamicImport(s: string): Promise<string> {
  const { anotherDynamicFn } = await import("./dynamic-target.js");
  return anotherDynamicFn(s);
}
`;

// ---------------------------------------------------------------------------
// Helper to create temporary test project
// ---------------------------------------------------------------------------

function createTestProject(): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "floor-plan-test-"));

  // Create minimal tsconfig.json
  const tsConfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "node",
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      outDir: "./dist",
    },
    include: ["src/**/*.ts"],
  };
  fs.writeFileSync(path.join(tempDir, "tsconfig.json"), JSON.stringify(tsConfig, null, 2));

  // Create src directory
  const srcDir = path.join(tempDir, "src");
  fs.mkdirSync(srcDir);

  // Write test files
  fs.writeFileSync(path.join(srcDir, "simple.ts"), TEST_FILE_SIMPLE);
  fs.writeFileSync(path.join(srcDir, "calculator.ts"), TEST_FILE_CLASS);
  fs.writeFileSync(path.join(srcDir, "cross-call.ts"), TEST_FILE_CROSS_CALL);
  fs.writeFileSync(path.join(srcDir, "dynamic-target.ts"), TEST_FILE_DYNAMIC_TARGET);
  fs.writeFileSync(path.join(srcDir, "dynamic-importer.ts"), TEST_FILE_DYNAMIC_IMPORTER);
  fs.writeFileSync(path.join(srcDir, "registration-target.ts"), TEST_FILE_REGISTRATION_TARGET);
  fs.writeFileSync(path.join(srcDir, "registration-handlers.ts"), TEST_FILE_REGISTRATION_HANDLERS);

  return tempDir;
}

function cleanupTestProject(tempDir: string): void {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("call_graph_builder", () => {
  let testDir: string;
  let floorPlan: FloorPlan;

  beforeAll(() => {
    testDir = createTestProject();

    // Build the call graph for the test project
    floorPlan = buildCallGraph({
      rootDir: testDir,
      includeDirs: ["src"],
      skipTests: false,
    });
  });

  // Cleanup after all tests
  afterAll(() => {
    if (testDir) {
      cleanupTestProject(testDir);
    }
  });

  describe("node extraction", () => {
    it("extracts function declarations", () => {
      const greetNode = findNodesByName(floorPlan, "greet")[0];
      expect(greetNode).toBeDefined();
      expect(greetNode.name).toBe("greet");
      expect(greetNode.kind).toBe("function");
      expect(greetNode.exported).toBe(true);
    });

    it("extracts arrow functions in variable declarations", () => {
      const helperNode = findNodesByName(floorPlan, "helper")[0];
      expect(helperNode).toBeDefined();
      expect(helperNode.name).toBe("helper");
      expect(helperNode.kind).toBe("arrow");
      // helper is not exported
      expect(helperNode.exported).toBe(false);
    });

    it("extracts async functions", () => {
      const processNode = findNodesByName(floorPlan, "processData")[0];
      expect(processNode).toBeDefined();
      expect(processNode.isAsync).toBe(true);
    });

    it("extracts class methods", () => {
      const addNode = findNodesByName(floorPlan, "add")[0];
      expect(addNode).toBeDefined();
      expect(addNode.kind).toBe("method");
      expect(addNode.id).toContain("Calculator.add");
    });

    it("extracts class constructors", () => {
      const ctorNode = findNodesByName(floorPlan, "constructor")[0];
      expect(ctorNode).toBeDefined();
      expect(ctorNode.kind).toBe("class_constructor");
      expect(ctorNode.id).toContain("Calculator.constructor");
    });

    it("extracts JSDoc comments", () => {
      const greetNode = findNodesByName(floorPlan, "greet")[0];
      expect(greetNode.docComment).toContain("Simple function with JSDoc");
    });

    it("extracts function signatures", () => {
      const greetNode = findNodesByName(floorPlan, "greet")[0];
      expect(greetNode.signature).toContain("name:");
      expect(greetNode.signature).toContain("string");
    });
  });

  describe("edge extraction", () => {
    it("detects function calls within same file", () => {
      const sayHelloNode = findNodesByName(floorPlan, "sayHello")[0];
      expect(sayHelloNode).toBeDefined();

      const callees = getDirectCallees(floorPlan, sayHelloNode.id);
      const calleeNames = callees.map((c) => c.name);
      expect(calleeNames).toContain("greet");
    });

    it("detects calls to arrow functions", () => {
      const processNode = findNodesByName(floorPlan, "processData")[0];
      expect(processNode).toBeDefined();

      const callees = getDirectCallees(floorPlan, processNode.id);
      const calleeNames = callees.map((c) => c.name);
      expect(calleeNames).toContain("helper");
    });

    it("detects loop context for calls", () => {
      const processNode = findNodesByName(floorPlan, "processData")[0];
      const edges = floorPlan.edges.get(processNode.id) || [];
      const helperEdge = edges.find((e) => e.calleeId.includes("helper"));

      expect(helperEdge).toBeDefined();
      expect(helperEdge!.isInLoop).toBe(true);
    });
  });

  describe("reverse edges", () => {
    it("builds reverse edge map", () => {
      const greetNode = findNodesByName(floorPlan, "greet")[0];
      const callers = getDirectCallers(floorPlan, greetNode.id);

      expect(callers.length).toBeGreaterThan(0);
      const callerNames = callers.map((c) => c.name);
      expect(callerNames).toContain("sayHello");
    });
  });

  describe("cross-file resolution", () => {
    it("resolves imports to their definitions", () => {
      const welcomeNode = findNodesByName(floorPlan, "welcome")[0];
      expect(welcomeNode).toBeDefined();

      const callees = getDirectCallees(floorPlan, welcomeNode.id);
      const calleeNames = callees.map((c) => c.name);

      // Should resolve greet from import
      expect(calleeNames).toContain("greet");
    });
  });

  describe("dynamic import resolution", () => {
    it("detects dynamic import targets with destructuring", () => {
      // useDynamicImport should have edges to dynamicHelper and anotherDynamicFn
      const importerNode = findNodesByName(floorPlan, "useDynamicImport")[0];
      expect(importerNode).toBeDefined();

      const callees = getDirectCallees(floorPlan, importerNode.id);
      const calleeNames = callees.map((c) => c.name);

      // Should resolve functions from dynamic import
      expect(calleeNames).toContain("dynamicHelper");
      expect(calleeNames).toContain("anotherDynamicFn");
    });

    it("detects single dynamic import target", () => {
      // useSingleDynamicImport should have edge to anotherDynamicFn
      const importerNode = findNodesByName(floorPlan, "useSingleDynamicImport")[0];
      expect(importerNode).toBeDefined();

      const callees = getDirectCallees(floorPlan, importerNode.id);
      const calleeNames = callees.map((c) => c.name);

      expect(calleeNames).toContain("anotherDynamicFn");
    });

    it("builds reverse edges from dynamic imports", () => {
      // dynamicHelper should have useDynamicImport as a caller
      const targetNode = findNodesByName(floorPlan, "dynamicHelper")[0];
      expect(targetNode).toBeDefined();

      const callers = getDirectCallers(floorPlan, targetNode.id);
      const callerNames = callers.map((c) => c.name);

      expect(callerNames).toContain("useDynamicImport");
    });

    it("marks dynamic import edges correctly", () => {
      const importerNode = findNodesByName(floorPlan, "useDynamicImport")[0];
      const edges = floorPlan.edges.get(importerNode.id) || [];
      const dynamicEdge = edges.find((e) => e.calleeId.includes("dynamicHelper"));

      expect(dynamicEdge).toBeDefined();
      expect(dynamicEdge!.isAsync).toBe(true); // await import is async
      expect(dynamicEdge!.callText).toContain("dynamic import");
    });
  });

  describe("synthetic registration handlers (CXM-ORPHAN)", () => {
    it("creates synthetic node for registerTool anonymous handler", () => {
      // Look for the synthetic node created for the my_tool handler
      const syntheticNodes = findNodesByName(floorPlan, "handler:my_tool");
      expect(syntheticNodes.length).toBe(1);

      const node = syntheticNodes[0];
      expect(node).toBeDefined();
      expect(node.id).toContain("handler:my_tool");
      expect(node.synthetic).toBe(true);
      expect(node.tags).toContain("registration-handler");
      expect(node.kind).toBe("arrow");
    });

    it("creates synthetic node for registerCommand anonymous handler", () => {
      // Look for the synthetic node created for the /my_cmd command handler
      const syntheticNodes = findNodesByName(floorPlan, "handler:my_cmd");
      expect(syntheticNodes.length).toBe(1);

      const node = syntheticNodes[0];
      expect(node).toBeDefined();
      expect(node.id).toContain("handler:my_cmd");
      expect(node.synthetic).toBe(true);
    });

    it("traces calls from registerTool handler to target functions", () => {
      // The handler:my_tool should have an edge to toolHelper
      const handlerNode = findNodesByName(floorPlan, "handler:my_tool")[0];
      expect(handlerNode).toBeDefined();

      const callees = getDirectCallees(floorPlan, handlerNode.id);
      const calleeNames = callees.map((c) => c.name);

      expect(calleeNames).toContain("toolHelper");
    });

    it("traces calls from registerCommand handler to target functions", () => {
      // The handler:my_cmd should have an edge to commandHelper
      const handlerNode = findNodesByName(floorPlan, "handler:my_cmd")[0];
      expect(handlerNode).toBeDefined();

      const callees = getDirectCallees(floorPlan, handlerNode.id);
      const calleeNames = callees.map((c) => c.name);

      expect(calleeNames).toContain("commandHelper");
    });

    it("builds reverse edges from synthetic handlers", () => {
      // toolHelper should have handler:my_tool as a caller
      const targetNode = findNodesByName(floorPlan, "toolHelper")[0];
      expect(targetNode).toBeDefined();

      const callers = getDirectCallers(floorPlan, targetNode.id);
      const callerNames = callers.map((c) => c.name);

      // Should include the synthetic handler
      expect(callerNames.some((n) => n.includes("handler:my_tool"))).toBe(true);
    });

    it("traces multiple calls from single handler", () => {
      // The nested_tool handler should call both nestedHelper and toolHelper
      const handlerNode = findNodesByName(floorPlan, "handler:nested_tool")[0];
      expect(handlerNode).toBeDefined();

      const callees = getDirectCallees(floorPlan, handlerNode.id);
      const calleeNames = callees.map((c) => c.name);

      expect(calleeNames).toContain("nestedHelper");
      expect(calleeNames).toContain("toolHelper");
    });

    it("does not create synthetic nodes for named function handlers", () => {
      // namedHandler is a named function, not anonymous, so no synthetic node
      const namedHandlerNodes = findNodesByName(floorPlan, "namedHandler");
      expect(namedHandlerNodes.length).toBe(1);

      const node = namedHandlerNodes[0];
      // Should not be synthetic - it's a real named function
      expect(node.synthetic).toBeUndefined();
    });

    it("creates synthetic node for execute method pattern (object-literal execute pattern)", () => {
      // This tests the pattern: registerTool({ name: "x", async execute() { ... } })
      const syntheticNodes = findNodesByName(floorPlan, "handler:execute_method_tool");
      expect(syntheticNodes.length).toBe(1);

      const node = syntheticNodes[0];
      expect(node).toBeDefined();
      expect(node.synthetic).toBe(true);
      expect(node.tags).toContain("registration-handler");
    });

    it("traces calls from execute method handler to target functions", () => {
      // The execute_method_tool handler should call toolHelper and nestedHelper
      const handlerNode = findNodesByName(floorPlan, "handler:execute_method_tool")[0];
      expect(handlerNode).toBeDefined();

      const callees = getDirectCallees(floorPlan, handlerNode.id);
      const calleeNames = callees.map((c) => c.name);

      expect(calleeNames).toContain("toolHelper");
      expect(calleeNames).toContain("nestedHelper");
    });

    it("creates synthetic node for execute arrow property pattern", () => {
      // This tests: registerTool({ name: "x", execute: async () => { ... } })
      const syntheticNodes = findNodesByName(floorPlan, "handler:execute_arrow_tool");
      expect(syntheticNodes.length).toBe(1);

      const node = syntheticNodes[0];
      expect(node).toBeDefined();
      expect(node.synthetic).toBe(true);
    });

    it("traces calls from execute arrow handler to target functions", () => {
      // The execute_arrow_tool handler should call commandHelper
      const handlerNode = findNodesByName(floorPlan, "handler:execute_arrow_tool")[0];
      expect(handlerNode).toBeDefined();

      const callees = getDirectCallees(floorPlan, handlerNode.id);
      const calleeNames = callees.map((c) => c.name);

      expect(calleeNames).toContain("commandHelper");
    });
  });

  describe("metadata", () => {
    it("includes file count", () => {
      // 3 original + 2 dynamic import + 2 registration handler files = 7
      expect(floorPlan.meta.fileCount).toBe(7);
    });

    it("includes node count", () => {
      expect(floorPlan.meta.nodeCount).toBeGreaterThan(5);
    });

    it("includes edge count", () => {
      expect(floorPlan.meta.edgeCount).toBeGreaterThan(0);
    });

    it("includes analysis time", () => {
      expect(floorPlan.meta.analysisTimeMs).toBeGreaterThan(0);
    });

    it("includes generation timestamp", () => {
      expect(floorPlan.meta.generatedAt).toBeDefined();
      expect(new Date(floorPlan.meta.generatedAt).getTime()).toBeGreaterThan(0);
    });
  });

  describe("query helpers", () => {
    it("getNodeById returns correct node", () => {
      const greetNode = findNodesByName(floorPlan, "greet")[0];
      const retrieved = getNodeById(floorPlan, greetNode.id);
      expect(retrieved).toEqual(greetNode);
    });

    it("getNodeById returns undefined for unknown ID", () => {
      const result = getNodeById(floorPlan, "nonexistent:function");
      expect(result).toBeUndefined();
    });

    it("findNodesByName finds partial matches", () => {
      const results = findNodesByName(floorPlan, "get");
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((n) => n.name === "getResult")).toBe(true);
    });

    it("getEdgesBetween returns edges for specific pair", () => {
      const sayHelloNode = findNodesByName(floorPlan, "sayHello")[0];
      const greetNode = findNodesByName(floorPlan, "greet")[0];

      const edges = getEdgesBetween(floorPlan, sayHelloNode.id, greetNode.id);
      expect(edges.length).toBe(1);
      expect(edges[0].callText).toContain("greet");
    });
  });

  describe("serialization", () => {
    it("round-trips through JSON", () => {
      const serialized = serializeFloorPlan(floorPlan);
      const json = JSON.stringify(serialized);
      const parsed = JSON.parse(json);
      const deserialized = deserializeFloorPlan(parsed);

      // Check that Maps are restored
      expect(deserialized.nodes instanceof Map).toBe(true);
      expect(deserialized.edges instanceof Map).toBe(true);
      expect(deserialized.reverseEdges instanceof Map).toBe(true);

      // Check that data is preserved
      expect(deserialized.nodes.size).toBe(floorPlan.nodes.size);
      expect(deserialized.edges.size).toBe(floorPlan.edges.size);
      expect(deserialized.meta).toEqual(floorPlan.meta);
    });
  });
});

describe("buildCallGraph options", () => {
  it("uses default options when none provided", () => {
    // This test runs against the actual codebase.
    // As the repository grows, the full scan can exceed Vitest's default 30s timeout.
    // Just verify it doesn't throw and returns a valid structure.
    const plan = buildCallGraph();

    expect(plan.nodes).toBeDefined();
    expect(plan.nodes instanceof Map).toBe(true);
    expect(plan.edges instanceof Map).toBe(true);
    expect(plan.reverseEdges instanceof Map).toBe(true);
    expect(plan.meta.fileCount).toBeGreaterThan(0);
  }, 120000);

  it("respects skipTests option", () => {
    // Build with tests - scan both src and tests directories
    const withTests = buildCallGraph({
      includeDirs: ["src", "tests"],
      skipTests: false,
    });

    // Build without tests - scan both but skip test files
    const withoutTests = buildCallGraph({
      includeDirs: ["src", "tests"],
      skipTests: true,
    });

    // Should have fewer files without tests (tests/ directory has test files)
    expect(withoutTests.meta.fileCount).toBeLessThan(withTests.meta.fileCount);
  }, 60000); // 60s timeout for this test since it builds call graph twice

  it("respects excludePatterns option", () => {
    const plan = buildCallGraph({
      excludePatterns: ["node_modules", ".git", "dist", ".pi", "extensions"],
    });

    // Should not have any files from extensions/
    for (const node of plan.nodes.values()) {
      expect(node.file).not.toMatch(/^extensions\//);
    }
  });
});

describe("auto-detection and include_dirs", () => {
  let autoTestDir: string;

  beforeAll(() => {
    // Create a project with a lib/ dir instead of src/
    autoTestDir = fs.mkdtempSync(path.join(os.tmpdir(), "floor-plan-autotest-"));
    const tsConfig = {
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "node", strict: true, esModuleInterop: true, skipLibCheck: true },
      include: ["lib/**/*.ts"],
    };
    fs.writeFileSync(path.join(autoTestDir, "tsconfig.json"), JSON.stringify(tsConfig, null, 2));

    const libDir = path.join(autoTestDir, "lib");
    fs.mkdirSync(libDir);
    fs.writeFileSync(path.join(libDir, "utils.ts"), `
      export function libHelper(x: number): number { return x + 1; }
      export function libCaller(): number { return libHelper(5); }
    `);
  });

  afterAll(() => {
    if (autoTestDir) fs.rmSync(autoTestDir, { recursive: true, force: true });
  });

  it("auto-detects lib/ dir when src/ absent", () => {
    // When includeDirs is NOT provided, should auto-detect lib/
    const plan = buildCallGraph({ rootDir: autoTestDir, skipTests: false, forceRebuild: true });
    const nodes = [...plan.nodes.values()];
    expect(nodes.length).toBeGreaterThan(0);
    expect(nodes.some(n => n.name === "libHelper")).toBe(true);
    expect(plan.meta.scannedDirs).toContain("lib");
  });

  it("explicit include_dirs override uses only specified dirs", () => {
    // Explicitly pass includeDirs: ["lib"] should work the same
    const plan = buildCallGraph({ rootDir: autoTestDir, includeDirs: ["lib"], skipTests: false, forceRebuild: true });
    expect(plan.nodes.size).toBeGreaterThan(0);
    expect(plan.meta.scannedDirs).toEqual(["lib"]);
  });

  it("root fallback when no candidate dirs exist", () => {
    // Project with only a tsconfig and .ts files at root (no src/, lib/, etc.)
    const flatDir = fs.mkdtempSync(path.join(os.tmpdir(), "floor-plan-flat-"));
    try {
      const tsConfig = {
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "node", strict: true, esModuleInterop: true, skipLibCheck: true },
        include: ["*.ts"],
      };
      fs.writeFileSync(path.join(flatDir, "tsconfig.json"), JSON.stringify(tsConfig, null, 2));
      fs.writeFileSync(path.join(flatDir, "index.ts"), `export function rootFn(): void { console.log("hi"); }`);

      const plan = buildCallGraph({ rootDir: flatDir, skipTests: false, forceRebuild: true });
      // When no candidate dirs exist, scannedDirs should be ["."]
      expect(plan.meta.scannedDirs).toEqual(["."]);
      // rootFn should be found
      expect([...plan.nodes.values()].some(n => n.name === "rootFn")).toBe(true);
    } finally {
      fs.rmSync(flatDir, { recursive: true, force: true });
    }
  });

  it("returns warning when 0 nodes found", () => {
    // Pass a non-existent directory explicitly -> 0 nodes
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "floor-plan-empty-"));
    try {
      const tsConfig = {
        compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "node", strict: true, esModuleInterop: true, skipLibCheck: true },
        include: ["nonexistent/**/*.ts"],
      };
      fs.writeFileSync(path.join(emptyDir, "tsconfig.json"), JSON.stringify(tsConfig, null, 2));

      const plan = buildCallGraph({ rootDir: emptyDir, includeDirs: ["nonexistent"], skipTests: false, forceRebuild: true });
      expect(plan.meta.nodeCount).toBe(0);
      expect(plan.meta.warning).toBeDefined();
      expect(plan.meta.warning).toContain("nonexistent");
      expect(plan.meta.warning).toContain("include_dirs");
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
