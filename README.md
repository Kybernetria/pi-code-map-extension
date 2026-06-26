# pi-code-map-extension

A small, read-only Pi extension (+ pi-protocol node) that gives agents "X-ray vision" for TypeScript projects.

It scans a codebase, builds a function-level call graph, tags side effects, detects Pi-style entry points, and exposes a compact tool surface for planning safe edits.

## Tools (Pi Extension)

Registered as Pi tools when loaded as an extension:

- `build_floor_plan` — build/rebuild the code map and return scan stats.
- `get_side_effects` — find file writes, DB writes, LLM calls, network calls, exec usage, and other risky functions.
- `trace_call_flow` — trace call paths between two function IDs or names.
- `get_function_callers` — list direct callers of a function.
- `get_function_callees` — list direct callees of a function.
- `get_entry_points` — list detected Pi tools, commands, and event handlers.

All tools are read-only. They inspect `.ts` files but do not mutate the target project.

## Protocol Provides (pi-protocol)

The package depends on `@kyvernitria/pi-protocol-minimal` and registers a protocol node
`code_map` with the same six capabilities as handler-backed provides. Other protocol nodes can
invoke these provides through the shared fabric without going through the Pi tool system.

| Provide | Description |
|---------|-------------|
| `code_map.build_floor_plan` | Build/rebuild the code map |
| `code_map.get_side_effects` | List functions with side effects |
| `code_map.trace_call_flow` | Trace call paths between two functions |
| `code_map.get_function_callers` | List direct callers of a function |
| `code_map.get_function_callees` | List direct callees of a function |
| `code_map.get_entry_points` | List detected entry points |

**Input/output schemas** follow the same parameters as the Pi tools — see `pi.protocol.json` for
the full JSON Schema definitions.

All provides are **read-only** (declared effect: `file_read`).

### Protocol registration (from another extension)

```typescript
import { ensureProtocolFabric, registerProtocolManifest } from "@kyvernitria/pi-protocol-minimal";

const fabric = ensureProtocolFabric();
fabric.unregister("code_map"); // reload-safe

registerProtocolManifest(fabric, {
  manifest: { /* ... or load from file */ },
  handlers: {
    build_floor_plan: async (input) => { /* ... */ },
    // ...
  },
});
```

### Invocation (from any protocol node)

```typescript
const result = await fabric.invoke({
  nodeId: "code_map",
  provide: "get_side_effects",
  input: { min_risk: "high", limit: 10 },
});
```

## Install / load

```bash
npm install
pi -e ./extension.ts
```

Or copy/link the directory into a Pi extension location such as `.pi/extensions/pi-code-map-extension/`
or `~/.pi/agent/extensions/pi-code-map-extension/` and reload Pi.

### Protocol dependency

This local extraction uses the nearby pi-protocol checkout:

```json
"@kyvernitria/pi-protocol-minimal": "file:../../pi-protocol/packages/pi-protocol-minimal"
```

For published distribution, replace that local `file:` dependency with a published semver range.

## Common workflows

### Map a codebase

Call `build_floor_plan` first:

```json
{ "rebuild": true }
```

Useful options:

```json
{ "include_dirs": ["src", "lib", "app"] }
```

If `include_dirs` is omitted, the extension auto-detects common TypeScript source directories.

### Find side effects before editing

Examples:

```json
{ "type": "file_write", "min_risk": "medium" }
```

```json
{ "type": "llm_call" }
```

```json
{ "min_risk": "high" }
```

### Inspect callers/callees

```json
{ "function": "src/server.ts:startServer" }
```

Function lookup accepts exact IDs or name fragments. If a query is ambiguous, the tool returns
candidates.

### Trace flow before changing code

```json
{ "from": "main", "to": "writeConfig", "max_depth": 8 }
```

Use this to understand how an entry point reaches a risky function before editing.

## Development

```bash
npm test
npm run typecheck
```

Package shape:

```text
pi-code-map-extension/
  package.json
  pi.protocol.json            # pi-protocol manifest (6 provides)
  extension.ts                # Pi extension entry point (registers tools + optional protocol)
  protocol/
    index.ts                  # Re-exports for protocol consumers
    handlers.ts               # Handler-backed provide implementations
  src/
    floor_plan_manager.ts
    types.ts
    extension/*
    tools/*
  tests/*
```
