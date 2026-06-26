/**
 * pi-code-map-extension — protocol-only entry point.
 *
 * Registers the code_map node on the protocol fabric so callers can
 * invoke provides (build_floor_plan, get_side_effects, trace_call_flow,
 * get_function_callers, get_function_callees, get_entry_points)
 * through the shared protocol gateway instead of individual Pi tools.
 *
 * @kyvernitria/pi-protocol-minimal is an optional peer dep — if unavailable
 * the extension loads silently without protocol registration.
 */

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const _require = createRequire(import.meta.url);

export default function codeMapExtension(pi: ExtensionAPI) {
  registerProtocolIfAvailable();
}

function registerProtocolIfAvailable(): void {
  let protocolMinimal: typeof import("@kyvernitria/pi-protocol-minimal");
  try {
    protocolMinimal = _require("@kyvernitria/pi-protocol-minimal");
  } catch {
    // @kyvernitria/pi-protocol-minimal not installed — skip protocol registration.
    return;
  }

  const manifest = JSON.parse(
    readFileSync(new URL("./pi.protocol.json", import.meta.url), "utf8"),
  );
  const { handlers } = _require("./protocol/handlers.js");

  const fabric = protocolMinimal.ensureProtocolFabric();
  fabric.unregister("code_map");
  protocolMinimal.registerProtocolManifest(fabric, { manifest, handlers });
}
