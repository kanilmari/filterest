/**
 * H3_many_to_many.spec.ts
 *
 * Verifies many-to-many UI element interaction in add-row form.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  goToAddRowSectionContaining,
  navigateToDataset,
  openAddRowForm,
  waitForDataLoaded,
} from '../helpers/navigation';

test.describe('H3 — Many To Many', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('many-to-many selection in form', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');

    await openAddRowForm(page);

    const form = page.locator('[data-testid="add-row-form"]');
    await expect(form.first()).toBeVisible({ timeout: 10000 });

    const relationSelector = 'fieldset[data-relation-kind="many-to-many"]';
    const relationPages = form.first().locator(relationSelector);
    test.skip(await relationPages.count() === 0, 'Dataset has no many-to-many relation metadata.');

    await goToAddRowSectionContaining(page, relationSelector);
    const relationPage = relationPages.first();
    await expect(relationPage).toBeVisible();

    const createNewRadio = relationPage.locator('input[type="radio"][value="new"]').first();
    await createNewRadio.check();
    await expect(createNewRadio).toBeChecked();

    await page.keyboard.press('Escape');
  });
});
