/**
 * H1_form_fields.spec.ts
 *
 * Verifies add-row form opens and renders input controls.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, openAddRowForm, waitForDataLoaded } from '../helpers/navigation';

test.describe('H1 — Form Fields', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('form renders different field types', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');

    await openAddRowForm(page);

    const form = page.locator('[data-testid="add-row-form"]');
    await expect(form.first()).toBeVisible({ timeout: 10000 });

    const inputs = form.first().locator('[data-testid^="form-input-"]');
    const inputCount = await inputs.count();
    expect(inputCount).toBeGreaterThan(0);

    const sections = form.first().locator(':scope > section[data-form-section]');
    expect(await sections.count()).toBeGreaterThan(0);
    if (await sections.count() > 1) {
      await expect(form.first().locator('[data-form-section-footer-direction="next"]')).toBeVisible();
      await expect(form.first().locator('[data-testid="btn-add-row-submit"]')).toBeHidden();
    }

    await page.keyboard.press('Escape');
  });
});
