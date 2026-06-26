/**
 * @fileoverview entry_point_mapper — detect external entry points and map them to handlers.
 * Key exports: mapEntryPoints, getEntryPointByName, getEntryPointChains, getHandlerChainForEntry
 * Depends on: node:fs, node:path, types
 * Side effects: file_read
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { FloorPlan, EntryPoint, EntryPointKind, EntryPointChain } from "../types.js";

const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const DEFAULT_SCAN_DIRS = ["src", "lib", "app", "extensions", "packages"];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".pi"]);

interface DetectedRegistration {
  id: string;
  kind: EntryPointKind;
  name: string;
  registrationFile: string;
  handlerId: string;
  description?: string;
}

/**
 * Scan source files for entry point registrations and create EntryPoint entries.
 *
 * Detection is intentionally broad and project-agnostic. It scans the directories
 * that were included in the floor plan and looks for common Pi registration APIs:
 * - pi.registerCommand("name", ...)
 * - pi.registerTool({ name: "tool_name", ... })
 * - pi.on("event_name", ...)
 */
export function mapEntryPoints(plan: FloorPlan, rootDir?: string): EntryPoint[] {
  const root = rootDir || process.cwd();
  const files = discoverSourceFiles(root, plan.meta.scannedDirs ?? DEFAULT_SCAN_DIRS);
  const byId = new Map<string, EntryPoint>();

  for (const filePath of files) {
    const content = safeRead(filePath);
    if (!content) continue;

    const relPath = path.relative(root, filePath).replace(/\\/g, "/");
    for (const registration of detectRegistrations(content, relPath, plan)) {
      byId.set(registration.id, registration);
    }
  }

  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function discoverSourceFiles(rootDir: string, includeDirs: string[]): string[] {
  const files: string[] = [];
  const seen = new Set<string>();

  const roots = includeDirs.length > 0 ? includeDirs : DEFAULT_SCAN_DIRS;
  for (const dir of roots) {
    const fullPath = path.resolve(rootDir, dir);
    if (!fs.existsSync(fullPath)) continue;
    walk(fullPath, files, seen);
  }

  return files;
}

function walk(current: string, files: string[], seen: Set<string>): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(current, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(fullPath, files, seen);
      continue;
    }

    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".spec.ts")) continue;
    if (!SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) continue;

    const normalized = path.resolve(fullPath);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      files.push(normalized);
    }
  }
}

function safeRead(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
}

function detectRegistrations(content: string, relPath: string, plan: FloorPlan): DetectedRegistration[] {
  return [
    ...detectCommands(content, relPath, plan),
    ...detectTools(content, relPath, plan),
    ...detectEventHandlers(content, relPath, plan),
  ];
}

