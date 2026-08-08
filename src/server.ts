import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { errorResult, textResult } from "./contracts.js";

type ToolHandler = (input: unknown, signal?: AbortSignal) => Promise<CallToolResult>;

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  annotations?: ToolAnnotations;
  handler: ToolHandler;
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
  return { name: "pir2-academy-instagram-publisher", version: "0.1.0" };
}

export function createToolCatalog(): ToolDefinition[] {
  return [
    {
      name: "instagram_auth_status",
      description: "ตรวจว่า Instagram พร้อมใช้งานหรือยัง โดยไม่โพสต์อะไร",
      inputSchema: emptyInput,
      annotations: { readOnlyHint: true, destructiveHint: false },
      handler: unavailable,
    },
    {
      name: "connect_instagram",
      description: "เปิดหน้า Instagram เพื่อให้ผู้เรียนเชื่อม account ของตัวเอง",
      inputSchema: emptyInput,
      annotations: { readOnlyHint: false, destructiveHint: false },
      handler: unavailable,
    },
    {
      name: "prepare_instagram_post",
      description: "ตรวจภาพและ caption แล้วสร้าง preview สำหรับให้ผู้เรียนตรวจ",
      inputSchema: prepareInput,
      annotations: { readOnlyHint: false, destructiveHint: false },
      handler: unavailable,
    },
    {
      name: "publish_instagram_post",
      description: "โพสต์ preview ที่ผู้เรียนยืนยันแล้วไป Instagram หนึ่งครั้ง",
      inputSchema: publishInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      handler: unavailable,
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

export async function runStdioServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
