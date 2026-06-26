import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureProtocolFabric, registerProtocolManifest } from "@kyvernitria/pi-protocol-minimal";
import { handlers } from "../protocol/handlers.js";

const manifest = JSON.parse(readFileSync(new URL("../pi.protocol.json", import.meta.url), "utf-8"));

describe("pi-protocol integration", () => {
  it("registers code_map provides and invokes a handler through the fabric", async () => {
    const root = mkdtempSync(join(tmpdir(), "code-map-protocol-"));
    try {
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "src", "index.ts"), `
        export function greet(name: string) { return name; }
        export function main() { return greet("world"); }
      `);

      const fabric = ensureProtocolFabric();
      fabric.unregister("code_map");
      registerProtocolManifest(fabric, { manifest, handlers });

      expect(fabric.describeNode("code_map")?.provides.map((provide) => provide.name)).toContain("build_floor_plan");

      const result = await fabric.invoke({
        nodeId: "code_map",
        provide: "build_floor_plan",
        input: { root_dir: root, include_dirs: ["src"], rebuild: true },
        callerNodeId: "test.protocol",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.output).toMatchObject({ entryPointCount: 0 });
        expect((result.output as { meta: { nodeCount: number } }).meta.nodeCount).toBeGreaterThanOrEqual(2);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
