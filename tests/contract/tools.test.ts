import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createToolCatalog } from "../../src/server.js";

const TOOL_NAMES = [
  "instagram_auth_status",
  "connect_instagram",
  "prepare_instagram_post",
  "publish_instagram_post",
];

describe("Instagram Publisher tool contract", () => {
  it("declares the Thai-first PiR2 MCPB identity", () => {
    const manifest = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../manifest.json"), "utf8"),
    ) as Record<string, unknown>;

    expect(manifest).toMatchObject({
      manifest_version: "0.4",
      name: "pir2-academy-instagram-publisher",
      display_name: "PiR2 Academy — Instagram Publisher",
      author: { name: "PiR2 Academy" },
      compatibility: { platforms: ["darwin", "win32"] },
    });
    expect(manifest.description).toContain("โพสต์");
  });

  it("exposes exactly four Thai-first tools", () => {
    const tools = createToolCatalog();
    expect(tools.map((tool) => tool.name)).toEqual(TOOL_NAMES);
    expect(tools.every((tool) => /[ก-๙]/u.test(tool.description))).toBe(true);
  });

  it("marks only the final publish tool as destructive", () => {
    const tools = createToolCatalog();
    expect(tools.map((tool) => [tool.name, tool.annotations?.destructiveHint ?? false])).toEqual([
      ["instagram_auth_status", false],
      ["connect_instagram", false],
      ["prepare_instagram_post", false],
      ["publish_instagram_post", true],
    ]);
  });

  it("locks the prepare and publish input contracts", () => {
    const tools = createToolCatalog();
    const prepare = tools.find((tool) => tool.name === "prepare_instagram_post");
    const publish = tools.find((tool) => tool.name === "publish_instagram_post");
    expect(prepare?.inputSchema.safeParse({ image_url: "https://example.com/a.png", caption: "สวัสดี" }).success).toBe(true);
    expect(publish?.inputSchema.safeParse({ intent_id: "intent-1", confirmation_text: "ยืนยันโพสต์" }).success).toBe(true);
  });
});
