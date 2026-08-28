/**
 * D1_switch_to_table.spec.ts
 *
 * Tests switching to table view using the view selector button.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { switchToView } from '../helpers/view-switch';

test.describe('D1 — Switch to Table View', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('can switch to table view', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');

    // Switch to card first to ensure we're not already in table view
    await switchToView(page, 'card');

    // Now switch to table view
    await switchToView(page, 'table');

    // Verify table view is rendered
    const table = page.locator('[data-testid="dataset-view-table"]');
    await expect(table.first()).toBeVisible({ timeout: 10000 });

    // Verify rows are present
    const rows = page.locator('table tbody tr');
    await expect(rows.first()).toBeVisible({ timeout: 10000 });
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });
});
