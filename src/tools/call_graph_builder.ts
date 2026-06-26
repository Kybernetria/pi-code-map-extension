/**
 * @fileoverview call_graph_builder — buildCallGraph, getNodeById, getDirectCallers.
 * Key exports: buildCallGraph, getNodeById, getDirectCallers, getDirectCallees, findNodesByName, getEdgesBetween
 * Depends on: node:path, node:fs
 * Side effects: console_output
 */
/**
 * call_graph_builder.ts - Core AST-based call graph extraction using ts-morph
 *
 * Parses TypeScript/TSX source files and builds a complete call graph:
 * - Extracts function declarations, methods, arrow functions, constructors
 * - Finds all CallExpression nodes in function bodies
 * - Resolves callees to their declarations (cross-file when possible)
 * - Builds forward and reverse edge maps for fast traversal
 *
 * Part of pi-code-map-extension.
 */

import * as path from "node:path";
import { existsSync } from "node:fs";
import {
  Project,
  Node,
  SourceFile,
  SyntaxKind,
  CallExpression,
  Identifier,
  PropertyAccessExpression,
  Symbol as TsSymbol,
} from "ts-morph";
import type {
  CallGraphNode,
  CallEdge,
  FloorPlan,
  FloorPlanMeta,
  CallGraphBuilderOptions,
} from "../types.js";
import {
  type CallableNode,
  type ExtractedNode,
  type ResolutionContext,
  setProjectRoot,
  getRelativePath,
  isExported,
  isAsyncNode,
  extractSignature,
  extractDocComment,
  buildNodeId,
  getNodeSymbol,
  extractCallablesFromFile,
  isInsideConditional,
  isInsideTry,
  isInsideLoop,
  isAwaitedCall,
  serializeFloorPlan,
  deserializeFloorPlan,
} from "./call_graph_helpers.js";

// Re-export serialization functions for external use
export { serializeFloorPlan, deserializeFloorPlan };

// ---------------------------------------------------------------------------
// Default Configuration
// ---------------------------------------------------------------------------

// HEALTH-1-FIX: expanded scan scope + forceRebuild support
const DEFAULT_INCLUDE_DIRS = ["src", "extensions", "packages", "skills", "shared", "database"];
const DEFAULT_EXCLUDE_PATTERNS = ["node_modules", ".git", "dist", ".pi", "docs/reference"];
const DEFAULT_MAX_RESOLUTION_DEPTH = 10;

// XPROJ-2: candidate dirs for auto-detection when includeDirs is not specified
const CANDIDATE_DIRS = ["src", "lib", "app", "core", "server", "api", "shared", "extensions", "packages", "skills", "database", "source", "sources", "backend", "frontend", "client", "services"];

/**
 * Auto-detect which directories to scan based on what actually exists under rootDir.
 * Returns existing candidate dirs, or ["."] as fallback when none found.
 */
function autoDetectIncludeDirs(rootDir: string): string[] {
  const found = CANDIDATE_DIRS.filter(d => existsSync(path.join(rootDir, d)));
  return found.length > 0 ? found : ["."];
}

// ---------------------------------------------------------------------------
// Call Expression Resolution
// ---------------------------------------------------------------------------

/**
 * Try to resolve a call expression to a target function ID.
 */
function resolveCallExpression(
  call: CallExpression,
  nodeMap: Map<string, CallGraphNode>,
  symbolToNodeId: Map<TsSymbol, string>,
  ctx: ResolutionContext
): string | undefined {
  if (ctx.depth > ctx.maxDepth) {
    return undefined;
  }

  const expression = call.getExpression();

  // Direct function call: foo()
  if (Node.isIdentifier(expression)) {
    return resolveIdentifier(expression, nodeMap, symbolToNodeId, ctx);
  }

  // Method call: obj.method() or Class.staticMethod()
  if (Node.isPropertyAccessExpression(expression)) {
    return resolvePropertyAccess(expression, nodeMap, symbolToNodeId, ctx);
  }

  // Parenthesized: (someFunc)()
  if (Node.isParenthesizedExpression(expression)) {
    const inner = expression.getExpression();
    if (Node.isIdentifier(inner)) {
      return resolveIdentifier(inner, nodeMap, symbolToNodeId, ctx);
    }
  }

  return undefined;
}

/**
 * Resolve an identifier to a node ID.
 */
