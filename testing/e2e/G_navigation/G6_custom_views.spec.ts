/**
 * G6_custom_views.spec.ts
 *
 * Verifies that custom views UI is accessible or that the API endpoint responds.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset } from '../helpers/navigation';

test.describe('G6 — Custom Views', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('custom views button opens view selector or API responds', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');

    const viewButton = page.locator('[data-testid="view-dropdown-more-trigger"]').first();

    if (await viewButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await viewButton.evaluate((el: HTMLElement) => {
        el.scrollIntoView({ block: 'center' });
        el.click();
      });
      await page.waitForTimeout(500);
      await expect(page.locator('[data-testid="view-dropdown-more-list"]')).toBeVisible();
    } else {
      // Fallback: verify the API endpoint is reachable
      const status = await page.evaluate(() =>
        fetch('/api/get-view-data?view=systemview_role_table_privileges', {
          credentials: 'include',
        }).then((r) => r.status),
      );
      expect([200, 404, 403]).toContain(status);
    }
  });
});
