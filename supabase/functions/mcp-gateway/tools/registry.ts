/**
 * MCP Tool Registry — central dispatch for all 26 gateway tools
 * Maps tool names → definitions + handlers
 */

import { dbTools, handleDbTool } from "./db.ts";
import { githubTools, handleGithubTool } from "./github.ts";
import { cloudflareTools, handleCloudflareTool } from "./cloudflare.ts";
import { omnihubTools, handleOmnihubTool } from "./omnihub.ts";

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export const ALL_TOOLS: MCPTool[] = [
  ...dbTools,
  ...githubTools,
  ...cloudflareTools,
  ...omnihubTools,
];

const DB_TOOL_NAMES = new Set(dbTools.map((t) => t.name));
const GITHUB_TOOL_NAMES = new Set(githubTools.map((t) => t.name));
const CLOUDFLARE_TOOL_NAMES = new Set(cloudflareTools.map((t) => t.name));
const OMNIHUB_TOOL_NAMES = new Set(omnihubTools.map((t) => t.name));

export async function dispatchTool(
  name: string,
  args: Record<string, unknown>
): Promise<ToolCallResult> {
  if (DB_TOOL_NAMES.has(name)) return handleDbTool(name, args);
  if (GITHUB_TOOL_NAMES.has(name)) return handleGithubTool(name, args);
  if (CLOUDFLARE_TOOL_NAMES.has(name)) return handleCloudflareTool(name, args);
  if (OMNIHUB_TOOL_NAMES.has(name)) return handleOmnihubTool(name, args);
  return {
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
    isError: true,
  };
}

export function ok(data: unknown): ToolCallResult {
  return {
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
  };
}

export function err(message: string): ToolCallResult {
  return { content: [{ type: "text", text: message }], isError: true };
}
