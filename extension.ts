/**
 * pi-code-map-extension — protocol-only entry point.
 *
 * Registers the code_map node on the protocol fabric so callers can
 * invoke provides through the shared protocol gateway instead of
 * individual Pi tools.
 *
 * Bootstrap ensures @kyvernitria/pi-protocol-minimal is available for ALL
 * pi-protocol certified extensions by installing into the shared
 * ~/.pi/agent/node_modules/@kyvernitria/ location on first load.
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handlers } from "./protocol/handlers.js";

const _require = createRequire(import.meta.url);

function ensureProtocolMinimal(): void {
  try {
    _require.resolve("@kyvernitria/pi-protocol-minimal");
  } catch {
    const targetDir = join(homedir(), ".pi", "agent", "node_modules", "@kyvernitria");
    const target = join(targetDir, "pi-protocol-minimal");

    const localRepo = join(homedir(), "Applications", "pi", "pi-protocol", "packages", "pi-protocol-minimal");
    if (existsSync(localRepo)) {
      mkdirSync(targetDir, { recursive: true });
      symlinkSync(localRepo, target, "dir");
      return;
    }

    const { execSync } = _require("node:child_process");
    mkdirSync(targetDir, { recursive: true });
    execSync("npm install @kyvernitria/pi-protocol-minimal@latest", {
      cwd: join(homedir(), ".pi", "agent"),
      stdio: "pipe",
    });
  }
}

export default function codeMapExtension(pi: ExtensionAPI) {
  ensureProtocolMinimal();
  const { ensureProtocolFabric, registerProtocolManifest } = _require("@kyvernitria/pi-protocol-minimal");

  const manifest = JSON.parse(readFileSync(new URL("./pi.protocol.json", import.meta.url), "utf8"));

  const fabric = ensureProtocolFabric();
  fabric.unregister("code_map");
  registerProtocolManifest(fabric, { manifest, handlers });
}
