/**
 * pi-code-map-extension — protocol-only entry point.
 *
 * Registers the code_map node on the protocol fabric so callers can
 * invoke provides (build_floor_plan, get_side_effects, trace_call_flow,
 * get_function_callers, get_function_callees, get_entry_points)
 * through the shared protocol gateway instead of individual Pi tools.
 */

import { readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function codeMapExtension(pi: ExtensionAPI) {
  void registerProtocolManifestIfAvailable();
}

async function registerProtocolManifestIfAvailable(): Promise<void> {
  let protocolMinimal: typeof import("@kyvernitria/pi-protocol-minimal");
  try {
    protocolMinimal = await import("@kyvernitria/pi-protocol-minimal");
  } catch {
    return;
  }

  const manifest = await readManifest();
  const { handlers } = await import("./protocol/handlers.js");

  const fabric = protocolMinimal.ensureProtocolFabric();
  fabric.unregister("code_map");
  protocolMinimal.registerProtocolManifest(fabric, { manifest, handlers });
}

async function readManifest(): Promise<Record<string, unknown>> {
  const url = new URL("./pi.protocol.json", import.meta.url);
  return JSON.parse(await readFile(url, "utf-8")) as Record<string, unknown>;
}
