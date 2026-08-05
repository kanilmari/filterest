/**
 * C4_card_infinite_scroll.spec.ts
 *
 * Verifies card view behavior when scrolling down for additional card loading.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset } from '../helpers/navigation';
import { switchToView } from '../helpers/view-switch';
import { getActiveScrollableMetrics, scrollActiveContentToBottom } from '../helpers/scroll';

test.describe('C4 — Card Infinite Scroll', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('scrolling down loads more cards', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await switchToView(page, 'card');
    await page.waitForSelector('[data-testid="card-item"]', { timeout: 10000 });
    const cards = page.locator('[data-testid="card-item"]');
    const initialCount = await cards.count();
    const beforeScroll = await getActiveScrollableMetrics(page);
    expect(beforeScroll).not.toBeNull();

    await scrollActiveContentToBottom(page);
    await page.waitForTimeout(2000);

    const afterScroll = await getActiveScrollableMetrics(page);
    expect(afterScroll).not.toBeNull();

    if (
      beforeScroll &&
      afterScroll &&
      beforeScroll.containerScrollHeight > beforeScroll.containerClientHeight
    ) {
      expect(afterScroll.containerScrollTop).toBeGreaterThan(beforeScroll.containerScrollTop);
    }

    const afterScrollCount = await cards.count();
    expect(afterScrollCount).toBeGreaterThanOrEqual(initialCount);

    if (afterScroll) {
      expect(afterScroll.containerScrollWidth).toBeLessThanOrEqual(afterScroll.containerClientWidth + 1);
      expect(afterScroll.documentScrollWidth).toBeLessThanOrEqual(afterScroll.documentClientWidth + 1);
    }
  });
});
