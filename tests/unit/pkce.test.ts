import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPkce } from "../../src/auth/pkce.js";

describe("PKCE", () => {
  it("creates an S256 verifier and matching challenge", () => {
    const pkce = createPkce();
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(pkce.challenge).toBe(createHash("sha256").update(pkce.verifier).digest("base64url"));
  });
});
