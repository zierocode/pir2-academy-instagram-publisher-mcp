import { describe, expect, it, vi } from "vitest";
import { InstagramClient } from "../../src/instagram/instagram-client.js";

describe("InstagramClient", () => {
  it("creates, checks, and publishes a container with Bearer auth and no token in URLs", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "container-1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status_code: "FINISHED" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "media-1" }), { status: 200 }));
    const client = new InstagramClient({ apiVersion: "v23.0", fetcher });
    const credential = { accessToken: "learner-secret", userId: "17841400000000000" };

    await expect(client.createImageContainer({ ...credential, imageUrl: "https://cdn.example.com/a.png", caption: "สินค้าใหม่" })).resolves.toEqual({ creationId: "container-1" });
    await expect(client.getContainerStatus({ ...credential, creationId: "container-1" })).resolves.toBe("FINISHED");
    await expect(client.publishContainer({ ...credential, creationId: "container-1" })).resolves.toEqual({ mediaId: "media-1" });

    const calls = fetcher.mock.calls;
    expect(calls.map((call) => String(call[0]))).toEqual([
      "https://graph.instagram.com/v23.0/17841400000000000/media",
      "https://graph.instagram.com/v23.0/container-1?fields=status_code",
      "https://graph.instagram.com/v23.0/17841400000000000/media_publish",
    ]);
    expect(calls.every((call) => !String(call[0]).includes("learner-secret"))).toBe(true);
    expect((calls[0]?.[1]?.headers as Record<string, string>).authorization).toBe("Bearer learner-secret");
  });

  it("maps Meta errors to a Thai-first safe error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "token learner-secret invalid" } }), { status: 400 }),
    );
    const client = new InstagramClient({ apiVersion: "v23.0", fetcher });
    await expect(client.createImageContainer({
      accessToken: "learner-secret",
      userId: "1",
      imageUrl: "https://cdn.example.com/a.png",
      caption: "caption",
    })).rejects.toThrow("Instagram API ทำรายการไม่สำเร็จ");
  });
});
