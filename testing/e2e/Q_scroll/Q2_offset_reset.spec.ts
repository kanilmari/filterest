import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';

test.describe('Q2 — Offset Reset', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('offset resets when changing table', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    // Scrollaa alas ensin
    await page.evaluate(() => {
      const container = document.querySelector('.scrollable_content, .table-container, main');
      if (container) container.scrollTop = container.scrollHeight;
    });
    await page.waitForTimeout(1000);
    // Vaihda toiseen tauluun
    const tabs = page.locator('[data-testid^="tab-"]:not([data-testid="tab-user"]):not([data-testid="tab-logout"]):not([data-testid="tab-system_about"])');
    if (await tabs.nth(1).isVisible({ timeout: 3000 }).catch(() => false)) {
      await tabs.nth(1).evaluate((el: HTMLElement) => el.click());
      await page.waitForTimeout(1000);
      // Scroll-position pitäisi olla nollassa
      const scrollTop = await page.evaluate(() => {
        const container = document.querySelector('.scrollable_content, .table-container, main');
        return container ? container.scrollTop : 0;
      });
      expect(scrollTop).toBe(0);
    }
  });
});
