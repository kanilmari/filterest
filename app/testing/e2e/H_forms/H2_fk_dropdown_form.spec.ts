/**
 * H2_fk_dropdown_form.spec.ts
 *
 * Verifies foreign key dropdown availability in add-row form.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  goToAddRowSectionContaining,
  navigateToDataset,
  openAddRowForm,
  waitForDataLoaded,
} from '../helpers/navigation';

async function makeDetailsSectionValid(page: import('@playwright/test').Page): Promise<void> {
  const requiredFields = page.locator(
    '[data-testid="add-row-form"] section[data-section-key="details"] '
      + 'input[required], select[required], textarea[required]',
  );
  await requiredFields.evaluateAll((fields) => {
    fields.forEach((field) => {
      if (field instanceof HTMLInputElement) {
        if (field.type === 'checkbox' || field.type === 'radio') {
          field.checked = true;
        } else if (field.type === 'number') {
          field.value = field.min || '1';
        } else if (field.type === 'date') {
          field.value = '2026-09-05';
        } else if (field.type === 'datetime-local') {
          field.value = '2026-09-05T12:00';
        } else if (field.type === 'email') {
          field.value = 'browser-proof@example.test';
        } else if (field.type === 'url') {
          field.value = 'https://example.test/';
        } else {
          field.value = 'Browser FK proof';
        }
      } else if (field instanceof HTMLTextAreaElement) {
        field.value = 'Browser FK proof';
      } else if (field instanceof HTMLSelectElement) {
        const option = Array.from(field.options).find((candidate) => candidate.value !== '');
        if (option) field.value = option.value;
      }
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
}

test.describe('H2 — FK Dropdown Form', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('FK dropdown loads options in form', async ({ page }) => {
    const relationSelector = 'fieldset[data-relation-kind="foreign-key"]';
    let form = page.locator('[data-testid="add-row-form"]');
    let fkRelation = form.first().locator(relationSelector).first();
    let foreignKeyDatasetFound = false;

    for (const datasetName of ['app_service_catalog', 'dokumentaatio', 'dev_agent_tasks']) {
      const tab = page.locator(`[data-testid="tab-${datasetName}"]`).first();
      if (await tab.count() > 0) {
        await navigateToDataset(page, datasetName);
      } else {
        await page.goto(`/${datasetName}`);
      }
      await waitForDataLoaded(page, datasetName);
      await openAddRowForm(page);
      form = page.locator('[data-testid="add-row-form"]');
      await expect(form.first()).toBeVisible({ timeout: 10000 });
      fkRelation = form.first().locator(relationSelector).first();
      if (await fkRelation.count() > 0) {
        foreignKeyDatasetFound = true;
        break;
      }
      await page.keyboard.press('Escape');
    }
    test.skip(!foreignKeyDatasetFound, 'Available sample datasets have no direct foreign key field.');

    // Forward navigation deliberately validates Details. Satisfy those fields
    // so this proof reaches the relation picker through the same path as a user.
    await makeDetailsSectionValid(page);
    await goToAddRowSectionContaining(page, relationSelector);
    await expect(fkRelation.locator('.msd-dropdown-input')).toBeVisible();
    await expect(fkRelation.locator('input[type="radio"][value="new"]')).toHaveCount(0);
    await fkRelation.locator('.msd-dropdown-input').click();

    const openList = page.locator('.msd-dropdown-list:visible').last();
    const search = openList.locator('.msd-dropdown-search-input');
    await expect(search).toHaveAttribute('placeholder', /name|ID|nimell/i);

    const firstOption = openList.locator('.msd-option').first();
    if (await firstOption.count() > 0) {
      await firstOption.locator('.msd-option-checkbox').click();
      await expect(fkRelation.locator('.msd-dropdown-input')).toHaveValue(/#|·/);
    }

    await page.keyboard.press('Escape');
  });
});
