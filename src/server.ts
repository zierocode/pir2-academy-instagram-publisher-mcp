import { randomUUID } from "node:crypto";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BrokerClient } from "./auth/broker-client.js";
import {
  createProductionOAuthCoordinator,
  type InstagramIdentity,
} from "./auth/oauth-coordinator.js";
import { KeyringTokenStore } from "./auth/token-store-keyring.js";
import type { InstagramCredential } from "./auth/token-store.js";
import { errorResult, textResult } from "./contracts.js";
import { MediaValidator, type ValidatedMedia } from "./media/media-validator.js";
import { InstagramClient } from "./instagram/instagram-client.js";
import { FileIntentStore, type IntentStore } from "./posts/intent-store.js";
import { preparePost } from "./posts/post-preview.js";
import { PostPublisher, type PublishReceipt } from "./posts/publisher.js";

type ToolHandler = (input: unknown, signal?: AbortSignal) => Promise<CallToolResult>;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  annotations?: ToolAnnotations;
  handler: ToolHandler;
}

export interface PublisherServices {
  oauth: {
    getCredential(): Promise<InstagramCredential | null>;
    connect(signal?: AbortSignal): Promise<InstagramIdentity>;
    close?(): Promise<void>;
  };
  media?: { validate(url: string, signal?: AbortSignal): Promise<ValidatedMedia> };
  intents?: IntentStore;
  publisher?: { publish(intentId: string, confirmationText: string): Promise<PublishReceipt> };
}

const emptyInput = z.object({}).strict();
const prepareInput = z.object({
  image_url: z.url(),
  caption: z.string(),
  alt_text: z.string().optional(),
}).strict();
const publishInput = z.object({
  intent_id: z.string().min(1),
  confirmation_text: z.string().min(1),
}).strict();

function unavailable(): Promise<CallToolResult> {
  return Promise.resolve(
    errorResult("ฟังก์ชันนี้กำลังเตรียมสำหรับ workshop กรุณาอัปเดต MCP แล้วลองใหม่", "NOT_READY"),
  );
}

export function buildServerIdentity(): { name: string; version: string } {
  return { name: "pir2-academy-instagram-publisher", version: "0.1.1" };
}

export function createToolCatalog(services?: PublisherServices): ToolDefinition[] {
  return [
    {
      name: "instagram_auth_status",
      description: "ตรวจว่า Instagram พร้อมใช้งานหรือยัง โดยไม่โพสต์อะไร",
      inputSchema: emptyInput,
      annotations: { readOnlyHint: true, destructiveHint: false },
      handler: services
        ? async () => {
            const credential = await services.oauth.getCredential();
            return credential
              ? textResult(`Instagram พร้อมใช้งานแล้วครับ${credential.username ? `: @${credential.username}` : ""}`)
              : textResult("Instagram ยังไม่ได้เชื่อมครับ พิมพ์ `เชื่อม Instagram` เพื่อเริ่ม login ด้วย account ของผู้เรียนเอง");
          }
        : unavailable,
    },
    {
      name: "connect_instagram",
      description: "เปิดหน้า Instagram เพื่อให้ผู้เรียนเชื่อม account ของตัวเอง",
      inputSchema: emptyInput,
      annotations: { readOnlyHint: false, destructiveHint: false },
      handler: services
        ? async (_input, signal) => {
            const identity = await services.oauth.connect(signal);
            return textResult(`เชื่อม Instagram สำเร็จ${identity.username ? `: @${identity.username}` : ""}`, {
              connected: true,
              user_id: identity.userId,
              username: identity.username,
            });
          }
        : unavailable,
    },
    {
      name: "prepare_instagram_post",
      description: "ตรวจภาพและ caption แล้วสร้าง preview สำหรับให้ผู้เรียนตรวจ",
      inputSchema: prepareInput,
      annotations: { readOnlyHint: false, destructiveHint: false },
      handler: services?.media && services.intents
        ? async (input, signal) => {
            const parsed = prepareInput.parse(input);
            const credential = await services.oauth.getCredential();
            if (!credential) return errorResult("ยังไม่ได้เชื่อม Instagram กรุณา connect ก่อน", "AUTH_REQUIRED");
            const media = await services.media!.validate(parsed.image_url, signal);
            const preview = await preparePost({
              imageUrl: parsed.image_url,
              caption: parsed.caption,
              altText: parsed.alt_text,
              identity: { userId: credential.userId, username: credential.username },
              media,
              store: services.intents!,
            });
            return textResult(
              `สร้าง preview แล้วสำหรับ ${preview.account}\n\nCaption: ${preview.caption}\n\n${preview.confirmation}`,
              preview,
            );
          }
        : unavailable,
    },
    {
      name: "publish_instagram_post",
      description: "โพสต์ preview ที่ผู้เรียนยืนยันแล้วไป Instagram หนึ่งครั้ง",
      inputSchema: publishInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      handler: services?.publisher
        ? async (input) => {
            const parsed = publishInput.parse(input);
            const receipt = await services.publisher!.publish(parsed.intent_id, parsed.confirmation_text);
            const duplicateMessage = receipt.duplicatePrevented
              ? "คำสั่งนี้เคยโพสต์แล้ว จึงไม่สร้าง post ซ้ำ"
              : "โพสต์สำเร็จ";
            return textResult(`${duplicateMessage}: ${receipt.account} (Media ID: ${receipt.mediaId})`, receipt);
          }
        : unavailable,
    },
  ];
}

export function createMcpServer(catalog: ToolDefinition[] = createToolCatalog()): Server {
  const server = new Server(buildServerIdentity(), { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: catalog.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.inputSchema),
      annotations: tool.annotations,
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const tool = catalog.find((candidate) => candidate.name === request.params.name);
    if (!tool) {
      return errorResult("ไม่พบ tool ที่ขอ", "TOOL_NOT_FOUND");
    }
    const parsed = tool.inputSchema.safeParse(request.params.arguments ?? {});
    if (!parsed.success) {
      return errorResult("ข้อมูลที่ส่งมาไม่ครบหรือรูปแบบไม่ถูกต้อง", "INVALID_INPUT");
    }
    try {
      return await tool.handler(parsed.data, extra.signal);
    } catch {
      return errorResult(`ทำรายการไม่สำเร็จ (รหัส ${randomUUID().slice(0, 8)})`, "INTERNAL_ERROR");
    }
  });
  return server;
}

export function createProductionServices(environment: NodeJS.ProcessEnv = process.env): PublisherServices {
  const broker = new BrokerClient({
    baseUrl: environment.PIR2_META_OAUTH_BROKER_URL?.trim() || "https://meta-oauth.zie-agent.cloud/instagram",
  });
  const appData = platform() === "win32"
    ? environment.APPDATA || join(homedir(), "AppData", "Roaming")
    : join(homedir(), "Library", "Application Support");
  const oauth = createProductionOAuthCoordinator(broker, new KeyringTokenStore());
  const intents = new FileIntentStore(join(appData, "PiR2 Academy", "Instagram Publisher", "intents.json"));
  const publisher = new PostPublisher({
    store: intents,
    instagram: new InstagramClient({ apiVersion: environment.PIR2_INSTAGRAM_API_VERSION?.trim() || "v23.0" }),
    getCredential: () => oauth.getCredential(),
  });
  return {
    oauth,
    media: new MediaValidator(),
    intents,
    publisher,
  };
}

export async function runStdioServer(): Promise<void> {
  const services = createProductionServices();
  const server = createMcpServer(createToolCatalog(services));
  const transport = new StdioServerTransport();
  transport.onclose = () => { void services.oauth.close?.(); };
  await server.connect(transport);
}
