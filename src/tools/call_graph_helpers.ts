/**
 * @fileoverview call_graph_helpers — CallableNode, ExtractedNode, ResolutionContext.
 * Key exports: CallableNode, ExtractedNode, ResolutionContext, setProjectRoot, getRelativePath, syntaxKindToCallableKind
 * Depends on: node:path
 */
/**
 * call_graph_helpers.ts - Helper functions for call graph extraction
 *
 * Extracted from call_graph_builder.ts to keep the main module focused.
 * Contains: node extraction, edge context detection, path utilities, serialization.
 */

import * as path from "node:path";
import {
  Node,
  SyntaxKind,
  SourceFile,
  FunctionDeclaration,
  MethodDeclaration,
  ArrowFunction,
  FunctionExpression,
  ConstructorDeclaration,
  GetAccessorDeclaration,
  SetAccessorDeclaration,
  Symbol as TsSymbol,
} from "ts-morph";
import type {
  CallGraphNode,
  CallEdge,
  CallableKind,
  FloorPlan,
  FloorPlanMeta,
} from "../types.js";

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

export type CallableNode =
  | FunctionDeclaration
  | MethodDeclaration
  | ArrowFunction
  | FunctionExpression
  | ConstructorDeclaration
  | GetAccessorDeclaration
  | SetAccessorDeclaration;

export interface ExtractedNode {
  node: CallableNode;
  name: string;
  kind: CallableKind;
  className?: string;
  variableName?: string;
}

export interface ResolutionContext {
  visited: Set<string>;
  depth: number;
  maxDepth: number;
}

// ---------------------------------------------------------------------------
// Path Utilities
// ---------------------------------------------------------------------------

let projectRoot: string = process.cwd();

export function setProjectRoot(root: string): void {
  projectRoot = root;
}

export function getRelativePath(absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// Kind Mapping
// ---------------------------------------------------------------------------

/**
 * Map ts-morph SyntaxKind to our CallableKind.
 */
export function syntaxKindToCallableKind(kind: SyntaxKind): CallableKind {
  switch (kind) {
    case SyntaxKind.FunctionDeclaration:
    case SyntaxKind.FunctionExpression:
      return "function";
    case SyntaxKind.MethodDeclaration:
      return "method";
    case SyntaxKind.ArrowFunction:
      return "arrow";
    case SyntaxKind.Constructor:
      return "class_constructor";
    case SyntaxKind.GetAccessor:
      return "getter";
    case SyntaxKind.SetAccessor:
      return "setter";
    default:
      return "function";
  }
}

// ---------------------------------------------------------------------------
// Node Property Extraction
// ---------------------------------------------------------------------------

/**
 * Check if a node has an export modifier.
 */
export function isExported(node: Node): boolean {
  // Check for direct export modifier
  if (Node.isExportable(node) && node.isExported()) {
    return true;
  }

  // Check if parent variable statement is exported
  const parent = node.getParent();
  if (Node.isVariableDeclaration(parent)) {
    const varStatement = parent.getParent()?.getParent();
    if (Node.isVariableStatement(varStatement) && varStatement.isExported()) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a function/method is async.
 */
export function isAsyncNode(node: CallableNode): boolean {
  if (Node.isFunctionDeclaration(node) || Node.isMethodDeclaration(node)) {
    return node.isAsync();
  }
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
    return node.isAsync();
  }
  return false;
}

/**
 * Extract function signature from a callable node.
 */
export function extractSignature(node: CallableNode): string {
  try {
    const params = getParameters(node);
    const returnType = getReturnType(node);
    const sig = `(${params})${returnType ? `: ${returnType}` : ""}`;
    return sig.slice(0, 200);
  } catch {
    return "(...)";
  }
}

function getParameters(node: CallableNode): string {
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node) ||
    Node.isConstructorDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node)
  ) {
    return node
      .getParameters()
      .map((p) => {
        const name = p.getName();
        const type = p.getType().getText(p).split("\n")[0];
        return `${name}: ${type.slice(0, 50)}`;
      })
      .join(", ");
  }
  return "";
}

