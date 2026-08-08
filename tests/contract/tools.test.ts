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

  it("returns Thai-first auth status and connect receipts", async () => {
    const tools = createToolCatalog({
      oauth: {
        getCredential: async () => ({
          accessToken: "secret",
          userId: "17841400000000000",
          username: "zie.agent.test",
          expiresAt: "2026-10-08T03:00:00.000Z",
          scopes: ["instagram_business_basic", "instagram_business_content_publish"],
        }),
        connect: async () => ({ userId: "17841400000000000", username: "zie.agent.test" }),
      },
    });
    const status = await tools[0]!.handler({});
    const connect = await tools[1]!.handler({});
    expect(status.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("พร้อมใช้งาน") });
    expect(connect.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("เชื่อม Instagram สำเร็จ") });
    expect(JSON.stringify([status, connect])).not.toContain("secret");
  });

  it("prepares a source-backed preview without publishing", async () => {
    let storedStatus = "";
    const tools = createToolCatalog({
      oauth: {
        getCredential: async () => ({
          accessToken: "secret",
          userId: "17841400000000000",
          username: "zie.agent.test",
          expiresAt: "2026-10-08T03:00:00.000Z",
          scopes: ["instagram_business_basic", "instagram_business_content_publish"],
        }),
        connect: async () => ({ userId: "17841400000000000", username: "zie.agent.test" }),
      },
      media: { validate: async () => ({ contentType: "image/png", contentLength: 1024 }) },
      intents: {
        get: async () => null,
        put: async (intent) => { storedStatus = intent.status; },
      },
    });
    const result = await tools[2]!.handler({
      image_url: "https://cdn.example.com/design.png",
      caption: "สินค้าใหม่",
    });
    expect(result.isError).not.toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("ยืนยันโพสต์") });
    expect(storedStatus).toBe("prepared");
  });
});
