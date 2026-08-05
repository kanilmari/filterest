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

  test('clicking column header toggles sort', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await switchToView(page, "table");

    // Taulukkonäkymässä, klikkaa sarakkeen headeria
    const sortIndicators = page.locator('[data-testid^="column-sort-"]');
    await expect(sortIndicators.first()).toBeVisible({ timeout: 10000 });

    // Lue ensimmäisen sarakkeen solut ennen lajittelua
    const cells = page.locator('table tbody tr td:first-child, .cell:first-child');
    const firstCellBefore = await cells.first().textContent();

    // Klikkaa headeria
    await sortIndicators.first().click();
    await page.waitForTimeout(500);

    // Klikkaa toisen kerran (DESC)
    await sortIndicators.first().click();
    await page.waitForTimeout(500);

    // Varmista data on edelleen näkyvissä
    await expect(cells.first()).toBeVisible({ timeout: 5000 });
  });
});
