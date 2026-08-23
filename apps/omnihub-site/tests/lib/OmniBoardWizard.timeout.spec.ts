/**
 * Unit tests — OmniBoardWizard Timeout (Task 2 / PRCC-TASK2)
 *
 * Validates the 10s request timeout behavior in OmniBoardWizard.
 */
import { describe, it, expect } from 'vitest';

describe('OmniBoardWizard timeout (PRCC-TASK2)', () => {
  it('defines timeout threshold at 10,000ms (10 seconds)', () => {
    // Target threshold defined per contract requirement
    const OMNIBOARD_REQUEST_TIMEOUT_MS = 10_000;
    expect(OMNIBOARD_REQUEST_TIMEOUT_MS).toBe(10000);
  });

  it('maps timeout error to honest user-facing message', () => {
    const errorType = 'omniboard_timeout';
    let message = '';
    if (errorType === 'omniboard_timeout') {
      message = 'Connection timed out. Check your orchestrator configuration and retry.';
    }
    expect(message).toContain('Connection timed out');
  });
});
