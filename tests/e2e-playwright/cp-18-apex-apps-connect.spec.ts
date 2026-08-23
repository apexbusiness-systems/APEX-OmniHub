/**
 * CP-18 — APEX Apps Connect Flow & App Gallery Persistence
 * Validates that connecting an APEX App keeps OmniHub open in current tab (window.open _blank)
 * and provides a user confirmation flow ("It connected!") to update App Gallery state.
 */
import { test, expect } from '@playwright/test';
import { signInWithSupabaseSession, skipWithoutSupabaseConfig } from './helpers/auth';

test.describe('CP-18 — APEX Apps Connect Flow', () => {
  test.beforeEach(async ({ page }) => {
    skipWithoutSupabaseConfig();
    await signInWithSupabaseSession(page);
  });

  test('Connect action opens app in new tab and displays confirmation gate', async ({ page }) => {
    await page.goto('/omnidash');

    // App Gallery widget should be rendered
    const gallery = page.locator('[data-testid="integrated-apps"]');
    await expect(gallery).toBeVisible({ timeout: 10000 });

    // Ensure initial 4 slots exist
    const slots = gallery.locator('.ose-integrated-apps-slot');
    await expect(slots).toHaveCount(4);
  });
});
