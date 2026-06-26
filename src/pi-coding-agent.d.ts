declare module "@earendil-works/pi-coding-agent" {
  export interface ExtensionAPI {
    registerTool(definition: unknown): void;
  }
}

declare module "@earendil-works/pi-ai" {
  import type { TSchema } from "typebox";

  export function StringEnum<T extends readonly string[]>(values: T, options?: Record<string, unknown>): TSchema;
}

declare module "@kyvernitria/pi-protocol-minimal" {
  export interface ProtocolFabric {
    unregister(nodeId: string): void;
    describeNode(nodeId: string): { provides: Array<{ name: string }> } | undefined;
    invoke(request: { nodeId: string; provide: string; input?: unknown; callerNodeId?: string }): Promise<{ ok: true; output: unknown } | { ok: false; error: unknown }>;
  }

  export function ensureProtocolFabric(): ProtocolFabric;
  export function registerProtocolManifest(
    fabric: ProtocolFabric,
    registration: {
      manifest: Record<string, unknown>;
      handlers: Record<string, (input: never) => unknown | Promise<unknown>>;
    },
  ): void;
}
