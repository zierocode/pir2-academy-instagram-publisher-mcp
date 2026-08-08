import { describe, expect, it } from "vitest";
import { buildServerIdentity } from "../../src/server.js";

describe("startup contract", () => {
  it("uses a stable server identity", () => {
    expect(buildServerIdentity()).toEqual({
      name: "pir2-academy-instagram-publisher",
      version: "0.1.0",
    });
  });
});
