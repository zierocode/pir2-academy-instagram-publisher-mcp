import { describe, expect, it } from "vitest";
import { KeyringTokenStore, type KeyringBinding } from "../../src/auth/token-store-keyring.js";

describe("keyring token store", () => {
  it("round-trips a validated credential through the injected OS vault binding", async () => {
    const values = new Map<string, string>();
    const binding: KeyringBinding = {
      Entry: class {
        readonly key: string;
        constructor(service: string, account: string) { this.key = `${service}:${account}`; }
        getPassword(): string | null { return values.get(this.key) ?? null; }
        setPassword(value: string): void { values.set(this.key, value); }
        deletePassword(): void { values.delete(this.key); }
      },
    };
    const store = new KeyringTokenStore(binding);
    const credential = {
      accessToken: "token",
      userId: "17841400000000000",
      username: "zie.agent.test",
      expiresAt: "2026-10-08T03:00:00.000Z",
      scopes: ["instagram_business_basic", "instagram_business_content_publish"],
    };
    await store.set(credential);
    expect(await store.get()).toEqual(credential);
    await store.delete();
    expect(await store.get()).toBeNull();
  });
});