function resolveIdentifier(
  identifier: Identifier,
  nodeMap: Map<string, CallGraphNode>,
  symbolToNodeId: Map<TsSymbol, string>,
  ctx: ResolutionContext
): string | undefined {
  const symbol = identifier.getSymbol();
  if (!symbol) return undefined;

  // Check if we've already resolved this symbol
  const cached = symbolToNodeId.get(symbol);
  if (cached) return cached;

  // Prevent circular resolution
  const symbolKey = `sym:${symbol.getName()}:${identifier.getSourceFile().getFilePath()}`;
  if (ctx.visited.has(symbolKey)) return undefined;
  ctx.visited.add(symbolKey);

  // Get the declaration
  const declarations = symbol.getDeclarations();
  if (!declarations || declarations.length === 0) return undefined;

  const decl = declarations[0];

  // If it's a function declaration
  if (Node.isFunctionDeclaration(decl)) {
    const name = decl.getName();
    if (name) {
      const file = getRelativePath(decl.getSourceFile().getFilePath());
      const id = buildNodeId(file, name);
      if (nodeMap.has(id)) {
        symbolToNodeId.set(symbol, id);
        return id;
      }
    }
  }

  // If it's a variable declaration with arrow/function initializer
  if (Node.isVariableDeclaration(decl)) {
    const name = decl.getName();
    const file = getRelativePath(decl.getSourceFile().getFilePath());
    const id = buildNodeId(file, name);
    if (nodeMap.has(id)) {
      symbolToNodeId.set(symbol, id);
      return id;
    }
  }

  // If it's an import specifier, follow it
  if (Node.isImportSpecifier(decl)) {
    return resolveImportSpecifier(decl, nodeMap, symbolToNodeId, ctx);
  }

  // If it's a namespace import or import clause, we need more context
  if (Node.isImportClause(decl)) {
    const defaultImport = decl.getDefaultImport();
    if (defaultImport) {
      return resolveImport(decl.getParent(), nodeMap, symbolToNodeId, ctx);
    }
  }

  return undefined;
}

/**
 * Resolve property access expression (method calls).
 */
function resolvePropertyAccess(
  expr: PropertyAccessExpression,
  nodeMap: Map<string, CallGraphNode>,
  symbolToNodeId: Map<TsSymbol, string>,
  ctx: ResolutionContext
): string | undefined {
  const propName = expr.getName();
  const objExpr = expr.getExpression();

  // Try to get the type of the object
  try {
    const objType = objExpr.getType();
    const symbol = objType.getSymbol() || objType.getAliasSymbol();

    if (symbol) {
      const declarations = symbol.getDeclarations();
      if (declarations && declarations.length > 0) {
        const decl = declarations[0];

        // If it's a class, look for the method
        if (Node.isClassDeclaration(decl)) {
          const className = decl.getName() || "AnonymousClass";
          const file = getRelativePath(decl.getSourceFile().getFilePath());
          const methodId = buildNodeId(file, propName, className);
          if (nodeMap.has(methodId)) {
            return methodId;
          }
        }
      }
    }
  } catch {
    // Type resolution can fail for various reasons, that's okay
  }

  // Try direct symbol resolution on the property
  const propSymbol = expr.getNameNode().getSymbol();
  if (propSymbol) {
    const cached = symbolToNodeId.get(propSymbol);
    if (cached) return cached;

    const declarations = propSymbol.getDeclarations();
    if (declarations && declarations.length > 0) {
      const decl = declarations[0];

      // Method declaration
      if (Node.isMethodDeclaration(decl)) {
        const parent = decl.getParent();
        if (Node.isClassDeclaration(parent)) {
          const className = parent.getName() || "AnonymousClass";
          const file = getRelativePath(decl.getSourceFile().getFilePath());
          const id = buildNodeId(file, propName, className);
          if (nodeMap.has(id)) {
            symbolToNodeId.set(propSymbol, id);
            return id;
          }
        }
      }
    }
  }

  return undefined;
}

/**
 * Resolve an import specifier to the actual function.
 */
