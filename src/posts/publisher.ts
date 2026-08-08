import type { InstagramCredential } from "../auth/token-store.js";
import type { ContainerStatus, InstagramClientContract } from "../instagram/instagram-client.js";
import type { IntentStore, PostIntent } from "./intent-store.js";

interface PublisherDependencies {
  store: IntentStore;
  instagram: InstagramClientContract;
  getCredential(): Promise<InstagramCredential | null>;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
  maxStatusChecks?: number;
}

export interface PublishReceipt {
  intentId: string;
  mediaId: string;
  account: string;
  publishedAt: string;
  duplicatePrevented: boolean;
}

export class PostPublisher {
  constructor(private readonly dependencies: PublisherDependencies) {}

  async publish(intentId: string, confirmationText: string): Promise<PublishReceipt> {
    if (confirmationText.trim() !== "ยืนยันโพสต์" && confirmationText.trim() !== "Confirm post") {
      throw new Error("ยังไม่โพสต์ กรุณาตรวจ preview แล้วตอบว่า ‘ยืนยันโพสต์’ หรือ ‘Confirm post’");
    }
    const credential = await this.dependencies.getCredential();
    if (!credential) throw new Error("ยังไม่ได้เชื่อม Instagram กรุณา reconnect");
    const now = (this.dependencies.now ?? (() => new Date()))();
    let replay = false;
    const claimed = await this.dependencies.store.update(intentId, (current) => {
      if (current.status === "published" && current.mediaId && current.publishedAt) {
        replay = true;
        return current;
      }
      if (current.status === "unknown") throw new Error("ผลการโพสต์ครั้งก่อนยังไม่ชัดเจน กรุณาตรวจใน Instagram ก่อน ห้าม retry อัตโนมัติ");
      if (current.status !== "prepared") throw new Error("preview นี้ถูกใช้งานหรือกำลังโพสต์อยู่แล้ว");
      if (Date.parse(current.expiresAt) <= now.getTime()) throw new Error("preview หมดอายุแล้ว กรุณาสร้าง preview ใหม่");
      if (current.userId !== credential.userId) throw new Error("Instagram account เปลี่ยนจากตอนสร้าง preview กรุณาสร้าง preview ใหม่");
      return { ...current, status: "publishing" };
    });
    if (!claimed) throw new Error("ไม่พบ preview นี้ กรุณาสร้าง preview ใหม่");
    if (replay) return receipt(claimed, true);

    let creationId: string;
    try {
      creationId = (await this.dependencies.instagram.createImageContainer({
        accessToken: credential.accessToken,
        userId: credential.userId,
        imageUrl: claimed.imageUrl,
        caption: claimed.caption,
      })).creationId;
      await this.dependencies.store.update(intentId, (current) => ({ ...current, creationId }));
    } catch {
      await this.mark(intentId, "unknown");
      throw new Error("สร้าง Instagram container แล้วแต่ไม่ทราบผล กรุณาตรวจใน Instagram และอย่า retry อัตโนมัติ");
    }

    const maxChecks = this.dependencies.maxStatusChecks ?? 10;
    const sleep = this.dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    for (let check = 0; check < maxChecks; check += 1) {
      let status: ContainerStatus;
      try {
        status = await this.dependencies.instagram.getContainerStatus({
          accessToken: credential.accessToken,
          userId: credential.userId,
          creationId,
        });
      } catch {
        await this.mark(intentId, "unknown");
        throw new Error("ตรวจสถานะ Instagram container ไม่สำเร็จและไม่ทราบผล กรุณาตรวจใน Instagram ก่อน");
      }
      if (status === "ERROR" || status === "EXPIRED") {
        await this.mark(intentId, "failed");
        throw new Error("Instagram ประมวลผลภาพไม่สำเร็จ กรุณาสร้าง preview ใหม่");
      }
      if (status === "FINISHED") {
        try {
          const { mediaId } = await this.dependencies.instagram.publishContainer({
            accessToken: credential.accessToken,
            userId: credential.userId,
            creationId,
          });
          const publishedAt = (this.dependencies.now ?? (() => new Date()))().toISOString();
          const published = await this.dependencies.store.update(intentId, (current) => ({
            ...current, status: "published", mediaId, publishedAt,
          }));
          if (!published) throw new Error("บันทึกผล post ไม่สำเร็จ");
          return receipt(published, false);
        } catch {
          await this.mark(intentId, "unknown");
          throw new Error("ส่งคำสั่ง post แล้วแต่ไม่ทราบผล กรุณาตรวจใน Instagram และอย่า retry อัตโนมัติ");
        }
      }
      await sleep(2_000);
    }
    await this.mark(intentId, "unknown");
    throw new Error("Instagram ยังประมวลผลไม่เสร็จและไม่ทราบผล กรุณาตรวจใน Instagram ก่อน");
  }

  private async mark(intentId: string, status: PostIntent["status"]): Promise<void> {
    await this.dependencies.store.update(intentId, (current) => ({ ...current, status }));
  }
}

function receipt(intent: PostIntent, duplicatePrevented: boolean): PublishReceipt {
  if (!intent.mediaId || !intent.publishedAt) throw new Error("publish receipt ไม่สมบูรณ์");
  return {
    intentId: intent.id,
    mediaId: intent.mediaId,
    account: intent.username ? `@${intent.username}` : `Instagram …${intent.userId.slice(-4)}`,
    publishedAt: intent.publishedAt,
    duplicatePrevented,
  };
}
