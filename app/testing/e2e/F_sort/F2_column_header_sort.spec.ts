// F2_column_header_sort.spec.ts
// Verifies the column click cycle and its accessible direction in both themes.
// Connects header interactions to refreshed table semantics and rendered rows.
// Keeps sort changes observable without fixed timing waits.
import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { switchToView } from '../helpers/view-switch';

test.describe('FX — Column Header Sort', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`clicking column header cycles accessible sort in ${theme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await page.evaluate((chosenTheme) => {
        document.body.classList.remove('light-mode', 'dark-mode');
        document.body.classList.add(`${chosenTheme}-mode`);
      }, theme);
      await navigateToDataset(page, 'app_service_catalog');
      await waitForDataLoaded(page, 'app_service_catalog');
      await switchToView(page, 'table');

      // Start from a semantic choice so the first header click always means ASC,
      // regardless of the account's saved default or a previous browser test.
      const sortBtn = page.locator('[data-testid="sort-dropdown-trigger"]:visible').first();
      await sortBtn.click();
      await page.locator('[data-testid="sort-dropdown-option-newest-desc"]:visible').first().click();
      const table = page.locator('#app_service_catalog_table');
      await expect(table.getByTestId('column-header-created')).toHaveAttribute('aria-sort', 'descending');
      await expect(table.getByTestId('column-header-created')).toHaveAttribute('data-aria-label-lang-key', 'sort_newest');

      // Clicking the resolved Newest column still starts its own ASC/DESC/none cycle.
      const header = table.getByTestId('column-header-created');
      const indicator = table.getByTestId('column-sort-created');
      for (const [direction, mark] of [['ascending', '▲'], ['descending', '▼'], [null, '⇵']] as const) {
        await indicator.click();
        await expect(indicator).toHaveText(mark);
        await expect(table.locator('thead [aria-sort]')).toHaveCount(direction ? 1 : 0);
        if (direction) {
          await expect(header).toHaveAttribute('aria-sort', direction);
        } else {
          await expect(header).not.toHaveAttribute('aria-sort');
        }
        await expect(header).toHaveAccessibleName(new RegExp(`^created\\s*${mark}$`));
        await expect(header).not.toHaveAttribute('aria-label');
        await expect(indicator).not.toHaveAttribute('title');
        await expect(table.locator('tbody tr').first()).toBeVisible();
      }
      await expect(page.locator('body')).toHaveClass(new RegExp(`${theme}-mode`));
    });
  }
});
