/**
 * B4_column_view_presets.spec.ts
 *
 * Tests the column-view preset ("kenttäjoukko") feature:
 *   - Preset selector appears in the filter bar
 *   - Save a new preset from current column visibility
 *   - Apply a preset from the dropdown
 *   - Delete a preset
 *
 * Tests run sequentially (test.describe.serial) because they share
 * a preset created in the save test and deleted in the delete test.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';
import { openActiveFilterbarIfCollapsed } from '../helpers/filterbar';

test.describe.serial('B4 — Column View Presets (kenttäjoukot)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  let credentials: TestCredentials;
  const datasetName = buildTempDatasetName('e2e_column_presets');
  const presetName = `E2E_test_preset_${Date.now().toString(36)}`;

  test.beforeAll(async ({ browser }) => {
    credentials = loadCredentials();

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    try {
      await login(page, credentials);
      await createTempDataset(page, {
        datasetName,
        columns: {
          id: 'SERIAL',
          title: 'TEXT',
          status: 'TEXT',
          category: 'TEXT',
        },
        seedRows: [
          {
            title: 'preset-row',
            status: 'draft',
            category: 'news',
          },
        ],
      });
    } finally {
      await context.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    try {
      await login(page, credentials);
      await dropTempDataset(page, datasetName);
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`BROWSER ERROR: ${msg.text()}`);
    });
    await login(page, credentials);
    await openTempDataset(page, datasetName, 'table');
    await openActiveFilterbarIfCollapsed(page);
  });

  test('preset selector row is visible in the filter bar', async ({ page }) => {
    const presetRow = page.locator(
      `#${datasetName}_filterBar_panelBody [data-testid="column-view-preset-selector"]`,
    );
    await expect(presetRow).toBeVisible({ timeout: 5000 });

    const select = presetRow.locator('.column-preset-select');
    await expect(select).toBeVisible();
  });

  test('can save a new preset and it appears in the dropdown', async ({ page }) => {
    const presetRow = page.locator(
      `#${datasetName}_filterBar_panelBody [data-testid="column-view-preset-selector"]`,
    );
    await expect(presetRow).toBeVisible({ timeout: 5000 });

    const saveBtn = presetRow.locator('[data-lang-key="save_field_set"]');
    await expect(saveBtn).toBeVisible({ timeout: 3000 });

    await saveBtn.click();
    const nameInput = page.locator('[data-testid="input-modal-input"]:visible').first();
    await expect(nameInput).toBeVisible({ timeout: 3000 });
    await nameInput.fill(presetName);
    const confirmSave = page
      .locator('[data-testid="input-modal-confirm-button"]:visible')
      .first();
    await expect(confirmSave).toBeVisible({ timeout: 3000 });
    await confirmSave.click();

    const select = presetRow.locator('.column-preset-select');
    await expect(select.locator('option').filter({ hasText: presetName })).toHaveCount(1, {
      timeout: 10000,
    });
  });

  test('can apply a saved preset from dropdown', async ({ page }) => {
    const presetRow = page.locator(
      `#${datasetName}_filterBar_panelBody [data-testid="column-view-preset-selector"]`,
    );
    await expect(presetRow).toBeVisible({ timeout: 5000 });

    const select = presetRow.locator('.column-preset-select');
    await select.focus();

    const targetOption = select.locator(`option:has-text("${presetName}")`);
    await expect(targetOption).toHaveCount(1, { timeout: 10000 });

    const value = await targetOption.getAttribute('value');
    await select.selectOption(value!);
    await page.waitForTimeout(500);

    const updateBtn = presetRow.locator('[data-lang-key="update_field_set"]');
    await expect(updateBtn).toBeVisible({ timeout: 3000 });

    const clearBtn = presetRow.locator('[data-lang-key="clear_selections"]');
    await expect(clearBtn).toBeVisible({ timeout: 3000 });
  });

  test('can delete a preset', async ({ page }) => {
    const presetRow = page.locator(
      `#${datasetName}_filterBar_panelBody [data-testid="column-view-preset-selector"]`,
    );
    await expect(presetRow).toBeVisible({ timeout: 5000 });

    const select = presetRow.locator('.column-preset-select');
    await select.focus();

    const targetOption = select.locator(`option:has-text("${presetName}")`);
    await expect(targetOption).toHaveCount(1, { timeout: 10000 });

    const value = await targetOption.getAttribute('value');
    await select.selectOption(value!);
    await page.waitForTimeout(500);

    const moreBtn = presetRow.locator('[data-lang-key="more_actions"]');
    await expect(moreBtn).toBeVisible({ timeout: 3000 });
    await moreBtn.click();
    await page.waitForTimeout(300);

    const deleteBtn = presetRow.locator('[data-lang-key="delete_field_set"]');
    await expect(deleteBtn).toBeVisible({ timeout: 3000 });
    await deleteBtn.click();
    await page.waitForTimeout(300);

    const confirmModal = page.locator('[data-testid="modal-container"]');
    await expect(confirmModal).toBeVisible({ timeout: 3000 });

    const confirmBtn = confirmModal.locator('[data-testid="confirm-modal-confirm-button"]').first();
    await expect(confirmBtn).toBeVisible({ timeout: 3000 });
    await confirmBtn.click();
    await page.waitForTimeout(1500);

    const optionsAfter = await select.locator('option').allTextContents();
    expect(optionsAfter.some((text) => text.includes(presetName))).toBe(false);
  });
});
