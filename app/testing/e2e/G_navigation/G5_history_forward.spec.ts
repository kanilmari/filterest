/**
 * G5_history_forward.spec.ts
 *
 * Verifies that the browser forward button navigates forward in session history.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';

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
    // Each step lets the page finish booting first. A boot-time address write that lands while the next history
    // navigation is still loading is a same-document navigation Playwright takes for that navigation's end (dg5/d309g).
    await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');

    // Go back to A: the browser loads its document again (no back-forward cache) and the dataset settles.
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await waitForDataLoaded(page, 'app_service_catalog');
    expect(page.url()).not.toBe(urlB);

    // Go forward to B, and Home loads without a failure.
    await page.goForward({ waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.url()).toBe(urlB);
    await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
    // A rendered Home has its scroller; the load-failure surface has none.
    await expect(page.locator('#front_page_container .front-page-scroller')).toBeVisible();
  });
});
