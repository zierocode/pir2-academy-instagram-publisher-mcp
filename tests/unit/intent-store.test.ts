import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileIntentStore } from "../../src/posts/intent-store.js";
import { preparePost } from "../../src/posts/post-preview.js";

describe("post preview intents", () => {
  it("creates a 10-minute prepared intent with a stable fingerprint and Thai confirmation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pir2-instagram-intent-"));
    const store = new FileIntentStore(join(directory, "intents.json"));
    const now = new Date("2026-08-09T02:00:00.000Z");
    const preview = await preparePost({
      imageUrl: "https://cdn.example.com/design.png?signature=secret",
      caption: "เปิดตัวสินค้าใหม่",
      altText: "สินค้าใหม่บนพื้นหลังสีฟ้า",
      identity: { userId: "17841400000000000", username: "zie.agent.test" },
      media: { contentType: "image/png", contentLength: 1024 },
      store,
      now: () => now,
    });
    expect(preview).toMatchObject({
      account: "@zie.agent.test",
      caption: "เปิดตัวสินค้าใหม่",
      confirmation: "ตรวจ preview แล้วตอบว่า ‘ยืนยันโพสต์’ หรือ ‘Confirm post’",
      expiresAt: "2026-08-09T02:10:00.000Z",
    });
    expect(preview.imageUrl).toContain("signature=secret");
    const stored = await store.get(preview.intentId);
    expect(stored?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.status).toBe("prepared");
    expect(JSON.parse(await readFile(join(directory, "intents.json"), "utf8"))).toHaveLength(1);
    if (process.platform !== "win32") {
      expect((await stat(join(directory, "intents.json"))).mode & 0o777).toBe(0o600);
    }
  });

  it("rejects empty and over-limit captions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pir2-instagram-intent-"));
    const common = {
      imageUrl: "https://cdn.example.com/a.png",
      identity: { userId: "1", username: "test" },
      media: { contentType: "image/png" as const, contentLength: 1 },
      store: new FileIntentStore(join(directory, "intents.json")),
    };
    await expect(preparePost({ ...common, caption: "" })).rejects.toThrow("caption");
    await expect(preparePost({ ...common, caption: "x".repeat(2201) })).rejects.toThrow("2,200");
  });

  it("keeps the file store usable after a rejected atomic transition", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pir2-instagram-intent-"));
    const store = new FileIntentStore(join(directory, "intents.json"));
    const preview = await preparePost({
      imageUrl: "https://cdn.example.com/a.png",
      caption: "สินค้าใหม่",
      identity: { userId: "1", username: "test" },
      media: { contentType: "image/png", contentLength: 1 },
      store,
    });
    await expect(store.update(preview.intentId, () => { throw new Error("reject transition"); })).rejects.toThrow("reject transition");
    await expect(store.get(preview.intentId)).resolves.toMatchObject({ status: "prepared" });
  });
});
