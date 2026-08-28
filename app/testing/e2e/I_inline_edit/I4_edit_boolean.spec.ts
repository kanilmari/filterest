/**
 * I4_edit_boolean.spec.ts
 *
 * Tests inline editing of boolean values in table view.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

async function setInlineEditorCheckbox(
  page: import('@playwright/test').Page,
  checked: boolean,
): Promise<void> {
  await page.locator('[data-testid="table-editor"][type="checkbox"]').first().evaluate((input, nextChecked) => {
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    input.checked = Boolean(nextChecked);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, checked);
}

test.describe('I4 — Edit Boolean', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('inline edit boolean cell', async ({ page }) => {
    const datasetName = buildTempDatasetName('e2e_inline_boolean');
    const originalValue = 'true';

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        enabled: 'BOOLEAN',
        label: 'TEXT',
      },
      seedRows: [
        {
          enabled: true,
          label: 'inline-boolean-row',
        },
      ],
    });

    try {
      await openTempDataset(page, datasetName, 'table');

      const booleanCell = page.locator(
        `#${datasetName}_table_view_container [data-column="enabled"]`,
      ).first();
      await expect(booleanCell).toContainText(originalValue, { timeout: 10000 });

      await booleanCell.dblclick();
      const checkbox = page.locator('[data-testid="table-editor"][type="checkbox"]').first();
      await expect(checkbox).toBeVisible({ timeout: 3000 });
      const originalChecked = await checkbox.isChecked();

      try {
        await setInlineEditorCheckbox(page, !originalChecked);
        await page.keyboard.press('Tab').catch(() => {});
        await expect
          .poll(async () => (await booleanCell.textContent())?.trim().toLowerCase(), {
            timeout: 3000,
          })
          .toBe('false');

        await booleanCell.dblclick();
        const restoreCheckbox = page.locator('[data-testid="table-editor"][type="checkbox"]').first();
        await expect(restoreCheckbox).toBeVisible({ timeout: 3000 });
        const currentChecked = await restoreCheckbox.isChecked();
        if (currentChecked !== originalChecked) {
          await setInlineEditorCheckbox(page, originalChecked);
        }
        await page.keyboard.press('Tab').catch(() => {});
        await expect
          .poll(async () => (await booleanCell.textContent())?.trim().toLowerCase(), {
            timeout: 3000,
          })
          .toBe(originalValue);
      } finally {
        await page.keyboard.press('Escape').catch(() => {});
      }
    } finally {
      if (!page.isClosed()) {
        await dropTempDataset(page, datasetName);
      }
    }
  });
});
