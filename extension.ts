/**
 * pi-code-map-extension — protocol-only entry point.
 *
 * Bootstrap ensures @kyvernitria/pi-protocol-minimal is available for ALL
 * pi-protocol certified extensions by self-installing into node_modules.
 * First load creates the symlink; subsequent loads find it already present.
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handlers } from "./protocol/handlers.js";

const _require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

function ensureProtocolMinimal(): void {
  const targetDir = join(__dirname, "node_modules", "@kyvernitria");
  const target = join(targetDir, "pi-protocol-minimal");

  // If the symlink or install already exists, we're done.
  if (existsSync(target)) return;

  const localRepo = join(homedir(), "Applications", "pi", "pi-protocol", "packages", "pi-protocol-minimal");

  const localRepo = join(homedir(), "Applications", "pi", "pi-protocol", "packages", "pi-protocol-minimal");
  if (existsSync(localRepo)) {
    mkdirSync(targetDir, { recursive: true });
    symlinkSync(localRepo, target, "dir");
    return;
  }

  const { execSync } = _require("node:child_process");
  mkdirSync(targetDir, { recursive: true });
  execSync("npm install @kyvernitria/pi-protocol-minimal@latest", { cwd: __dirname, stdio: "pipe" });
}

export default function codeMapExtension(pi: ExtensionAPI) {
  ensureProtocolMinimal();
  const { ensureProtocolFabric, registerProtocolManifest } = _require("@kyvernitria/pi-protocol-minimal");

  const manifest = JSON.parse(readFileSync(new URL("./pi.protocol.json", import.meta.url), "utf8"));

  const fabric = ensureProtocolFabric();
  fabric.unregister("code_map");
  registerProtocolManifest(fabric, { manifest, handlers });
}
