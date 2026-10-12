// G4_history_back.spec.ts
// Verifies the visible back/forward controls at each project's actual width.
// Connects completed app startup, the real navbar opener and browser history.
// Synthetic /frontend/ entries isolate button history from dataset rendering.

import { test, expect, type Locator, type Page } from '@playwright/test';
import { ensureNavbarVisible } from '../helpers/navbar';

async function clickNavButton(page: Page, button: Locator, destination: string | RegExp): Promise<void> {
  await expect(button).toBeEnabled();
  await button.click();
  // Button states update optimistically. The address proves the browser has
  // actually traversed before another click or pushState can change history.
  await expect(page).toHaveURL(destination);
}

test.describe('Back/Forward Navigation Buttons', () => {

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('navVisibleWide', 'true');
      localStorage.setItem('navVisibleNarrow', 'false');
    });
    await page.goto('/');
    // A visible navbar and 300ms without a URL change do not mean startup
    // finished. The default dataset can still write history after that gap.
    await page.waitForFunction(() => (window as Window & {
      __filterestShellBoot?: { status: () => { ready: boolean } };
    }).__filterestShellBoot?.status().ready === true);
    await expect(page.locator('#tabs_container .content_div:visible').first()).toBeVisible();
    await ensureNavbarVisible(page);
    await expect(page.locator('#navBackBtn')).toBeVisible();
    await expect(page.locator('#navForwardBtn')).toBeVisible();
  });

  test('Both buttons are disabled on initial page load', async ({ page }) => {
    const backBtn = page.locator('#navBackBtn');
    const forwardBtn = page.locator('#navForwardBtn');

    await expect(backBtn).toBeVisible();
    await expect(forwardBtn).toBeVisible();
    await expect(backBtn).toBeDisabled();
    await expect(forwardBtn).toBeDisabled();
  });

  test('Back button enables after navigation via pushState', async ({ page }) => {
    const backBtn = page.locator('#navBackBtn');
    const forwardBtn = page.locator('#navForwardBtn');

    // Initially disabled
    await expect(backBtn).toBeDisabled();

    // Trigger a pushState navigation using a /frontend/ path
    // (history_navigation.js ignores /frontend/ paths)
    await page.evaluate(() => {
      history.pushState({}, '', '/frontend/test-page-1');
    });

    // Back should now be enabled, forward still disabled
    await expect(backBtn).toBeEnabled();
    await expect(forwardBtn).toBeDisabled();
  });

  test('Forward button enables after pressing back', async ({ page }) => {
    const backBtn = page.locator('#navBackBtn');
    const forwardBtn = page.locator('#navForwardBtn');

    // Navigate forward twice via pushState (using /frontend/ paths)
    await page.evaluate(() => {
      history.pushState({}, '', '/frontend/test-page-1');
      history.pushState({}, '', '/frontend/test-page-2');
    });

    await expect(backBtn).toBeEnabled();
    await expect(forwardBtn).toBeDisabled();

    // Click back
    await clickNavButton(page, backBtn, /\/frontend\/test-page-1$/);

    // Forward should now be enabled
    await expect(forwardBtn).toBeEnabled();
    await expect(backBtn).toBeEnabled(); // Still can go back to initial page
  });

  test('New navigation after back clears forward history', async ({ page }) => {
    const backBtn = page.locator('#navBackBtn');
    const forwardBtn = page.locator('#navForwardBtn');

    // Navigate: initial → page1 → page2
    await page.evaluate(() => {
      history.pushState({}, '', '/frontend/test-page-1');
      history.pushState({}, '', '/frontend/test-page-2');
    });

    await expect(backBtn).toBeEnabled();

    // Go back
    await clickNavButton(page, backBtn, /\/frontend\/test-page-1$/);

    // Forward should be enabled
    await expect(forwardBtn).toBeEnabled();

    // Now navigate to a new page (this should clear forward history)
    await page.evaluate(() => {
      history.pushState({}, '', '/frontend/test-page-3');
    });

    // Forward should be disabled (forward history cleared)
    await expect(forwardBtn).toBeDisabled();
    // Back should still be enabled
    await expect(backBtn).toBeEnabled();
  });

  test('Multiple back and forward clicks work correctly', async ({ page }) => {
    const backBtn = page.locator('#navBackBtn');
    const forwardBtn = page.locator('#navForwardBtn');
    const startingUrl = page.url();

    // Navigate through 3 pages
    await page.evaluate(() => {
      history.pushState({}, '', '/frontend/page-a');
      history.pushState({}, '', '/frontend/page-b');
      history.pushState({}, '', '/frontend/page-c');
    });

    // At page-c: back enabled, forward disabled
    await expect(backBtn).toBeEnabled();
    await expect(forwardBtn).toBeDisabled();

    // Go back 3 times and verify each history step explicitly instead of
    // assuming the landing page has no earlier browser-history entry.
    await clickNavButton(page, backBtn, /\/frontend\/page-b$/);
    await clickNavButton(page, backBtn, /\/frontend\/page-a$/);
    await clickNavButton(page, backBtn, startingUrl);

    // At the starting page the exact back-button state depends on whether the
    // app boot path itself pushed one extra browser-history entry.  The
    // important invariant here is that forward navigation is now available and
    // returns to the pushed pages in order.
    await expect(forwardBtn).toBeEnabled();

    // Go forward twice
    await clickNavButton(page, forwardBtn, /\/frontend\/page-a$/);
    await clickNavButton(page, forwardBtn, /\/frontend\/page-b$/);

    // At page-b: both enabled
    await expect(backBtn).toBeEnabled();
    await expect(forwardBtn).toBeEnabled();
  });

  test('Disabled buttons do not trigger navigation', async ({ page }) => {
    const backBtn = page.locator('#navBackBtn');
    const forwardBtn = page.locator('#navForwardBtn');

    const urlBefore = page.url();

    for (const button of [backBtn, forwardBtn]) {
      await expect(button).toBeDisabled();
      // Native disabled controls dispatch no click, so their history handler
      // cannot run. Prove this synchronously instead of sleeping for a no-op.
      const clickCount = await button.evaluate((element: HTMLButtonElement) => {
        let count = 0;
        const recordClick = () => { count += 1; };
        element.addEventListener('click', recordClick);
        element.click();
        element.removeEventListener('click', recordClick);
        return count;
      });
      expect(clickCount).toBe(0);
      await expect(page).toHaveURL(urlBefore);
    }
  });

});
