import { z } from "zod";

export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED";

export interface InstagramClientContract {
  createImageContainer(input: { accessToken: string; userId: string; imageUrl: string; caption: string }): Promise<{ creationId: string }>;
  getContainerStatus(input: { accessToken: string; userId: string; creationId: string }): Promise<ContainerStatus>;
  publishContainer(input: { accessToken: string; userId: string; creationId: string }): Promise<{ mediaId: string }>;
}

interface InstagramClientOptions { apiVersion?: string; fetcher?: typeof fetch }
const idResponse = z.object({ id: z.string().min(1) }).passthrough();
const statusResponse = z.object({ status_code: z.enum(["IN_PROGRESS", "FINISHED", "ERROR", "EXPIRED"]) }).passthrough();

export class InstagramClient implements InstagramClientContract {
  readonly #baseUrl: string;
  readonly #fetcher: typeof fetch;
  constructor(options: InstagramClientOptions = {}) {
    const version = options.apiVersion ?? "v23.0";
    if (!/^v\d+\.\d+$/u.test(version)) throw new Error("Instagram API version ไม่ถูกต้อง");
    this.#baseUrl = `https://graph.instagram.com/${version}`;
    this.#fetcher = options.fetcher ?? fetch;
  }

  async createImageContainer(input: { accessToken: string; userId: string; imageUrl: string; caption: string }): Promise<{ creationId: string }> {
    const body = new FormData();
    body.set("image_url", input.imageUrl);
    body.set("caption", input.caption);
    const value = idResponse.parse(await this.call(`${this.#baseUrl}/${encodeURIComponent(input.userId)}/media`, input.accessToken, { method: "POST", body }));
    return { creationId: value.id };
  }

  async getContainerStatus(input: { accessToken: string; userId: string; creationId: string }): Promise<ContainerStatus> {
    const value = statusResponse.parse(await this.call(
      `${this.#baseUrl}/${encodeURIComponent(input.creationId)}?fields=status_code`,
      input.accessToken,
      { method: "GET" },
    ));
    return value.status_code;
  }

  async publishContainer(input: { accessToken: string; userId: string; creationId: string }): Promise<{ mediaId: string }> {
    const body = new FormData();
    body.set("creation_id", input.creationId);
    const value = idResponse.parse(await this.call(
      `${this.#baseUrl}/${encodeURIComponent(input.userId)}/media_publish`,
      input.accessToken,
      { method: "POST", body },
    ));
    return { mediaId: value.id };
  }

  private async call(url: string, accessToken: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetcher(url, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${accessToken}`, accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new Error("Instagram API ทำรายการไม่สำเร็จ สถานะเครือข่ายไม่ชัดเจน");
    }
    if (!response.ok) throw new Error("Instagram API ทำรายการไม่สำเร็จ กรุณาตรวจ account และสิทธิ์แล้วลองใหม่");
    try { return await response.json() as unknown; }
    catch { throw new Error("Instagram API ตอบกลับไม่สมบูรณ์"); }
  }
}
