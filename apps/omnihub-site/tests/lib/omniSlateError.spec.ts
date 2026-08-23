/**
 * Unit tests — classifyMcpError (Task 1 / PRCC-TASK1)
 *
 * Validates every error classification branch in classifyMcpError() exported
 * from OmniDashShell.tsx. The function must:
 *   - Never return the legacy generic Guardian string
 *   - Map every known mcp-client error signature to a distinct actionable message
 *   - Return a user-safe fallback for unknown errors
 *   - Never expose raw Error.message text for unmapped cases
 *
 * Import: classifyMcpError is a pure function; no DOM or React required.
 */
import { describe, it, expect } from 'vitest';

// ── Import the pure function directly ────────────────────────────────────────
// classifyMcpError is declared above OmniSlateWidget in OmniDashShell.tsx.
// We re-export it via a thin shim so unit tests don't drag the full shell in.
// If the shim doesn't exist yet, import from the shell directly in the test runner.
import { classifyMcpError } from '../../dashboard/lib/classifyMcpError';

// ── Constant: the old generic string that MUST never appear ───────────────────
const BANNED_STRING = '[System Error]: Failed to contact APEX Agent. Guardian audit logged.';

describe('classifyMcpError — honest error gate (PRCC-TASK1)', () => {
  // ── Regression: banned string must never be returned ─────────────────────
  it('never returns the legacy generic Guardian error string', () => {
    const inputs = [
      new Error('upstream_error_500'),
      new Error('unknown failure'),
      new Error(''),
      null,
      undefined,
      'some random string',
    ];
    for (const input of inputs) {
      expect(classifyMcpError(input)).not.toBe(BANNED_STRING);
    }
  });

  // ── Branch 1: session / auth ──────────────────────────────────────────────
  it('classifies "no active session" as session-expired gate', () => {
    const result = classifyMcpError(new Error('[MCP Client] No active session. User must be authenticated.'));
    expect(result).toMatch(/session expired/i);
    expect(result).toMatch(/refresh/i);
  });

  it('classifies "must be authenticated" as session-expired gate', () => {
    const result = classifyMcpError(new Error('User must be authenticated.'));
    expect(result).toMatch(/session expired/i);
  });

  it('classifies "Gateway returned 401" as auth error', () => {
    const result = classifyMcpError(new Error('[MCP Client] Gateway returned 401 — session may have expired'));
    expect(result).toMatch(/authentication error/i);
  });

  // ── Branch 2: network / gateway unreachable ───────────────────────────────
  it('classifies "Gateway unreachable" as network error', () => {
    const result = classifyMcpError(new Error('[MCP Client] Gateway unreachable: Failed to fetch'));
    expect(result).toMatch(/network error/i);
  });

  it('classifies "Failed to fetch" as network error', () => {
    const result = classifyMcpError(new Error('Failed to fetch'));
    expect(result).toMatch(/network error/i);
  });

  // ── Branch 3: orchestrator / upstream failures (BLOCKED-CONFIG / BLOCKED-INFRA) ──
  it('classifies "upstream_error_500" as orchestrator gate', () => {
    const result = classifyMcpError(new Error('[MCP Client] Gateway error: upstream_error_500'));
    expect(result).toMatch(/unavailable/i);
    expect(result).toMatch(/orchestrator/i);
  });

  it('classifies "upstream_unavailable" as orchestrator gate', () => {
    const result = classifyMcpError(new Error('[MCP Client] Gateway error: upstream_unavailable'));
    expect(result).toMatch(/unavailable/i);
  });

  it('classifies "server_error" as orchestrator gate', () => {
    const result = classifyMcpError(new Error('server_error'));
    expect(result).toMatch(/unavailable/i);
  });

  it('classifies "agent_run_insert_failed" as DB write failure', () => {
    const result = classifyMcpError(new Error('[MCP Client] Gateway error: agent_run_insert_failed'));
    expect(result).toMatch(/database write failed/i);
  });

  it('classifies "agent_run_poll_failed" as DB failure', () => {
    const result = classifyMcpError(new Error('[MCP Client] Gateway error: agent_run_poll_failed'));
    expect(result).toMatch(/database write failed/i);
  });

  // ── Branch 4: agent execution failures ───────────────────────────────────
  it('classifies "Agent failed" as execution error', () => {
    const result = classifyMcpError(new Error('[MCP Client] Agent failed: execution error'));
    expect(result).toMatch(/encountered an error/i);
  });

  it('classifies "Agent timed out" as timeout', () => {
    const result = classifyMcpError(new Error('[MCP Client] Agent timed out'));
    expect(result).toMatch(/timed out/i);
  });

  it('classifies "SSE stream ended without terminal event" as stream failure', () => {
    const result = classifyMcpError(
      new Error('[MCP Client] SSE stream ended without terminal event (completed/failed/timeout)'),
    );
    expect(result).toMatch(/stream ended/i);
  });

  // ── Branch 5: Guardian / content policy block ─────────────────────────────
  it('classifies "request_blocked" as Guardian policy block', () => {
    const result = classifyMcpError(new Error('[MCP Client] Gateway error: request_blocked'));
    expect(result).toMatch(/guardian policy/i);
  });

  // ── Branch 6: rate limiting ───────────────────────────────────────────────
  it('classifies "rate limit" as rate-limit gate', () => {
    const result = classifyMcpError(new Error('rate limit exceeded'));
    expect(result).toMatch(/rate limit/i);
  });

  it('classifies "too many" as rate-limit gate', () => {
    const result = classifyMcpError(new Error('too many requests'));
    expect(result).toMatch(/rate limit/i);
  });

  // ── Branch 7: non-terminal status ────────────────────────────────────────
  it('classifies "non-terminal status" as still-processing message', () => {
    const result = classifyMcpError(new Error('[MCP Client] JSON response returned non-terminal status: queued'));
    expect(result).toMatch(/being processed/i);
  });

  // ── Branch 8: safe fallback ───────────────────────────────────────────────
  it('returns a safe fallback for completely unknown errors', () => {
    const result = classifyMcpError(new Error('some internal jargon: xyz_code_42'));
    expect(result).toMatch(/temporarily unavailable/i);
    // Fallback MUST NOT echo the raw error text
    expect(result).not.toContain('xyz_code_42');
  });

  it('handles non-Error values safely (null, undefined, plain string)', () => {
    expect(() => classifyMcpError(null)).not.toThrow();
    expect(() => classifyMcpError(undefined)).not.toThrow();
    expect(() => classifyMcpError('plain string error')).not.toThrow();
    // All non-Error non-matching values → fallback
    expect(classifyMcpError(null)).toMatch(/temporarily unavailable/i);
  });

  // ── All results must be non-empty strings ─────────────────────────────────
  it('always returns a non-empty string', () => {
    const cases = [
      new Error(''),
      new Error('[MCP Client] No active session.'),
      new Error('[MCP Client] Gateway unreachable: err'),
      new Error('[MCP Client] Agent timed out'),
      null,
    ];
    for (const c of cases) {
      const result = classifyMcpError(c);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    }
  });
});