function getReturnType(node: CallableNode): string | undefined {
  try {
    if (
      Node.isFunctionDeclaration(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isArrowFunction(node) ||
      Node.isFunctionExpression(node)
    ) {
      const returnType = node.getReturnType();
      const text = returnType.getText(node).split("\n")[0];
      return text.slice(0, 50);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Extract JSDoc comment from a node.
 */
export function extractDocComment(node: CallableNode): string | undefined {
  try {
    // Get the node that might have JSDoc attached
    let targetNode: Node = node;

    // For arrow functions in variable declarations, get the variable statement
    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
      const parent = node.getParent();
      if (Node.isVariableDeclaration(parent)) {
        const varStatement = parent.getParent()?.getParent();
        if (varStatement) {
          targetNode = varStatement;
        }
      }
    }

    // Try to get JSDoc
    if (Node.isJSDocable(targetNode)) {
      const jsDocs = targetNode.getJsDocs();
      if (jsDocs.length > 0) {
        const comment = jsDocs[0].getDescription().trim();
        return comment.slice(0, 200);
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Build a unique ID for a callable node.
 */
export function buildNodeId(
  file: string,
  name: string,
  className?: string
): string {
  const normalizedFile = file.replace(/\\/g, "/");
  if (className) {
    return `${normalizedFile}:${className}.${name}`;
  }
  return `${normalizedFile}:${name}`;
}

/**
 * Get the ts-morph Symbol for a callable node.
 */
export function getNodeSymbol(node: CallableNode): TsSymbol | undefined {
  if (Node.isFunctionDeclaration(node)) {
    return node.getNameNode()?.getSymbol();
  }
  if (Node.isMethodDeclaration(node)) {
    return node.getNameNode()?.getSymbol();
  }
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
    const parent = node.getParent();
    if (Node.isVariableDeclaration(parent)) {
      return parent.getNameNode()?.getSymbol();
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Callable Extraction
// ---------------------------------------------------------------------------

/**
 * Extract all callable nodes from a source file.
 */
export function extractCallablesFromFile(sourceFile: SourceFile): ExtractedNode[] {
  const callables: ExtractedNode[] = [];

  // 1. Top-level function declarations
  for (const fn of sourceFile.getFunctions()) {
    const name = fn.getName();
    if (name) {
      callables.push({
        node: fn,
        name,
        kind: "function",
      });
    }
  }

  // 2. Class members
  for (const cls of sourceFile.getClasses()) {
    const className = cls.getName() || "AnonymousClass";

    // Methods
    for (const method of cls.getMethods()) {
      const name = method.getName();
      callables.push({
        node: method,
        name,
        kind: "method",
        className,
      });
    }

    // Constructor
    const ctor = cls.getConstructors()[0];
    if (ctor) {
      callables.push({
        node: ctor,
        name: "constructor",
        kind: "class_constructor",
        className,
      });
    }

    // Getters
    for (const getter of cls.getGetAccessors()) {
      callables.push({
        node: getter,
        name: getter.getName(),
        kind: "getter",
        className,
      });
    }

    // Setters
    for (const setter of cls.getSetAccessors()) {
      callables.push({
        node: setter,
        name: setter.getName(),
        kind: "setter",
        className,
      });
    }
  }

  // 3. Arrow functions and function expressions in variable declarations
  for (const varStmt of sourceFile.getVariableStatements()) {
    for (const decl of varStmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        const name = decl.getName();
        callables.push({
          node: init,
          name,
          kind: Node.isArrowFunction(init) ? "arrow" : "function",
          variableName: name,
        });
      }
    }
  }

  return callables;
}

// ---------------------------------------------------------------------------
// Edge Context Detection
// ---------------------------------------------------------------------------

/**
 * Check if a node is inside a conditional construct.
 */
export function isInsideConditional(node: Node): boolean {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (
      Node.isIfStatement(current) ||
      Node.isConditionalExpression(current) ||
      Node.isSwitchStatement(current)
    ) {
      return true;
    }
    current = current.getParent();
  }
  return false;
}

/**
 * Check if a node is inside a try block.
 */
export function isInsideTry(node: Node): boolean {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isTryStatement(current)) {
      // Check if we're in the try block (not catch/finally)
      const tryBlock = current.getTryBlock();
      if (tryBlock && node.getPos() >= tryBlock.getPos() && node.getEnd() <= tryBlock.getEnd()) {
        return true;
      }
    }
    current = current.getParent();
  }
  return false;
}

/**
 * Check if a node is inside a loop.
 */
export function isInsideLoop(node: Node): boolean {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (
      Node.isForStatement(current) ||
      Node.isWhileStatement(current) ||
      Node.isDoStatement(current) ||
      Node.isForOfStatement(current) ||
      Node.isForInStatement(current)
    ) {
      return true;
    }
    current = current.getParent();
  }
  return false;
}

/**
 * Check if a call is awaited.
 */
export function isAwaitedCall(node: Node): boolean {
  const parent = node.getParent();
  return parent !== undefined && Node.isAwaitExpression(parent);
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Serialize FloorPlan to a plain object for JSON storage.
 */
export function serializeFloorPlan(plan: FloorPlan): object {
  return {
    nodes: Object.fromEntries(plan.nodes),
    edges: Object.fromEntries(
      Array.from(plan.edges.entries()).map(([k, v]) => [k, v])
    ),
    reverseEdges: Object.fromEntries(plan.reverseEdges),
    entryPoints: plan.entryPoints,
    meta: plan.meta,
  };
}

/**
 * Deserialize a plain object back to FloorPlan.
 */
export function deserializeFloorPlan(data: {
  nodes: Record<string, CallGraphNode>;
  edges: Record<string, CallEdge[]>;
  reverseEdges: Record<string, string[]>;
  entryPoints: FloorPlan["entryPoints"];
  meta: FloorPlanMeta;
}): FloorPlan {
  return {
    nodes: new Map(Object.entries(data.nodes)),
    edges: new Map(Object.entries(data.edges)),
    reverseEdges: new Map(Object.entries(data.reverseEdges)),
    entryPoints: data.entryPoints,
    meta: data.meta,
  };
}