function detectCommands(content: string, relPath: string, plan: FloorPlan): DetectedRegistration[] {
  const registrations: DetectedRegistration[] = [];
  const commandPattern = /\b\w+\.registerCommand\(\s*["']([^"']+)["']\s*,/g;
  let match: RegExpExecArray | null;

  while ((match = commandPattern.exec(content)) !== null) {
    const rawName = match[1];
    const displayName = rawName.startsWith("/") ? rawName : `/${rawName}`;
    const safeName = sanitizeRegistrationName(rawName);
    registrations.push({
      id: `cli:${displayName}`,
      kind: "cli_command",
      name: displayName,
      registrationFile: relPath,
      handlerId: findHandlerInFile(plan, relPath, [`handler:${safeName}`, `${rawName}Handler`, rawName, `${rawName}Command`]) ?? `${relPath}:handler:${safeName}`,
      description: extractDescription(content, match.index),
    });
  }

  return registrations;
}

function detectTools(content: string, relPath: string, plan: FloorPlan): DetectedRegistration[] {
  const registrations: DetectedRegistration[] = [];
  const toolPattern = /\b\w+\.registerTool\(\s*\{[\s\S]{0,1200}?\bname:\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;

  while ((match = toolPattern.exec(content)) !== null) {
    const toolName = match[1];
    const safeName = sanitizeRegistrationName(toolName);
    registrations.push({
      id: `tool:${toolName}`,
      kind: "extension_tool",
      name: toolName,
      registrationFile: relPath,
      handlerId: findHandlerInFile(plan, relPath, [`handler:${safeName}`, `${toolName}Execute`, toolName]) ?? `${relPath}:handler:${safeName}`,
      description: extractDescription(content, match.index),
    });
  }

  return registrations;
}

function detectEventHandlers(content: string, relPath: string, plan: FloorPlan): DetectedRegistration[] {
  const registrations: DetectedRegistration[] = [];
  const eventPattern = /\b\w+\.on\(\s*["']([^"']+)["']\s*,/g;
  let match: RegExpExecArray | null;

  while ((match = eventPattern.exec(content)) !== null) {
    const eventName = match[1];
    const safeName = sanitizeRegistrationName(eventName);
    registrations.push({
      id: `event:${eventName}`,
      kind: "event_handler",
      name: eventName,
      registrationFile: relPath,
      handlerId: findHandlerInFile(plan, relPath, [`handler:${safeName}`, `${eventName}Handler`, eventName]) ?? `${relPath}:handler:${safeName}`,
      description: `Event: ${eventName}`,
    });
  }

  return registrations;
}

function sanitizeRegistrationName(name: string): string {
  return name.replace(/^\//, "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function findHandlerInFile(plan: FloorPlan, file: string, candidateNames: string[]): string | undefined {
  for (const name of candidateNames) {
    const exactId = `${file}:${name}`;
    if (plan.nodes.has(exactId)) return exactId;
  }

  const lowerCandidates = candidateNames.map((name) => name.toLowerCase());
  for (const [id, node] of plan.nodes) {
    if (node.file !== file) continue;
    const lowerName = node.name.toLowerCase();
    if (lowerCandidates.some((candidate) => lowerName === candidate || lowerName.includes(candidate))) {
      return id;
    }
  }

  return undefined;
}

function extractDescription(content: string, matchIndex: number): string | undefined {
  const snippet = content.slice(matchIndex, matchIndex + 1200);
  const descMatch = snippet.match(/\bdescription:\s*["']([^"']+)["']/);
  return descMatch?.[1];
}

export function getEntryPointByName(entryPoints: EntryPoint[], name: string): EntryPoint | undefined {
  const normalized = name.startsWith("/") ? name : `/${name}`;

  return entryPoints.find((entryPoint) =>
    entryPoint.name === name ||
    entryPoint.name === normalized ||
    (entryPoint.kind === "cli_command" && entryPoint.name.slice(1) === name)
  );
}

export function getEntryPointChains(plan: FloorPlan, maxDepth: number = 5): EntryPointChain[] {
  return plan.entryPoints.map((entryPoint) => ({
    name: entryPoint.name,
    kind: entryPoint.kind,
    chain: getHandlerChainForEntry(plan, entryPoint.handlerId, maxDepth).join(" -> "),
  }));
}

export function getHandlerChainForEntry(plan: FloorPlan, handlerId: string, maxDepth: number = 5): string[] {
  const chain: string[] = [];
  const visited = new Set<string>();
  let currentId = handlerId;

  while (chain.length < maxDepth && currentId && !visited.has(currentId)) {
    visited.add(currentId);

    const node = plan.nodes.get(currentId);
    if (!node) break;

    chain.push(node.name);
    const edges = plan.edges.get(currentId) || [];
    if (edges.length === 0) break;

    const nextId = selectMostInterestingCallee(edges, plan);
    if (!nextId) break;
    currentId = nextId;
  }

  return chain;
}

function selectMostInterestingCallee(edges: Array<{ calleeId: string; isConditional: boolean }>, plan: FloorPlan): string | undefined {
  const utilityPatterns = ["clamp", "validate", "parse", "format", "normalize", "sanitize", "trim", "assert"];

  const scored = edges.map((edge) => {
    const node = plan.nodes.get(edge.calleeId);
    if (!node) return { edge, score: -1 };

    let score = 0;
    if (node.sideEffects.length > 0) score += 10;
    if (node.exported) score += 5;
    if (utilityPatterns.some((pattern) => node.name.toLowerCase().includes(pattern))) score -= 5;
    if (!edge.isConditional) score += 2;

    return { edge, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].edge.calleeId : edges[0]?.calleeId;
}
