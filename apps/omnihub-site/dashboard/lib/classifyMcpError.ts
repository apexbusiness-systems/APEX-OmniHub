/**
 * OmniSlate error classifier
 * Maps error message signatures from mcp-client.ts to honest, user-actionable
 * gate messages. Never exposes raw stack traces or internal identifiers.
 * Classification priority: auth → network → orchestrator → guardian → fallback.
 */
export function classifyMcpError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  // 1. Session / auth failures
  if (/no active session|must be authenticated/i.test(msg)) {
    return '⚠ Session expired — please refresh the page and sign in again to use APEX Agent.';
  }
  if (/gateway returned 401|401/i.test(msg)) {
    return '⚠ Authentication error — your session token is invalid or expired. Refresh and sign in again.';
  }
  // 2. Network / gateway unreachable
  if (/gateway unreachable|network|fetch failed|failed to fetch/i.test(msg)) {
    return '⚠ Network error — APEX Agent gateway could not be reached. Check your connection and try again.';
  }
  // 3. Orchestrator / upstream failures (BLOCKED-CONFIG or BLOCKED-INFRA)
  if (/upstream_error_5|upstream_unavailable|upstream error|server_error/i.test(msg)) {
    return '⚠ APEX Agent is unavailable — the orchestrator backend is unreachable or not configured. Contact your APEX admin.';
  }
  if (/agent_run_insert_failed|agent_run_poll_failed/i.test(msg)) {
    return '⚠ Could not record this request — database write failed. Try again in a moment.';
  }
  // 4. Agent execution failures
  if (/agent failed|agent execution failed/i.test(msg)) {
    return '⚠ APEX Agent encountered an error processing your request. Try again or refine your prompt.';
  }
  if (/sse stream ended/i.test(msg)) {
    return '⚠ Response stream ended unexpectedly. Please try again.';
  }
  if (/agent timed out|\btimeout\b/i.test(msg)) {
    return '⚠ APEX Agent timed out — the request took too long. Try a shorter prompt or try again later.';
  }
  // 5. Guardian block (content policy)
  if (/request_blocked|guardian|blocked/i.test(msg)) {
    return '⚠ Request blocked by APEX Guardian policy — this prompt was flagged. Revise and try again.';
  }
  // 6. Rate limiting
  if (/rate.?limit|too many/i.test(msg)) {
    return '⚠ Too many requests — APEX Agent rate limit reached. Please wait a moment and try again.';
  }
  // 7. Non-terminal status exposed by client (should not reach here)
  if (/non-terminal status/i.test(msg)) {
    return '⚠ Agent response is still being processed. If this persists, refresh and try again.';
  }
  // 8. Fallback — never expose raw error text to avoid leaking internals
  return '⚠ APEX Agent is temporarily unavailable. Please try again in a moment.';
}
