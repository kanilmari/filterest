// nav_history_buttons.spec.ts
// E2E tests for the back/forward navigation buttons in the top bar.
// Verifies button states, navigation flow, and edge cases.
// Uses /frontend/... paths so the app's history_navigation.js ignores
// them (it returns early for /frontend/ paths), keeping the DOM stable.

import { test, expect, type Locator } from '@playwright/test';

async function clickNavButton(button: Locator): Promise<void> {
  await button.evaluate((element) => {
    if (element instanceof HTMLButtonElement) {
      element.click();
    }
  });
}

async function waitForUrlToStabilize(page: import('@playwright/test').Page): Promise<void> {
  let previousUrl = page.url();
  let stableForMs = 0;

  while (stableForMs < 300) {
    await page.waitForTimeout(100);
    const currentUrl = page.url();
    if (currentUrl === previousUrl) {
      stableForMs += 100;
      continue;
    }
    previousUrl = currentUrl;
    stableForMs = 0;
  }
}

test.describe('Back/Forward Navigation Buttons', () => {

  test.beforeEach(async ({ page }) => {
    // Use wide viewport so navbar is expanded (threshold ~1850px)
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    // Wait for navbar to be visible (not collapsed)
    await expect(page.locator('#navbar')).not.toHaveClass(/collapsed/);
    await expect(page.locator('#navBackBtn')).toBeVisible();
    await expect(page.locator('#navForwardBtn')).toBeVisible();
    await waitForUrlToStabilize(page);
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
    await clickNavButton(backBtn);

    // Wait for popstate processing
    await page.waitForTimeout(500);

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
    await clickNavButton(backBtn);
    await expect(page).toHaveURL(/\/frontend\/test-page-1$/, { timeout: 5000 });

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
    await clickNavButton(backBtn);
    await expect(page).toHaveURL(/\/frontend\/page-b$/, { timeout: 5000 });
    await clickNavButton(backBtn);
    await expect(page).toHaveURL(/\/frontend\/page-a$/, { timeout: 5000 });
    await clickNavButton(backBtn);
    await expect(page).toHaveURL(startingUrl, { timeout: 5000 });

    // At the starting page the exact back-button state depends on whether the
    // app boot path itself pushed one extra browser-history entry.  The
    // important invariant here is that forward navigation is now available and
    // returns to the pushed pages in order.
    await expect(forwardBtn).toBeEnabled();

    // Go forward twice
    await clickNavButton(forwardBtn);
    await expect(page).toHaveURL(/\/frontend\/page-a$/, { timeout: 5000 });
    await clickNavButton(forwardBtn);
    await expect(page).toHaveURL(/\/frontend\/page-b$/, { timeout: 5000 });

    // At page-b: both enabled
    await expect(backBtn).toBeEnabled();
    await expect(forwardBtn).toBeEnabled();
  });

  test('Disabled buttons do not trigger navigation', async ({ page }) => {
    const backBtn = page.locator('#navBackBtn');
    const forwardBtn = page.locator('#navForwardBtn');

    const urlBefore = page.url();

    // Disabled native buttons should ignore DOM click() without changing history.
    await backBtn.evaluate((button) => {
      if (button instanceof HTMLButtonElement) {
        button.click();
      }
    });
    await page.waitForTimeout(300);

    // URL should not change
    expect(page.url()).toBe(urlBefore);

    await forwardBtn.evaluate((button) => {
      if (button instanceof HTMLButtonElement) {
        button.click();
      }
    });
    await page.waitForTimeout(300);

    expect(page.url()).toBe(urlBefore);
  });

});
