import { Entry } from "@napi-rs/keyring";
import {
  instagramCredentialSchema,
  TokenStoreUnavailableError,
  type InstagramCredential,
  type TokenStore,
} from "./token-store.js";

const SERVICE = "pir2-academy-instagram-publisher-mcp";
const ACCOUNT = "instagram-oauth";

export interface KeyringEntry {
  getPassword(): string | null | undefined;
  setPassword(password: string): void;
  deletePassword(): unknown;
}

export interface KeyringBinding {
  Entry: new (service: string, account: string) => KeyringEntry;
}

export class KeyringTokenStore implements TokenStore {
  constructor(private readonly binding: KeyringBinding = { Entry }) {}

  async get(): Promise<InstagramCredential | null> {
    return this.guard(() => {
      const value = this.entry().getPassword();
      if (value === null || value === undefined) return null;
      const parsed = instagramCredentialSchema.safeParse(JSON.parse(value) as unknown);
      if (!parsed.success) throw new TokenStoreUnavailableError();
      return parsed.data;
    });
  }

  async set(credential: InstagramCredential): Promise<void> {
    return this.guard(() => {
      const parsed = instagramCredentialSchema.safeParse(credential);
      if (!parsed.success) throw new TokenStoreUnavailableError();
      this.entry().setPassword(JSON.stringify(parsed.data));
    });
  }

  async delete(): Promise<void> {
    return this.guard(() => { this.entry().deletePassword(); });
  }

  private entry(): KeyringEntry {
    return new this.binding.Entry(SERVICE, ACCOUNT);
  }

  private guard<Value>(operation: () => Value): Value {
    try {
      return operation();
    } catch (error) {
      if (error instanceof TokenStoreUnavailableError) throw error;
      throw new TokenStoreUnavailableError();
    }
  }
}
