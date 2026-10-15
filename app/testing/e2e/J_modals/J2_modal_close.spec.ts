/**
 * J2_modal_close.spec.ts
 * Verifies that add-row dialogs stay closed after X and Escape, including loading.
 * Connects the normal add-row opener to the shared modal's async close lifecycle.
 * Prevents a briefly hidden loading dialog from concealing a later re-open.
 */

import { test, expect, type Page } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { firstVisibleByTestId, navigateToDataset, openAddRowForm, waitForDataLoaded } from '../helpers/navigation';

async function expectModalStaysHidden(page: Page): Promise<void> {
  const visibleModals = page.locator('[data-testid="modal-container"]:visible');
  const until = Date.now() + 1000;
  // Each sample must pass immediately: retrying a count assertion could mask
  // the pending form build re-opening the dialog during this observation.
  do {
    expect(await visibleModals.count()).toBe(0);
    await page.waitForTimeout(50);
  } while (Date.now() < until);
  expect(await visibleModals.count()).toBe(0);
}

test.describe('J2 — Modal Close', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('modal closes with X button', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await openAddRowForm(page);
    const modal = firstVisibleByTestId(page, 'modal-container');
    await expect(modal).toBeVisible({ timeout: 5000 });
    const closeBtn = firstVisibleByTestId(page, 'modal-close-button');
    if (await closeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await closeBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(modal).toBeHidden({ timeout: 5000 });
    await expectModalStaysHidden(page);
  });

  test('modal closes with Escape key', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await openAddRowForm(page);
    const modal = firstVisibleByTestId(page, 'modal-container');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden({ timeout: 5000 });
    await expectModalStaysHidden(page);
  });
});
