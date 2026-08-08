import { describe, expect, it, vi } from "vitest";
import { createPinnedLookup, MediaValidator } from "../../src/media/media-validator.js";

function validator(options: {
  addresses?: string[];
  response?: { status: number; headers?: Record<string, string> };
  responses?: Array<{ status: number; headers?: Record<string, string> }>;
} = {}) {
  const responses = [...(options.responses ?? [options.response ?? {
    status: 200,
    headers: { "content-type": "image/png", "content-length": "1024" },
  }])];
  const probe = vi.fn(async () => {
    const response = responses.shift() ?? { status: 500, headers: {} };
    return { status: response.status, headers: response.headers ?? {} };
  });
  return {
    service: new MediaValidator({
      resolve: async () => options.addresses ?? ["8.8.8.8"],
      probe,
    }),
    probe,
  };
}

describe("MediaValidator", () => {
  it("returns an address array when Node requests lookup all", async () => {
    const lookup = createPinnedLookup("104.16.102.112");
    const result = await new Promise<unknown>((resolve, reject) => {
      lookup("cdn.example.com", { all: true }, (error, address, family) => {
        if (error) reject(error);
        else resolve({ address, family });
      });
    });

    expect(result).toEqual({ address: [{ address: "104.16.102.112", family: 4 }], family: undefined });
  });

  it("accepts one public HTTPS JPEG or PNG within 8 MB", async () => {
    const { service, probe } = validator();
    await expect(service.validate("https://cdn.example.com/design.png?signature=secret")).resolves.toEqual({
      contentType: "image/png",
      contentLength: 1024,
    });
    expect(probe).toHaveBeenCalledWith(expect.anything(), "8.8.8.8", undefined, "GET");
  });

  it("rejects HTTP, embedded credentials, and literal private IP hosts", async () => {
    const { service } = validator();
    await expect(service.validate("http://cdn.example.com/a.png")).rejects.toThrow("HTTPS");
    await expect(service.validate("https://name:pass@cdn.example.com/a.png")).rejects.toThrow("URL");
    await expect(service.validate("https://127.0.0.1/a.png")).rejects.toThrow("private");
  });

  it("fails closed when any DNS answer is private or reserved", async () => {
    const { service, probe } = validator({ addresses: ["8.8.8.8", "10.0.0.8"] });
    await expect(service.validate("https://cdn.example.com/a.png")).rejects.toThrow("private");
    expect(probe).not.toHaveBeenCalled();
  });

  it("revalidates every redirect target", async () => {
    const probe = vi.fn()
      .mockResolvedValueOnce({ status: 302, headers: { location: "https://127.0.0.1/private.png" } });
    const service = new MediaValidator({ resolve: async () => ["8.8.8.8"], probe });
    await expect(service.validate("https://cdn.example.com/a.png")).rejects.toThrow("private");
  });

  it("rejects non-images and images larger than 8 MB", async () => {
    const wrongType = validator({ response: { status: 200, headers: { "content-type": "text/html" } } }).service;
    const tooLarge = validator({ response: { status: 200, headers: {
      "content-type": "image/jpeg",
      "content-length": String(8 * 1024 * 1024 + 1),
    } } }).service;
    await expect(wrongType.validate("https://cdn.example.com/a")).rejects.toThrow("JPEG หรือ PNG");
    await expect(tooLarge.validate("https://cdn.example.com/a.jpg")).rejects.toThrow("8 MB");
  });

  it("uses the total size from a ranged GET response", async () => {
    const tooLarge = validator({ response: { status: 206, headers: {
      "content-type": "image/jpeg",
      "content-length": "1",
      "content-range": `bytes 0-0/${8 * 1024 * 1024 + 1}`,
    } } }).service;

    await expect(tooLarge.validate("https://cdn.example.com/a.jpg")).rejects.toThrow("8 MB");
  });
});
