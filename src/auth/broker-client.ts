import { z } from "zod";
import { instagramCredentialSchema, type InstagramCredential } from "./token-store.js";

const sessionSchema = z.object({
  authorization_url: z.url(),
  state: z.string().min(16),
  expires_at: z.iso.datetime(),
}).strict();

const redeemSchema = z.object({
  access_token: z.string().min(1),
  user_id: z.string().min(1),
  username: z.string().min(1).optional(),
  expires_at: z.iso.datetime(),
  scopes: z.array(z.string().min(1)),
}).strict();

export interface BrokerSession {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
}

interface BrokerClientOptions {
  baseUrl: string;
  fetcher?: typeof fetch;
}

export class BrokerClient {
  readonly #baseUrl: string;
  readonly #fetcher: typeof fetch;

  constructor(options: BrokerClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/u, "");
    this.#fetcher = options.fetcher ?? fetch;
  }

  async createSession(input: { callbackUri: string; codeChallenge: string }, signal?: AbortSignal): Promise<BrokerSession> {
    const value = await this.post("/oauth/sessions", {
      callback_uri: input.callbackUri,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
    }, signal);
    const parsed = sessionSchema.safeParse(value);
    if (!parsed.success) throw new Error("เชื่อม OAuth Broker ไม่สำเร็จ กรุณาลองใหม่");
    return {
      authorizationUrl: parsed.data.authorization_url,
      state: parsed.data.state,
      expiresAt: parsed.data.expires_at,
    };
  }

  async redeem(input: { grant: string; codeVerifier: string }, signal?: AbortSignal): Promise<InstagramCredential> {
    const value = await this.post("/oauth/redeem", {
      grant: input.grant,
      code_verifier: input.codeVerifier,
    }, signal);
    const parsed = redeemSchema.safeParse(value);
    if (!parsed.success) throw new Error("รับ Instagram token ไม่สำเร็จ กรุณา reconnect");
    return instagramCredentialSchema.parse({
      accessToken: parsed.data.access_token,
      userId: parsed.data.user_id,
      username: parsed.data.username,
      expiresAt: parsed.data.expires_at,
      scopes: parsed.data.scopes,
    });
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetcher(`${this.#baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(10_000)]),
      });
    } catch {
      throw new Error("เชื่อม OAuth Broker ไม่สำเร็จ กรุณาตรวจ internet แล้วลองใหม่");
    }
    if (!response.ok) throw new Error("เชื่อม OAuth Broker ไม่สำเร็จ กรุณาลองใหม่");
    try {
      return await response.json() as unknown;
    } catch {
      throw new Error("OAuth Broker ตอบกลับไม่สมบูรณ์ กรุณาลองใหม่");
    }
  }
}
