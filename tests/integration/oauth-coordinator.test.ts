import { describe, expect, it, vi } from "vitest";
import { InstagramOAuthCoordinator, type OAuthCallbackListener } from "../../src/auth/oauth-coordinator.js";
import type { BrokerClient, BrokerSession } from "../../src/auth/broker-client.js";
import type { InstagramCredential, TokenStore } from "../../src/auth/token-store.js";

const credential: InstagramCredential = {
  accessToken: "token",
  userId: "17841400000000000",
  username: "zie.agent.test",
  expiresAt: "2026-10-08T03:00:00.000Z",
  scopes: ["instagram_business_basic", "instagram_business_content_publish"],
};
const brokerSession: BrokerSession = {
  authorizationUrl: "https://www.instagram.com/oauth/authorize?state=state-1234567890abcdef",
  state: "state-1234567890abcdef",
  expiresAt: "2026-08-09T03:00:00.000Z",
};

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup(callback = { state: brokerSession.state, grant: "grant-1" }) {
  let stored: InstagramCredential | null = null;
  const tokenStore: TokenStore = {
    get: async () => stored,
    set: async (value) => { stored = value; },
    delete: async () => { stored = null; },
  };
  const listener: OAuthCallbackListener = {
    callbackUri: "http://127.0.0.1:43123/oauth/callback",
    wait: vi.fn(async () => callback),
    close: vi.fn(async () => undefined),
  };
  const broker = {
    createSession: vi.fn(async () => brokerSession),
    redeem: vi.fn(async () => credential),
  } as unknown as BrokerClient;
  const browser = { open: vi.fn(async () => undefined) };
  const coordinator = new InstagramOAuthCoordinator({
    broker,
    tokenStore,
    browser,
    listenerFactory: { open: vi.fn(async () => listener) },
  });
  return { coordinator, broker, browser, listener, tokenStore };
}

describe("InstagramOAuthCoordinator", () => {
  it("opens Instagram, validates callback state, redeems once, and stores locally", async () => {
    const { coordinator, broker, browser, tokenStore, listener } = setup();
    await expect(coordinator.connect()).resolves.toEqual({ userId: credential.userId, username: credential.username });
    expect(browser.open).toHaveBeenCalledWith(brokerSession.authorizationUrl);
    expect(broker.redeem).toHaveBeenCalledWith(expect.objectContaining({ grant: "grant-1" }), expect.any(AbortSignal));
    expect(await tokenStore.get()).toEqual(credential);
    expect(listener.close).toHaveBeenCalledOnce();
  });

  it("fails closed when callback state does not match", async () => {
    const { coordinator, broker } = setup({ state: "wrong-state-123456", grant: "grant-1" });
    await expect(coordinator.connect()).rejects.toThrow("OAuth state ไม่ตรงกัน");
    expect(broker.redeem).not.toHaveBeenCalled();
  });

  it("shares one flow and lets one cancelled caller leave without stopping the other", async () => {
    const done = deferred<{ state: string; grant: string }>();
    const { coordinator, browser, listener } = setup();
    vi.mocked(listener.wait).mockImplementation(async () => done.promise);
    const firstAbort = new AbortController();
    const first = coordinator.connect(firstAbort.signal);
    const second = coordinator.connect();
    firstAbort.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    done.resolve({ state: brokerSession.state, grant: "grant-1" });
    await expect(second).resolves.toEqual({ userId: credential.userId, username: credential.username });
    expect(browser.open).toHaveBeenCalledOnce();
  });

  it("closes the local listener when the final caller cancels", async () => {
    const never = new Promise<{ state: string; grant: string }>(() => undefined);
    const { coordinator, listener } = setup();
    vi.mocked(listener.wait).mockImplementation(async () => never);
    const abort = new AbortController();
    const call = coordinator.connect(abort.signal);
    abort.abort();
    await expect(call).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(listener.close).toHaveBeenCalledOnce());
  });
});
