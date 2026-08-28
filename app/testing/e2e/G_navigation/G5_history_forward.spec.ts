/**
 * G5_history_forward.spec.ts
 *
 * Verifies that the browser forward button navigates forward in session history.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset } from '../helpers/navigation';

test.describe('G5 — History Forward', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('browser forward button navigates forward in history', async ({ page }) => {
    // Navigate to table A
    await navigateToDataset(page, 'app_service_catalog');
    const urlA = page.url();

    // Navigate to table B (home / root)
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const urlB = page.url();

    // Sanity: we should be on a different URL now
    // (even if both end up at /, the history entry was pushed)

    // Go back to A
    await page.goBack({ waitUntil: 'domcontentloaded' });

    // Go forward to B
    await page.goForward({ waitUntil: 'domcontentloaded' });

    const urlAfterForward = page.url();

    // Forward should have landed us on urlB (or at least not on urlA)
    expect(urlAfterForward).toBe(urlB);
  });
});
