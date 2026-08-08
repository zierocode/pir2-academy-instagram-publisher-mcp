import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const PACKAGE = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as { version: string };
const BUNDLE = resolve(ROOT, "dist", `pir2-academy-instagram-publisher-${PACKAGE.version}.mcpb`);

describe("Instagram Publisher MCPB", () => {
  it("packs a verified cross-platform archive with a matching SHA-256", () => {
    const packed = spawnSync(process.execPath, [resolve(ROOT, "scripts/pack.mjs")], { cwd: ROOT, encoding: "utf8" });
    expect(packed.status, `${packed.stdout}\n${packed.stderr}`).toBe(0);
    expect(existsSync(BUNDLE)).toBe(true);
    const expected = readFileSync(`${BUNDLE}.sha256`, "utf8").trim().split(/\s+/u)[0];
    expect(expected).toBe(createHash("sha256").update(readFileSync(BUNDLE)).digest("hex"));
    const verified = spawnSync(process.execPath, [resolve(ROOT, "scripts/verify-bundle.mjs")], { cwd: ROOT, encoding: "utf8" });
    expect(verified.status, `${verified.stdout}\n${verified.stderr}`).toBe(0);
    expect(verified.stdout).toContain("bundle verified");
  }, 300_000);
});
