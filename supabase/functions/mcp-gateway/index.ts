/**
 * ============================================================
 * APEX OmniHub — MCP Gateway
 * ============================================================
 *
 * Remote MCP server implementing the Streamable HTTP transport.
 * Exposes 27 tools across 4 categories:
 *   • Supabase DB operations    (8 tools)
 *   • GitHub repo management    (6 tools)
 *   • Cloudflare deployments    (5 tools)
 *   • OmniHub platform monitor  (8 tools)
 *
 * Authentication: Bearer token via MCP_GATEWAY_API_KEY env var
 *
 * Connector URL (add in Claude → Customize → Connectors):
 *   https://<project>.supabase.co/functions/v1/mcp-gateway
 *
 * Environment variables required:
 *   MCP_GATEWAY_API_KEY        — shared secret for Claude connector
 *   SUPABASE_URL               — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY  — Supabase service role key
 *   GITHUB_TOKEN               — GitHub PAT for repo tools
 *   CLOUDFLARE_API_TOKEN       — Cloudflare API token
 *   CLOUDFLARE_ACCOUNT_ID      — Cloudflare account ID
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { isMcpGatewayAuthorized } from "./auth.ts";
import { ALL_TOOLS, dispatchTool } from "./tools/registry.ts";

const ALL_TOOL_NAMES = new Set(ALL_TOOLS.map((t) => t.name));

// ──────────────────────────────────────────────────────────────────
// MCP Protocol Constants
// ──────────────────────────────────────────────────────────────────

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = { name: "apex-omnihub-gateway", version: "1.0.0" };

// ──────────────────────────────────────────────────────────────────
// CORS — browser callers are restricted by the shared allowlist. Native MCP
// clients do not rely on CORS and authenticate with a header credential.
// ──────────────────────────────────────────────────────────────────

function mcpCorsHeaders(req: Request): Record<string, string> {
  return {
    ...buildCorsHeaders(req.headers.get("origin")),
    "Access-Control-Allow-Headers":
      "authorization, content-type, mcp-session-id, x-api-key",
  };
}

// ──────────────────────────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────────────────────────

serve(async (req: Request): Promise<Response> => {
  const responseHeaders = mcpCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders });
  }

  // Auth — MCP_GATEWAY_API_KEY must match the Bearer token
  if (!isAuthorized(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401, responseHeaders);
  }

  if (req.method === "POST") {
    return handlePost(req, responseHeaders);
  }

  // GET /mcp-gateway — returns server metadata for discovery
  if (req.method === "GET") {
    return jsonResponse({
      name: SERVER_INFO.name,
      version: SERVER_INFO.version,
      protocol: PROTOCOL_VERSION,
      tools: ALL_TOOLS.length,
      categories: ["supabase-db", "github", "cloudflare", "omnihub"],
    }, 200, responseHeaders);
  }

  return jsonResponse({ error: "Method not allowed" }, 405, responseHeaders);
});

// ──────────────────────────────────────────────────────────────────
// POST handler — dispatches JSON-RPC messages
// ──────────────────────────────────────────────────────────────────

async function handlePost(req: Request, responseHeaders: HeadersInit): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(rpcError(null, -32700, "Parse error"), 400, responseHeaders);
  }

  // Handle batch requests
  if (Array.isArray(body)) {
    const results = await Promise.all(body.map(handleRpcMessage));
    const responses = results.filter((r) => r !== null);
    return jsonResponse(responses, 200, responseHeaders);
  }

  const result = await handleRpcMessage(body as RpcRequest);
  if (result === null) {
    // Notification — no response body required
    return new Response(null, { status: 202, headers: responseHeaders });
  }
  return jsonResponse(result, 200, responseHeaders);
}

// ──────────────────────────────────────────────────────────────────
// JSON-RPC message dispatcher
// ──────────────────────────────────────────────────────────────────

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

async function handleRpcMessage(msg: RpcRequest): Promise<unknown> {
  if (msg.jsonrpc !== "2.0") {
    return rpcError(msg.id ?? null, -32600, "Invalid Request: jsonrpc must be '2.0'");
  }

  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize":
      return rpcOk(id!, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case "notifications/initialized":
    case "initialized":
      return null; // Notification — no response

    case "ping":
      return rpcOk(id!, {});

    case "tools/list":
      return rpcOk(id!, { tools: ALL_TOOLS });

    case "tools/call": {
      const p = params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      if (!p?.name) {
        return rpcError(id ?? null, -32602, "Invalid params: 'name' is required");
      }
      const toolExists = ALL_TOOL_NAMES.has(p.name);
      if (!toolExists) {
        return rpcError(id ?? null, -32602, `Unknown tool: ${p.name}`);
      }
      const result = await dispatchTool(p.name, p.arguments ?? {});
      return rpcOk(id!, result);
    }

    case "resources/list":
      return rpcOk(id!, { resources: [] });

    case "prompts/list":
      return rpcOk(id!, { prompts: [] });

    default:
      if (isNotification) return null;
      return rpcError(id ?? null, -32601, `Method not found: ${method}`);
  }
}

// ──────────────────────────────────────────────────────────────────
// Auth
// ──────────────────────────────────────────────────────────────────

function isAuthorized(req: Request): boolean {
  return isMcpGatewayAuthorized(req, Deno.env.get("MCP_GATEWAY_API_KEY"));
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status: number, responseHeaders: HeadersInit): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...responseHeaders, "Content-Type": "application/json" },
  });
}

function rpcOk(id: string | number, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
