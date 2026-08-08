import { createHash, randomUUID } from "node:crypto";
import type { InstagramIdentity } from "../auth/oauth-coordinator.js";
import type { ValidatedMedia } from "../media/media-validator.js";
import { postIntentSchema, type IntentStore } from "./intent-store.js";

interface PreparePostInput {
  imageUrl: string;
  caption: string;
  altText?: string;
  identity: InstagramIdentity;
  media: ValidatedMedia;
  store: IntentStore;
  now?: () => Date;
}

export interface PostPreview {
  intentId: string;
  account: string;
  imageUrl: string;
  caption: string;
  captionCharacters: number;
  altText?: string;
  contentType: ValidatedMedia["contentType"];
  contentLength?: number;
  expiresAt: string;
  confirmation: string;
}

export async function preparePost(input: PreparePostInput): Promise<PostPreview> {
  const caption = input.caption.trim();
  if (!caption) throw new Error("caption ต้องไม่ว่าง");
  if ([...caption].length > 2200) throw new Error("caption ต้องไม่เกิน 2,200 ตัวอักษร");
  const now = (input.now ?? (() => new Date()))();
  const expiresAt = new Date(now.getTime() + 10 * 60_000);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([input.identity.userId, input.imageUrl, caption, input.altText ?? ""]))
    .digest("hex");
  const intent = postIntentSchema.parse({
    id: randomUUID(),
    status: "prepared",
    fingerprint,
    userId: input.identity.userId,
    username: input.identity.username,
    imageUrl: input.imageUrl,
    caption,
    altText: input.altText?.trim() || undefined,
    preparedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  await input.store.put(intent);
  return {
    intentId: intent.id,
    account: input.identity.username ? `@${input.identity.username}` : `Instagram …${input.identity.userId.slice(-4)}`,
    imageUrl: intent.imageUrl,
    caption: intent.caption,
    captionCharacters: [...intent.caption].length,
    altText: intent.altText,
    contentType: input.media.contentType,
    contentLength: input.media.contentLength,
    expiresAt: intent.expiresAt,
    confirmation: "ตรวจ preview แล้วตอบว่า ‘ยืนยันโพสต์’ หรือ ‘Confirm post’",
  };
}
