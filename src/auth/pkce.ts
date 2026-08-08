import { createHash, randomBytes } from "node:crypto";

export interface PkcePair { verifier: string; challenge: string }

export function createPkce(): PkcePair {
  const verifier = randomBytes(48).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}