function resolveImportSpecifier(
  specifier: Node,
  nodeMap: Map<string, CallGraphNode>,
  symbolToNodeId: Map<TsSymbol, string>,
  ctx: ResolutionContext
): string | undefined {
  if (!Node.isImportSpecifier(specifier)) return undefined;

  const importDecl = specifier.getImportDeclaration();

  // Get the source file being imported
  const importedSourceFile = importDecl.getModuleSpecifierSourceFile();
  if (!importedSourceFile) return undefined;

  // Get the name being imported (handles aliasing)
  const importedName = specifier.getName();

  // Look for the export in the imported file
  const file = getRelativePath(importedSourceFile.getFilePath());

  // Direct export
  const directId = buildNodeId(file, importedName);
  if (nodeMap.has(directId)) {
    return directId;
  }

  // Check for re-exports (e.g., export { foo } from './bar')
  for (const exportDecl of importedSourceFile.getExportDeclarations()) {
    for (const namedExport of exportDecl.getNamedExports()) {
      if (namedExport.getName() === importedName) {
        const reExportSource = exportDecl.getModuleSpecifierSourceFile();
        if (reExportSource) {
          const reExportFile = getRelativePath(reExportSource.getFilePath());
          const originalName = namedExport.getAliasNode()?.getText() || importedName;
          const reExportId = buildNodeId(reExportFile, originalName);
          if (nodeMap.has(reExportId)) {
            return reExportId;
          }
        }
      }
    }
  }

  return undefined;
}

/**
 * Resolve a general import to a function.
 */
