/**
 * H3_many_to_many.spec.ts
 *
 * Verifies existing-row many-to-many linking in the shared add-row step.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  goToAddRowSectionContaining,
  navigateToDataset,
  openAddRowForm,
  waitForDataLoaded,
} from '../helpers/navigation';

test.describe('H3 — Existing relation links', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('many-to-many links select existing rows and never open a nested create form', async ({ page }) => {
    const relationSelector = 'fieldset[data-relation-kind="many_to_many"]';
    let form = page.locator('[data-testid="add-row-form"]');
    let relationPages = form.first().locator(relationSelector);
    let relationDatasetFound = false;

    // Public bootstrap data and the long-lived Easelect development database
    // use different technical names for the same sample surface. Exercise the
    // first visible candidate that actually has registered M:M metadata.
    for (const datasetName of ['app_service_catalog', 'dokumentaatio']) {
      const tab = page.locator(`[data-testid="tab-${datasetName}"]`).first();
      if (await tab.count() > 0) {
        await navigateToDataset(page, datasetName);
      } else {
        await page.goto(`/${datasetName}`);
      }
      await waitForDataLoaded(page, datasetName);
      const formOpenStartedAt = Date.now();
      await openAddRowForm(page);
      form = page.locator('[data-testid="add-row-form"]');
      await expect(form.first()).toBeVisible({ timeout: 10000 });
      expect(Date.now() - formOpenStartedAt).toBeLessThan(3000);
      relationPages = form.first().locator(relationSelector);
      if (await relationPages.count() > 0) {
        relationDatasetFound = true;
        break;
      }
      await page.keyboard.press('Escape');
    }
    test.skip(!relationDatasetFound, 'Available sample datasets have no many-to-many relation metadata.');

    await goToAddRowSectionContaining(page, relationSelector);
    const relationPage = relationPages.first();
    await expect(relationPage).toBeVisible();

    await expect(relationPage.locator('input[type="radio"][value="new"]')).toHaveCount(0);
    await expect(relationPage.locator('.msd-dropdown-input')).toBeVisible();
    await expect(
      form.first().locator('button[data-form-section-target="link-existing-data"]'),
    ).toHaveAttribute('aria-current', 'step');

    await relationPage.locator('.msd-dropdown-input').click();
    const openList = page.locator('.msd-dropdown-list:visible').last();
    const search = openList.locator('.msd-dropdown-search-input');
    await expect(search).toHaveAttribute('placeholder', /name|ID|nimell/i);

    const firstOption = openList.locator('.msd-option').first();
    if (await firstOption.count() > 0) {
      const label = await firstOption.locator('.msd-option-label').innerText();
      const id = label.match(/#([^\s]+)$/)?.[1];
      if (id) {
        await search.fill(id);
        await expect(openList.locator('.msd-option')).toHaveCount(1);
      }
    }

    await page.keyboard.press('Escape');
  });
});
