import { describe, expect, it, vi } from "vitest";
import { BrokerClient } from "../../src/auth/broker-client.js";

describe("BrokerClient", () => {
  it("creates and redeems a PKCE-bound session without leaking secrets into URLs", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        authorization_url: "https://www.instagram.com/oauth/authorize?client_id=1037826479159358&state=state-1234567890abcdef",
        state: "state-1234567890abcdef",
        expires_at: "2026-08-09T03:00:00.000Z",
      }), { status: 201, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "learner-token",
        user_id: "17841400000000000",
        username: "zie.agent.test",
        expires_at: "2026-10-08T03:00:00.000Z",
        scopes: ["instagram_business_basic", "instagram_business_content_publish"],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = new BrokerClient({ baseUrl: "https://meta-oauth.zie-agent.cloud/instagram", fetcher });

    const session = await client.createSession({
      callbackUri: "http://127.0.0.1:43123/oauth/callback",
      codeChallenge: "c".repeat(43),
    });
    const credential = await client.redeem({ grant: "grant-1", codeVerifier: "v".repeat(43) });

    expect(session.state).toBe("state-1234567890abcdef");
    expect(credential.username).toBe("zie.agent.test");
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://meta-oauth.zie-agent.cloud/instagram/oauth/sessions");
    expect(String(fetcher.mock.calls[1]?.[0])).not.toContain("grant-1");
    expect(JSON.stringify(fetcher.mock.calls)).not.toContain("learner-token");
  });

  it("returns a Thai-first safe error without exposing the broker response", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("Meta said secret=unsafe", { status: 502 }),
    );
    const client = new BrokerClient({ baseUrl: "https://meta-oauth.zie-agent.cloud/instagram", fetcher });
    await expect(client.createSession({
      callbackUri: "http://127.0.0.1:43123/oauth/callback",
      codeChallenge: "c".repeat(43),
    })).rejects.toThrow("เชื่อม OAuth Broker ไม่สำเร็จ");
  });
});
