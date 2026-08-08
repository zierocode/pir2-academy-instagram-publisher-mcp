import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export function textResult(message: string, data?: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: data === undefined ? undefined : { data },
  };
}

export function errorResult(message: string, code: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent: { error: { code, message } },
  };
}
