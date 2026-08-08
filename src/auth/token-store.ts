import { z } from "zod";

export const instagramCredentialSchema = z.object({
  accessToken: z.string().min(1),
  userId: z.string().min(1),
  username: z.string().min(1).optional(),
  expiresAt: z.iso.datetime(),
  scopes: z.array(z.string().min(1)),
}).strict();

export type InstagramCredential = z.infer<typeof instagramCredentialSchema>;

export interface TokenStore {
  get(): Promise<InstagramCredential | null>;
  set(credential: InstagramCredential): Promise<void>;
  delete(): Promise<void>;
}

export class TokenStoreUnavailableError extends Error {
  constructor() {
    super("ไม่สามารถใช้ credential vault ของระบบได้");
    this.name = "TokenStoreUnavailableError";
  }
}
