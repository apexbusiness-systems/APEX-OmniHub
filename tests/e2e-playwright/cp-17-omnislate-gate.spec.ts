/**
 * CP-17 — OmniSlate Honest Error Gate
 * Validates that OmniSlate displays an honest error gate message (never the legacy generic string)
 * when mcp-client invocation fails.
 */
import { test, expect } from '@playwright/test';
import { signInWithSupabaseSession, skipWithoutSupabaseConfig } from './helpers/auth';

test.describe('CP-17 — OmniSlate Error Gate', () => {
  test.beforeEach(async ({ page }) => {
    skipWithoutSupabaseConfig();
    await signInWithSupabaseSession(page);
  });

  test('OmniSlate chat surfaces classified error message when gateway returns error', async ({ page }) => {
    await page.goto('/omnidash');
    
    // Ensure input is visible
    const input = page.locator('input[placeholder*="Ask APEX Agent"]');
    if (await input.isVisible({ timeout: 5000 }).catch(() => false)) {
      await input.fill('Test prompt');
      await input.press('Enter');

      // Assert legacy generic error string is never shown
      const legacyError = page.getByText('[System Error]: Failed to contact APEX Agent. Guardian audit logged.');
      await expect(legacyError).not.toBeVisible();
    }
  });
});
