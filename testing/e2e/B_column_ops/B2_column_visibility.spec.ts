import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';
import { clickFirstVisibleByTestId } from '../helpers/navigation';

async function setColumnVisibility(page: import('@playwright/test').Page, testId: string, checked: boolean): Promise<void> {
  const updated = await page.evaluate(({ checked: shouldCheck, testId: targetTestId }) => {
    const toggle = document.querySelector(`[data-testid="${targetTestId}"]`);
    if (!(toggle instanceof HTMLInputElement) || toggle.type !== 'checkbox') {
      return false;
    }

    toggle.checked = shouldCheck;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }, { checked, testId });

  if (!updated) {
    throw new Error(`Could not update column visibility toggle "${testId}".`);
  }
}

test.describe('B2 — Column Visibility', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('column can be hidden and shown', async ({ page }) => {
    const datasetName = buildTempDatasetName('e2e_column_visibility');

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
          title: 'column-visibility-row',
          status: 'draft',
          category: 'news',
        },
      ],
    });

    try {
      await openTempDataset(page, datasetName, 'table');

      const visibleHeaders = page.locator('[data-testid^="column-header-"]:visible');
      const targetHeader = page.locator('[data-testid="column-header-category"]').first();
      await expect(targetHeader).toBeVisible({ timeout: 5000 });

      const columnToggleTestId = `column-visibility-toggle-${datasetName}-category`;
      let columnToggle = page.locator(
        `[data-testid="${columnToggleTestId}"]`,
      ).first();

      if (!(await columnToggle.isVisible({ timeout: 1000 }).catch(() => false))) {
        const filterbarToggle = page.locator('[data-testid="filterbar-toggle"]').first();
        if (await filterbarToggle.isVisible({ timeout: 1000 }).catch(() => false)) {
          await clickFirstVisibleByTestId(page, 'filterbar-toggle');
        }
      }

      columnToggle = page.locator(`[data-testid="${columnToggleTestId}"]`).first();
      await expect(columnToggle).toHaveCount(1, { timeout: 5000 });

      const headersBefore = await visibleHeaders.count();
      await setColumnVisibility(page, columnToggleTestId, false);
      await page.waitForTimeout(300);

      const headersAfterHide = await visibleHeaders.count();
      expect(headersAfterHide).toBeLessThan(headersBefore);
      await expect(targetHeader).toBeHidden({ timeout: 3000 });

      await setColumnVisibility(page, columnToggleTestId, true);
      await page.waitForTimeout(300);

      const headersAfterRestore = await visibleHeaders.count();
      expect(headersAfterRestore).toBe(headersBefore);
      await expect(targetHeader).toBeVisible({ timeout: 3000 });
    } finally {
      if (!page.isClosed()) {
        await dropTempDataset(page, datasetName);
      }
    }
  });
});
