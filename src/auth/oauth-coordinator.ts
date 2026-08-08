import { createServer, type Server as HttpServer, type ServerResponse } from "node:http";
import open from "open";
import type { BrokerClient } from "./broker-client.js";
import { createPkce } from "./pkce.js";
import type { InstagramCredential, TokenStore } from "./token-store.js";

export interface InstagramIdentity { userId: string; username?: string }

export interface OAuthCallbackListener {
  callbackUri: string;
  wait(signal: AbortSignal): Promise<{ state: string; grant: string }>;
  close(): Promise<void>;
}

interface ListenerFactory {
  open(signal: AbortSignal): Promise<OAuthCallbackListener>;
}

interface BrowserOpener { open(url: string): Promise<unknown> }

interface CoordinatorDependencies {
  broker: Pick<BrokerClient, "createSession" | "redeem">;
  tokenStore: TokenStore;
  browser: BrowserOpener;
  listenerFactory: ListenerFactory;
}

interface ActiveOperation {
  controller: AbortController;
  owners: Set<symbol>;
  promise: Promise<InstagramIdentity>;
  listener?: OAuthCallbackListener;
}

function abortError(): DOMException {
  return new DOMException("ยกเลิกการเชื่อม Instagram แล้ว", "AbortError");
}

async function awaitWithSignal<Value>(promise: Promise<Value>, signal: AbortSignal): Promise<Value> {
  if (signal.aborted) throw abortError();
  return await new Promise<Value>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export class InstagramOAuthCoordinator {
  #active?: ActiveOperation;

  constructor(private readonly dependencies: CoordinatorDependencies) {}

  async getCredential(): Promise<InstagramCredential | null> {
    const credential = await this.dependencies.tokenStore.get();
    if (!credential) return null;
    if (Date.parse(credential.expiresAt) <= Date.now()) {
      await this.dependencies.tokenStore.delete();
      return null;
    }
    return credential;
  }

  connect(signal?: AbortSignal): Promise<InstagramIdentity> {
    if (signal?.aborted) return Promise.reject(abortError());
    const active = this.#active ?? this.startOperation();
    const owner = Symbol("oauth-caller");
    active.owners.add(owner);
    return this.waitForOwner(active, owner, signal);
  }

  async close(): Promise<void> {
    const active = this.#active;
    if (!active) return;
    this.#active = undefined;
    active.controller.abort();
    await active.listener?.close();
  }

  private startOperation(): ActiveOperation {
    const active: ActiveOperation = {
      controller: new AbortController(),
      owners: new Set(),
      promise: Promise.resolve({ userId: "" }),
    };
    active.promise = this.runFlow(active);
    active.promise.then(
      () => { if (this.#active === active) this.#active = undefined; },
      () => { if (this.#active === active) this.#active = undefined; },
    );
    this.#active = active;
    return active;
  }

  private async runFlow(active: ActiveOperation): Promise<InstagramIdentity> {
    const { broker, tokenStore, browser, listenerFactory } = this.dependencies;
    try {
      const listener = await listenerFactory.open(active.controller.signal);
      active.listener = listener;
      const pkce = createPkce();
      const session = await broker.createSession(
        { callbackUri: listener.callbackUri, codeChallenge: pkce.challenge },
        active.controller.signal,
      );
      await awaitWithSignal(Promise.resolve(browser.open(session.authorizationUrl)), active.controller.signal);
      const timeoutMs = Math.max(1, Math.min(10 * 60_000, Date.parse(session.expiresAt) - Date.now()));
      const timeout = setTimeout(() => active.controller.abort(), timeoutMs);
      timeout.unref?.();
      let callback: { state: string; grant: string };
      try {
        callback = await awaitWithSignal(listener.wait(active.controller.signal), active.controller.signal);
      } finally {
        clearTimeout(timeout);
      }
      if (callback.state !== session.state) throw new Error("OAuth state ไม่ตรงกัน กรุณา reconnect");
      const credential = await broker.redeem(
        { grant: callback.grant, codeVerifier: pkce.verifier },
        active.controller.signal,
      );
      await tokenStore.set(credential);
      return { userId: credential.userId, username: credential.username };
    } finally {
      await active.listener?.close();
    }
  }

  private waitForOwner(active: ActiveOperation, owner: symbol, signal?: AbortSignal): Promise<InstagramIdentity> {
    return new Promise<InstagramIdentity>((resolve, reject) => {
      let settled = false;
      const release = (): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        active.owners.delete(owner);
      };
      const onAbort = (): void => {
        release();
        reject(abortError());
        if (active.owners.size === 0 && this.#active === active) {
          this.#active = undefined;
          active.controller.abort();
          void active.listener?.close();
        }
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      active.promise.then(
        (value) => { if (!settled) { release(); resolve(value); } },
        (error: unknown) => { if (!settled) { release(); reject(error); } },
      );
    });
  }
}

export class NodeOAuthCallbackListener implements OAuthCallbackListener {
  readonly callbackUri: string;
  readonly #server: HttpServer;
  readonly #callback: Promise<{ state: string; grant: string }>;
  #closing?: Promise<void>;

  private constructor(server: HttpServer, port: number, callback: Promise<{ state: string; grant: string }>) {
    this.#server = server;
    this.callbackUri = `http://127.0.0.1:${port}/oauth/callback`;
    this.#callback = callback;
  }

  static async open(signal: AbortSignal): Promise<NodeOAuthCallbackListener> {
    if (signal.aborted) throw abortError();
    let settle!: (value: { state: string; grant: string }) => void;
    let reject!: (error: unknown) => void;
    let used = false;
    const callback = new Promise<{ state: string; grant: string }>((resolve, fail) => {
      settle = resolve;
      reject = fail;
    });
    const server = createServer((request, response) => {
      response.setHeader("connection", "close");
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method !== "GET" || url.pathname !== "/oauth/callback" || used) {
        writeHtml(response, 404, "ไม่พบรายการ OAuth นี้");
        return;
      }
      used = true;
      const state = url.searchParams.get("state");
      const grant = url.searchParams.get("grant");
      const oauthError = url.searchParams.get("error");
      if (!state || !grant || oauthError) {
        reject(new Error("เชื่อม Instagram ไม่สำเร็จหรือถูกยกเลิก"));
        writeHtml(response, 400, "เชื่อม Instagram ไม่สำเร็จ กรุณากลับไปที่ Claude แล้วลองใหม่");
        return;
      }
      settle({ state, grant });
      writeHtml(response, 200, "เชื่อม Instagram สำเร็จ กลับไปที่ Claude ได้เลย");
    });
    const port = await new Promise<number>((resolve, fail) => {
      const onAbort = (): void => { server.close(); fail(abortError()); };
      signal.addEventListener("abort", onAbort, { once: true });
      server.once("error", fail);
      server.listen(0, "127.0.0.1", () => {
        signal.removeEventListener("abort", onAbort);
        const address = server.address();
        if (!address || typeof address === "string") return fail(new Error("เปิด OAuth callback ไม่สำเร็จ"));
        resolve(address.port);
      });
    });
    return new NodeOAuthCallbackListener(server, port, callback);
  }

  wait(signal: AbortSignal): Promise<{ state: string; grant: string }> {
    return awaitWithSignal(this.#callback, signal);
  }

  close(): Promise<void> {
    this.#closing ??= new Promise<void>((resolve) => {
      this.#server.close(() => resolve());
      this.#server.closeAllConnections?.();
    });
    return this.#closing;
  }
}

function writeHtml(response: ServerResponse, status: number, message: string): void {
  response.statusCode = status;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(`<!doctype html><html lang="th"><meta charset="utf-8"><title>PiR2 Academy</title><body><h1>${message}</h1></body></html>`);
}

export function createProductionOAuthCoordinator(
  broker: Pick<BrokerClient, "createSession" | "redeem">,
  tokenStore: TokenStore,
): InstagramOAuthCoordinator {
  return new InstagramOAuthCoordinator({
    broker,
    tokenStore,
    browser: { open: async (url) => await open(url) },
    listenerFactory: { open: NodeOAuthCallbackListener.open },
  });
}