function resolveImport(
  importDecl: Node,
  nodeMap: Map<string, CallGraphNode>,
  symbolToNodeId: Map<TsSymbol, string>,
  ctx: ResolutionContext
): string | undefined {
  if (!Node.isImportDeclaration(importDecl)) return undefined;

  const sourceFile = importDecl.getModuleSpecifierSourceFile();
  if (!sourceFile) return undefined;

  // For default imports, look for default export
  const file = getRelativePath(sourceFile.getFilePath());

  // Check for default export function
  for (const fn of sourceFile.getFunctions()) {
    if (fn.isDefaultExport()) {
      const name = fn.getName() || "default";
      const id = buildNodeId(file, name);
      if (nodeMap.has(id)) {
        return id;
      }
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Dynamic Import Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a relative import specifier to a target file path.
 * Handles .js -> .ts extension mapping for ES module imports.
 */
function resolveDynamicImportPath(
  sourceFilePath: string,
  specifier: string,
  project: Project
): string | undefined {
  try {
    // Strip quotes if present
    const cleanSpec = specifier.replace(/['"`]/g, "").trim();
    
    // Skip non-relative imports (node_modules, bare specifiers)
    if (!cleanSpec.startsWith(".")) {
      return undefined;
    }
    
    // Get the directory of the source file
    const sourceDir = path.dirname(sourceFilePath);
    
    // Resolve the relative path
    let targetPath = path.resolve(sourceDir, cleanSpec);
    
    // Handle .js -> .ts mapping (common in ESM projects)
    if (targetPath.endsWith(".js")) {
      targetPath = targetPath.replace(/\.js$/, ".ts");
    }
    
    // Check if the target file exists in the project
    let targetFile = project.getSourceFile(targetPath);
    if (!targetFile && existsSync(targetPath)) {
      // File exists on disk but wasn't in the ts-morph project snapshot.
      // This happens when a new file is created during a bake: the glob ran
      // before the file was written, or path normalization diverged.
      // Add it dynamically so we can resolve the relative path correctly.
      try {
        targetFile = project.addSourceFileAtPath(targetPath);
      } catch {
        // ts-morph can't parse it — skip
      }
    }
    if (targetFile) {
      return getRelativePath(targetFile.getFilePath());
    }
    
    // Try without extension (index.ts)
    const indexPath = path.join(targetPath, "index.ts");
    let indexFile = project.getSourceFile(indexPath);
    if (!indexFile && existsSync(indexPath)) {
      try {
        indexFile = project.addSourceFileAtPath(indexPath);
      } catch {
        // ts-morph can't parse it — skip
      }
    }
    if (indexFile) {
      return getRelativePath(indexFile.getFilePath());
    }
    
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract dynamic import edges from a source file.
 * Finds patterns like: const { foo, bar } = await import("./path.js")
 * Returns edges from file-level to the imported functions.
 */
function extractDynamicImportEdges(
  sourceFile: SourceFile,
  relativePath: string,
  nodes: Map<string, CallGraphNode>,
  project: Project
): CallEdge[] {
  const edges: CallEdge[] = [];
  
  try {
    // Find all call expressions that are dynamic imports (import keyword as expression)
    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    
    for (const call of callExpressions) {
      // Check if this is a dynamic import: import("...")
      const expr = call.getExpression();
      if (expr.getKind() !== SyntaxKind.ImportKeyword) {
        continue;
      }
      
      const args = call.getArguments();
      if (args.length === 0) continue;
      
      // Get the module specifier
      const specifierArg = args[0];
      // Handle casts around import specifiers.
      let specifierText = specifierArg.getText();
      if (specifierText.includes(" as ")) {
        specifierText = specifierText.split(" as ")[0].trim();
      }
      const specifier = specifierText.replace(/['"`]/g, "");
      
      // Resolve to target file
      const targetPath = resolveDynamicImportPath(
        sourceFile.getFilePath(),
        specifier,
        project
      );
      if (!targetPath) continue;
      
      // Find the containing function (caller)
      let containingFunction: string | undefined;
      let current: Node | undefined = call.getParent();
      while (current) {
        if (
          Node.isFunctionDeclaration(current) ||
          Node.isMethodDeclaration(current) ||
          Node.isArrowFunction(current) ||
          Node.isFunctionExpression(current)
        ) {
          // Get the function name
          if (Node.isFunctionDeclaration(current) || Node.isMethodDeclaration(current)) {
            const name = current.getName();
            if (name) {
              // Check for class method
              const parent = current.getParent();
              if (Node.isClassDeclaration(parent)) {
                const className = parent.getName() || "AnonymousClass";
                containingFunction = buildNodeId(relativePath, name, className);
              } else {
                containingFunction = buildNodeId(relativePath, name);
              }
            }
          } else if (Node.isArrowFunction(current) || Node.isFunctionExpression(current)) {
            // Arrow/function in variable declaration
            const parent = current.getParent();
            if (Node.isVariableDeclaration(parent)) {
              const name = parent.getName();
              containingFunction = buildNodeId(relativePath, name);
            }
          }
          break;
        }
        current = current.getParent();
      }
      
      if (!containingFunction || !nodes.has(containingFunction)) continue;
      
      // Look for destructuring pattern: const { foo, bar } = await import(...)
      // The call is: import(...)
      // Parent might be: await import(...)
      // Parent of that might be: const { foo, bar } = await import(...)
      const parent = call.getParent();
      const grandparent = parent?.getParent();
      
      // Check for await expression -> variable declarator pattern
      let varDecl: Node | undefined;
      if (Node.isAwaitExpression(parent)) {
        // grandparent could be the variable declaration
        if (grandparent && Node.isVariableDeclaration(grandparent)) {
          varDecl = grandparent;
        }
      } else if (Node.isVariableDeclaration(parent)) {
        // Direct assignment without await (less common but possible)
        varDecl = parent;
      }
      
      if (varDecl && Node.isVariableDeclaration(varDecl)) {
        const nameNode = varDecl.getNameNode();
        
        // Destructuring: const { foo, bar } = ...
        if (Node.isObjectBindingPattern(nameNode)) {
          for (const element of nameNode.getElements()) {
            const importedName = element.getPropertyNameNode()?.getText() || element.getName();
            const targetId = buildNodeId(targetPath, importedName);
            
            if (nodes.has(targetId)) {
              edges.push({
                callerId: containingFunction,
                calleeId: targetId,
                callSiteLine: call.getStartLineNumber(),
                isAsync: Node.isAwaitExpression(parent),
                isConditional: isInsideConditional(call),
                isInTry: isInsideTry(call),
                isInLoop: isInsideLoop(call),
                callText: `dynamic import: ${importedName} from ${specifier}`.slice(0, 100),
              });
            }
          }
        }
        // Namespace import: const mod = await import(...)
        // We can't trace individual function calls from this without more analysis
      }
    }
  } catch (err) {
    console.warn(`[floor-plan] Dynamic import extraction failed for ${relativePath}:`, err);
  }
  
  return edges;
}

// ---------------------------------------------------------------------------
// Registration Handler Extraction (CXM-ORPHAN)
// ---------------------------------------------------------------------------

/**
 * Pattern to match registration calls that take handler callbacks.
 * These are common in Pi extensions: registerTool, registerCommand, etc.
 */
const REGISTRATION_PATTERNS = /\b(registerTool|registerCommand|registerCommandWithArgs|registerExtension)\b/;

/**
 * Extract a synthetic handler name from a registration call expression.
 * 
 * Handles patterns like:
 *   pi.registerTool({ name: "build_floor_plan" }, async (req) => { ... })
 *   pi.registerCommand({ command: "/tray" }, async () => { ... })
 * 
 * Returns a synthetic node ID like "extensions/index.ts:handler:build_floor_plan"
 * or undefined if this isn't a registration call.
 */
function extractRegistrationHandlerName(
  call: CallExpression,
  relativePath: string
): string | undefined {
  // Check if this CallExpression is a registration call
  const callText = call.getExpression().getText();
  if (!REGISTRATION_PATTERNS.test(callText)) return undefined;

  // Look for an ObjectLiteralExpression argument with a 'name' or 'command' property
  const args = call.getArguments();
  for (const arg of args) {
    if (Node.isObjectLiteralExpression(arg)) {
      for (const prop of arg.getProperties()) {
        if (Node.isPropertyAssignment(prop)) {
          const propName = prop.getNameNode().getText();
          if (propName === "name" || propName === "command") {
            const init = prop.getInitializer();
            if (init && Node.isStringLiteral(init)) {
              const regName = init.getLiteralValue()
                .replace(/^\//, "") // strip leading slash from commands
                .replace(/[^a-zA-Z0-9_-]/g, "_"); // sanitize
              return buildNodeId(relativePath, `handler:${regName}`);
            }
          }
        }
      }
    }
  }
  return undefined;
}

/**
 * Information about a synthetic registration handler node.
 */
interface SyntheticHandlerInfo {
  /** The synthetic node ID */
  id: string;
  /** The handler function/arrow node */
  handlerNode: Node;
  /** Line where the handler starts */
  lineStart: number;
  /** Line where the handler ends */
  lineEnd: number;
  /** Whether handler is async */
  isAsync: boolean;
}

/**
 * Extract synthetic handler nodes from registration calls in a source file.
 * 
 * This finds patterns like:
 *   Pattern 1: Separate handler argument
 *     api.registerTool({ name: "my_tool" }, async (req) => { helperFn(); });
 *     pi.registerCommand({ command: "/cmd" }, () => { doStuff(); });
 * 
 *   Pattern 2: execute method inside object literal
 *     pi.registerTool({
 *       name: "my_tool",
 *       async execute(id, params) { helperFn(); }
 *     });
 * 
 * And returns information needed to create synthetic nodes and trace their calls.
 */
function extractRegistrationHandlers(
  sourceFile: SourceFile,
  relativePath: string
): SyntheticHandlerInfo[] {
  const handlers: SyntheticHandlerInfo[] = [];
  
  try {
    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    
    for (const call of callExpressions) {
      const handlerId = extractRegistrationHandlerName(call, relativePath);
      if (!handlerId) continue;
      
      // Pattern 1: Look for arrow function or function expression as separate argument
      const args = call.getArguments();
      let handlerFound = false;
      
      for (const arg of args) {
        if (Node.isArrowFunction(arg) || Node.isFunctionExpression(arg)) {
          handlers.push({
            id: handlerId,
            handlerNode: arg,
            lineStart: arg.getStartLineNumber(),
            lineEnd: arg.getEndLineNumber(),
            isAsync: arg.isAsync(),
          });
          handlerFound = true;
          break; // Only take the first handler per registration call
        }
      }
      
      // Pattern 2: Look for execute method inside object literal
      // Common Pi extension pattern
      if (!handlerFound) {
        for (const arg of args) {
          if (Node.isObjectLiteralExpression(arg)) {
            for (const prop of arg.getProperties()) {
              // Handle MethodDeclaration: execute(id, params) { ... }
              if (Node.isMethodDeclaration(prop)) {
                const methodName = prop.getName();
                if (methodName === "execute") {
                  handlers.push({
                    id: handlerId,
                    handlerNode: prop,
                    lineStart: prop.getStartLineNumber(),
                    lineEnd: prop.getEndLineNumber(),
                    isAsync: prop.isAsync(),
                  });
                  handlerFound = true;
                  break;
                }
              }
              // Handle PropertyAssignment with arrow/function: execute: async () => { ... }
              else if (Node.isPropertyAssignment(prop)) {
                const propName = prop.getNameNode().getText();
                if (propName === "execute") {
                  const init = prop.getInitializer();
                  if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
                    handlers.push({
                      id: handlerId,
                      handlerNode: init,
                      lineStart: init.getStartLineNumber(),
                      lineEnd: init.getEndLineNumber(),
                      isAsync: init.isAsync(),
                    });
                    handlerFound = true;
                    break;
                  }
                }
              }
            }
            if (handlerFound) break;
          }
        }
      }
    }
  } catch {
    // Silently skip files that fail to parse
  }
  
  return handlers;
}

// ---------------------------------------------------------------------------
// Main Builder Function
// ---------------------------------------------------------------------------

/**
 * Build the complete call graph for the codebase.
 */
// @lat: [[lat.md/architecture#Architecture#Floor Plan]]
export function buildCallGraph(options?: CallGraphBuilderOptions): FloorPlan {
  const startTime = Date.now();

  // Apply defaults
  const rootDir = options?.rootDir || process.cwd();
  const includeDirs = options?.includeDirs !== undefined ? options.includeDirs : autoDetectIncludeDirs(rootDir);
  const excludePatterns = options?.excludePatterns || DEFAULT_EXCLUDE_PATTERNS;
  const skipTests = options?.skipTests ?? true;
  const maxResolutionDepth = options?.maxResolutionDepth ?? DEFAULT_MAX_RESOLUTION_DEPTH;
  setProjectRoot(rootDir);

  // Create ts-morph Project. Use tsconfig.json when present, but support
  // small projects/snippets that do not have one.
  const tsConfigFilePath = path.join(rootDir, "tsconfig.json");
  const project = new Project({
    ...(existsSync(tsConfigFilePath) ? { tsConfigFilePath } : {}),
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: false, // We need type resolution for cross-file calls
  });

  // Add source files from include directories
  const parseErrors: Array<{ file: string; error: string }> = [];
  let fileCount = 0;

  for (const dir of includeDirs) {
    const dirPath = path.join(rootDir, dir);
    try {
      const pattern = path.join(dirPath, "**/*.{ts,tsx}").replace(/\\/g, "/");
      project.addSourceFilesAtPaths(pattern);
    } catch (err) {
      parseErrors.push({
        file: dir,
        error: `Failed to add directory: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // Filter out excluded patterns and optionally test files
  const sourceFiles = project.getSourceFiles().filter((sf) => {
    const filePath = sf.getFilePath();

    // Check exclude patterns
    for (const pattern of excludePatterns) {
      if (filePath.includes(pattern)) {
        return false;
      }
    }

    // Skip test files if requested
    if (skipTests && (filePath.includes(".test.") || filePath.includes(".spec.") || filePath.includes("/test/") || filePath.includes("/tests/"))) {
      return false;
    }

    return true;
  });

  fileCount = sourceFiles.length;
  console.log(`[floor-plan] Analyzing ${fileCount} source files...`);

  // Phase 1: Extract all callable nodes
  const nodes = new Map<string, CallGraphNode>();
  const nodesBySymbol = new Map<TsSymbol, string>();

  for (const sourceFile of sourceFiles) {
    const relativePath = getRelativePath(sourceFile.getFilePath());

    try {
      const callables = extractCallablesFromFile(sourceFile);

      for (const callable of callables) {
        const id = buildNodeId(relativePath, callable.name, callable.className);

        const graphNode: CallGraphNode = {
          id,
          name: callable.name,
          file: relativePath,
          lineStart: callable.node.getStartLineNumber(),
          lineEnd: callable.node.getEndLineNumber(),
          signature: extractSignature(callable.node),
          kind: callable.kind,
          exported: isExported(callable.node),
          isAsync: isAsyncNode(callable.node),
          sideEffects: [], // Populated by side_effect_tagger
          docComment: extractDocComment(callable.node),
        };

        nodes.set(id, graphNode);

        // Track symbol mapping for resolution
        const symbol = getNodeSymbol(callable.node);
        if (symbol) {
          nodesBySymbol.set(symbol, id);
        }
      }
    } catch (err) {
      parseErrors.push({
        file: relativePath,
        error: `Node extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  console.log(`[floor-plan] Extracted ${nodes.size} callable nodes`);

  // Phase 1b: Extract synthetic nodes for registration handlers (CXM-ORPHAN)
  // This handles anonymous arrow functions passed to registerTool(), registerCommand(), etc.
  const syntheticHandlers: Array<{ relativePath: string; handler: SyntheticHandlerInfo }> = [];
  let syntheticNodeCount = 0;

  for (const sourceFile of sourceFiles) {
    const relativePath = getRelativePath(sourceFile.getFilePath());

    try {
      const handlers = extractRegistrationHandlers(sourceFile, relativePath);

      for (const handler of handlers) {
        // Create synthetic node if it doesn't already exist
        if (!nodes.has(handler.id)) {
          const graphNode: CallGraphNode = {
            id: handler.id,
            name: handler.id.split("::")[1] ?? handler.id,
            file: relativePath,
            lineStart: handler.lineStart,
            lineEnd: handler.lineEnd,
            signature: "(synthetic handler)",
            kind: "arrow",
            exported: false,
            isAsync: handler.isAsync,
            sideEffects: [],
            synthetic: true,
            tags: ["registration-handler"],
          };
          nodes.set(handler.id, graphNode);
          syntheticNodeCount++;
        }

        // Track for Phase 2b edge extraction
        syntheticHandlers.push({ relativePath, handler });
      }
    } catch (err) {
      parseErrors.push({
        file: relativePath,
        error: `Synthetic handler extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  if (syntheticNodeCount > 0) {
    console.log(`[floor-plan] Created ${syntheticNodeCount} synthetic handler nodes`);
  }

  // Phase 2: Extract call edges
  const edges = new Map<string, CallEdge[]>();
  let edgeCount = 0;
  let unresolvedCount = 0;

  for (const sourceFile of sourceFiles) {
    const relativePath = getRelativePath(sourceFile.getFilePath());

    try {
      const callables = extractCallablesFromFile(sourceFile);

      for (const callable of callables) {
        const callerId = buildNodeId(relativePath, callable.name, callable.className);

        if (!nodes.has(callerId)) continue;

        const callerEdges: CallEdge[] = [];

        // Find all call expressions in this function's body
        callable.node.forEachDescendant((descendant) => {
          if (Node.isCallExpression(descendant)) {
            const ctx: ResolutionContext = {
              visited: new Set(),
              depth: 0,
              maxDepth: maxResolutionDepth,
            };

            const calleeId = resolveCallExpression(descendant, nodes, nodesBySymbol, ctx);

            if (calleeId && nodes.has(calleeId) && calleeId !== callerId) {
              const edge: CallEdge = {
                callerId,
                calleeId,
                callSiteLine: descendant.getStartLineNumber(),
                isAsync: isAwaitedCall(descendant),
                isConditional: isInsideConditional(descendant),
                isInTry: isInsideTry(descendant),
                isInLoop: isInsideLoop(descendant),
                callText: descendant.getText().slice(0, 100),
              };

              callerEdges.push(edge);
              edgeCount++;
            } else if (!calleeId) {
              unresolvedCount++;
            }
          }
        });

        if (callerEdges.length > 0) {
          edges.set(callerId, callerEdges);
        }
      }
    } catch (err) {
      parseErrors.push({
        file: relativePath,
        error: `Edge extraction failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  console.log(`[floor-plan] Extracted ${edgeCount} call edges (${unresolvedCount} unresolved)`);

  // Phase 2b: Extract dynamic import edges
  // Handles patterns like: const { foo, bar } = await import("./path.js")
  let dynamicEdgeCount = 0;

  for (const sourceFile of sourceFiles) {
    const relativePath = getRelativePath(sourceFile.getFilePath());

    try {
      const dynamicEdges = extractDynamicImportEdges(
        sourceFile,
        relativePath,
        nodes,
        project
      );

      for (const edge of dynamicEdges) {
        // Merge with existing edges for this caller
        const existingEdges = edges.get(edge.callerId) || [];
        // Avoid duplicate edges (same caller -> callee)
        const alreadyExists = existingEdges.some(
          (e) => e.calleeId === edge.calleeId && e.callSiteLine === edge.callSiteLine
        );
        if (!alreadyExists) {
          existingEdges.push(edge);
          edges.set(edge.callerId, existingEdges);
          dynamicEdgeCount++;
        }
      }
    } catch (err) {
      console.warn(`[floor-plan] Phase 2b failed for ${relativePath}:`, err);
    }
  }

  if (dynamicEdgeCount > 0) {
    console.log(`[floor-plan] Added ${dynamicEdgeCount} edges from dynamic imports`);
  }

  // Update total edge count for metadata
  edgeCount += dynamicEdgeCount;

  // Phase 2c: Extract edges from synthetic registration handlers (CXM-ORPHAN)
  // This traces calls INSIDE anonymous handlers to their targets
  let syntheticEdgeCount = 0;

  for (const { relativePath, handler } of syntheticHandlers) {
    try {
      const callerId = handler.id;
      const callerEdges: CallEdge[] = edges.get(callerId) || [];

      // Find all call expressions inside the handler
      handler.handlerNode.forEachDescendant((descendant) => {
        if (Node.isCallExpression(descendant)) {
          const ctx: ResolutionContext = {
            visited: new Set(),
            depth: 0,
            maxDepth: maxResolutionDepth,
          };

          const calleeId = resolveCallExpression(descendant, nodes, nodesBySymbol, ctx);

          if (calleeId && nodes.has(calleeId) && calleeId !== callerId) {
            // Avoid duplicate edges
            const alreadyExists = callerEdges.some(
              (e) => e.calleeId === calleeId && e.callSiteLine === descendant.getStartLineNumber()
            );
            if (!alreadyExists) {
              const edge: CallEdge = {
                callerId,
                calleeId,
                callSiteLine: descendant.getStartLineNumber(),
                isAsync: isAwaitedCall(descendant),
                isConditional: isInsideConditional(descendant),
                isInTry: isInsideTry(descendant),
                isInLoop: isInsideLoop(descendant),
                callText: descendant.getText().slice(0, 100),
              };
              callerEdges.push(edge);
              syntheticEdgeCount++;
            }
          }
        }
      });

      if (callerEdges.length > 0) {
        edges.set(callerId, callerEdges);
      }
    } catch {
      // Silently skip handlers that fail edge extraction
    }
  }

  if (syntheticEdgeCount > 0) {
    console.log(`[floor-plan] Added ${syntheticEdgeCount} edges from synthetic handlers`);
  }
  edgeCount += syntheticEdgeCount;

  // Phase 3: Build reverse edges
  const reverseEdges = new Map<string, string[]>();

  for (const [callerId, callerEdges] of edges) {
    for (const edge of callerEdges) {
      const callers = reverseEdges.get(edge.calleeId) || [];
      if (!callers.includes(callerId)) {
        callers.push(callerId);
      }
      reverseEdges.set(edge.calleeId, callers);
    }
  }

  const analysisTimeMs = Date.now() - startTime;
  console.log(`[floor-plan] Build complete in ${analysisTimeMs}ms`);

  // Build metadata
  const meta: FloorPlanMeta = {
    generatedAt: new Date().toISOString(),
    fileCount,
    nodeCount: nodes.size,
    edgeCount,
    analysisTimeMs,
    parseErrors,
    scannedDirs: includeDirs,
  };

  const plan: FloorPlan = {
    nodes,
    edges,
    reverseEdges,
    entryPoints: [], // Populated by entry_point_mapper
    meta,
  };

  // XPROJ-2: warn when no functions found (e.g. wrong includeDirs for this project)
  if (plan.meta.nodeCount === 0) {
    plan.meta.warning = `No functions found. Scanned: [${includeDirs.join(", ")}]. ` +
      `If your project uses different directories, pass include_dirs explicitly (e.g. ["lib", "app"]).`;
  }

  return plan;
}

// ---------------------------------------------------------------------------
// Query Helpers
// ---------------------------------------------------------------------------

/**
 * Get a node by its ID.
 */
export function getNodeById(plan: FloorPlan, id: string): CallGraphNode | undefined {
  return plan.nodes.get(id);
}

/**
 * Get all nodes that directly call the given node.
 */
export function getDirectCallers(plan: FloorPlan, nodeId: string): CallGraphNode[] {
  const callerIds = plan.reverseEdges.get(nodeId) || [];
  return callerIds
    .map((id) => plan.nodes.get(id))
    .filter((n): n is CallGraphNode => n !== undefined);
}

/**
 * Get all nodes that the given node directly calls.
 */
export function getDirectCallees(plan: FloorPlan, nodeId: string): CallGraphNode[] {
  const edges = plan.edges.get(nodeId) || [];
  return edges
    .map((e) => plan.nodes.get(e.calleeId))
    .filter((n): n is CallGraphNode => n !== undefined);
}

/**
 * Find nodes by name (partial match).
 */
export function findNodesByName(plan: FloorPlan, name: string): CallGraphNode[] {
  const results: CallGraphNode[] = [];
  for (const node of plan.nodes.values()) {
    if (node.name.includes(name) || node.id.includes(name)) {
      results.push(node);
    }
  }
  return results;
}

/**
 * Get edges between a caller and callee.
 */
export function getEdgesBetween(
  plan: FloorPlan,
  callerId: string,
  calleeId: string
): CallEdge[] {
  const edges = plan.edges.get(callerId) || [];
  return edges.filter((e) => e.calleeId === calleeId);
}
