import { describe, expect, it, vi } from "vitest";
import type { InstagramCredential } from "../../src/auth/token-store.js";
import type { InstagramClientContract } from "../../src/instagram/instagram-client.js";
import { InMemoryIntentStore, type PostIntent } from "../../src/posts/intent-store.js";
import { PostPublisher } from "../../src/posts/publisher.js";

const credential: InstagramCredential = {
  accessToken: "token",
  userId: "17841400000000000",
  username: "zie.agent.test",
  expiresAt: "2026-10-08T03:00:00.000Z",
  scopes: ["instagram_business_basic", "instagram_business_content_publish"],
};

function intent(overrides: Partial<PostIntent> = {}): PostIntent {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    status: "prepared",
    fingerprint: "a".repeat(64),
    userId: credential.userId,
    username: credential.username,
    imageUrl: "https://cdn.example.com/a.png",
    caption: "สินค้าใหม่",
    preparedAt: "2026-08-09T02:00:00.000Z",
    expiresAt: "2026-08-09T02:10:00.000Z",
    ...overrides,
  };
}

function setup(overrides: Partial<InstagramClientContract> = {}) {
  const store = new InMemoryIntentStore([intent()]);
  const instagram: InstagramClientContract = {
    createImageContainer: vi.fn(async () => ({ creationId: "container-1" })),
    getContainerStatus: vi.fn(async () => "FINISHED" as const),
    publishContainer: vi.fn(async () => ({ mediaId: "media-1" })),
    ...overrides,
  };
  const publisher = new PostPublisher({
    store,
    instagram,
    getCredential: async () => credential,
    now: () => new Date("2026-08-09T02:05:00.000Z"),
    sleep: async () => undefined,
    maxStatusChecks: 3,
  });
  return { publisher, instagram, store };
}

describe("PostPublisher", () => {
  it("requires the exact confirmation before any Meta write", async () => {
    const { publisher, instagram } = setup();
    await expect(publisher.publish(intent().id, "โอเค")).rejects.toThrow("ยืนยันโพสต์");
    expect(instagram.createImageContainer).not.toHaveBeenCalled();
  });

  it("publishes a prepared intent once and returns a durable receipt", async () => {
    const { publisher, instagram, store } = setup();
    await expect(publisher.publish(intent().id, "ยืนยันโพสต์")).resolves.toMatchObject({
      mediaId: "media-1",
      account: "@zie.agent.test",
      duplicatePrevented: false,
    });
    expect(instagram.createImageContainer).toHaveBeenCalledOnce();
    expect((await store.get(intent().id))?.status).toBe("published");

    await expect(publisher.publish(intent().id, "Confirm post")).resolves.toMatchObject({
      mediaId: "media-1",
      duplicatePrevented: true,
    });
    expect(instagram.createImageContainer).toHaveBeenCalledOnce();
    expect(instagram.publishContainer).toHaveBeenCalledOnce();
  });

  it("rejects expired previews and account changes before a Meta write", async () => {
    const expired = setup();
    await expired.store.put(intent({ expiresAt: "2026-08-09T02:04:59.000Z" }));
    await expect(expired.publisher.publish(intent().id, "ยืนยันโพสต์")).rejects.toThrow("หมดอายุ");
    const changed = setup();
    await changed.store.put(intent({ userId: "someone-else" }));
    await expect(changed.publisher.publish(intent().id, "ยืนยันโพสต์")).rejects.toThrow("account");
    expect(expired.instagram.createImageContainer).not.toHaveBeenCalled();
    expect(changed.instagram.createImageContainer).not.toHaveBeenCalled();
  });

  it("marks an ambiguous publish failure unknown and never retries automatically", async () => {
    const { publisher, instagram, store } = setup({
      publishContainer: vi.fn(async () => { throw new Error("network timeout"); }),
    });
    await expect(publisher.publish(intent().id, "ยืนยันโพสต์")).rejects.toThrow("ไม่ทราบผล");
    expect((await store.get(intent().id))?.status).toBe("unknown");
    await expect(publisher.publish(intent().id, "ยืนยันโพสต์")).rejects.toThrow("ตรวจใน Instagram");
    expect(instagram.createImageContainer).toHaveBeenCalledOnce();
  });

  it("fails closed when container processing errors or never finishes", async () => {
    const errored = setup({ getContainerStatus: vi.fn(async () => "ERROR" as const) });
    await expect(errored.publisher.publish(intent().id, "ยืนยันโพสต์")).rejects.toThrow("ประมวลผลภาพไม่สำเร็จ");
    expect((await errored.store.get(intent().id))?.status).toBe("failed");
    const timeout = setup({ getContainerStatus: vi.fn(async () => "IN_PROGRESS" as const) });
    await expect(timeout.publisher.publish(intent().id, "ยืนยันโพสต์")).rejects.toThrow("ไม่ทราบผล");
    expect((await timeout.store.get(intent().id))?.status).toBe("unknown");
  });

  it("allows only one concurrent claim for the same preview", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { publisher, instagram } = setup({
      createImageContainer: vi.fn(async () => { await gate; return { creationId: "container-1" }; }),
    });
    const first = publisher.publish(intent().id, "ยืนยันโพสต์");
    await expect(publisher.publish(intent().id, "ยืนยันโพสต์")).rejects.toThrow("กำลังโพสต์");
    release();
    await expect(first).resolves.toMatchObject({ mediaId: "media-1" });
    expect(instagram.createImageContainer).toHaveBeenCalledOnce();
  });

  it("marks a status-network failure unknown so it cannot auto-retry", async () => {
    const { publisher, store } = setup({
      getContainerStatus: vi.fn(async () => { throw new Error("network"); }),
    });
    await expect(publisher.publish(intent().id, "ยืนยันโพสต์")).rejects.toThrow("ไม่ทราบผล");
    expect((await store.get(intent().id))?.status).toBe("unknown");
  });
});
