/**
 * T8_app_db_compatibility_mirror.spec.ts
 *
 * Verifies that the app↔DB compatibility mirror is discoverable via the
 * database -> system nav-tree path and opens through a real browser click flow.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { waitForAppReady, waitForDataLoaded } from '../helpers/navigation';
import {
  openAdminNavigationTree,
  revealNavigationDatasetButtonByNodeId,
} from '../helpers/navigation-tree';

test.describe('T8 — App/DB Compatibility Mirror Navigation', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
    await waitForAppReady(page);
  });

  test('database/system path exposes the compatibility mirror with a seeded label', async ({ page }) => {
    const navigationTree = await openAdminNavigationTree(page);
    const compatibilityButton = await revealNavigationDatasetButtonByNodeId(
      navigationTree,
      't_system_app_db_compatibility',
    );
    await expect(compatibilityButton).toBeVisible({ timeout: 10000 });

    const buttonText = (await compatibilityButton.textContent())?.trim() ?? '';
    expect(buttonText, 'Compatibility mirror navigation label must be non-empty.').not.toBe('');
    expect(buttonText).not.toMatch(/^System app db compatibility$/i);

    await compatibilityButton.scrollIntoViewIfNeeded();
    await compatibilityButton.click();

    await waitForDataLoaded(page, 'system_app_db_compatibility');
    await page.waitForSelector('#system_app_db_compatibility_container, #system_app_db_compatibility_table_view_container', {
      state: 'attached',
      timeout: 15000,
    });
    await expect(page).toHaveURL(/system_app_db_compatibility/, { timeout: 10000 });
  });
});
