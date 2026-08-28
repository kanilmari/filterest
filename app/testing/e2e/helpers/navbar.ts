/**
 * navbar.ts — Shared E2E readiness helpers for navbar-bound controls.
 *
 * Keeps tests on the real menu-button interaction path when persisted or
 * responsive state starts with the fixed navbar collapsed off-screen.
 */

import { expect, type Page } from '@playwright/test';

const NAVBAR_VISIBILITY_CHANGED_EVENT = 'navbar-visibility-changed';
const NAVBAR_OPEN_TIMEOUT_MS = 5000;

async function waitForNavbarOpenedEvent(page: Page): Promise<void> {
  await page.evaluate(
    ({ eventName, timeoutMs }) => new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timeoutId);
        window.removeEventListener(eventName, handleVisibilityChange);
      };
      const handleVisibilityChange = (event: Event) => {
        const detail = (event as CustomEvent<{ isVisible?: boolean }>).detail;
        if (detail?.isVisible !== true) {
          return;
        }
        cleanup();
        resolve();
      };
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for ${eventName} to report an open navbar.`));
      }, timeoutMs);

      window.addEventListener(eventName, handleVisibilityChange);
    }),
    {
      eventName: NAVBAR_VISIBILITY_CHANGED_EVENT,
      timeoutMs: NAVBAR_OPEN_TIMEOUT_MS,
    },
  );
}

/**
 * Opens a collapsed navbar through its real visible menu button and waits for
 * the production visibility event plus the completed on-screen state.
 */
export async function ensureNavbarVisible(page: Page): Promise<void> {
  const navbar = page.locator('#navbar');
  const showMenuButton = page.locator('#showMenuButton');
  await expect(navbar).toHaveCount(1);

  const navbarClasses = await navbar.getAttribute('class');
  if (String(navbarClasses || '').split(/\s+/).includes('collapsed')) {
    await expect(showMenuButton).toBeVisible({ timeout: NAVBAR_OPEN_TIMEOUT_MS });
    await expect(showMenuButton).toBeEnabled();

    await Promise.all([
      waitForNavbarOpenedEvent(page),
      showMenuButton.click(),
    ]);
  }

  await expect(navbar).not.toHaveClass(/(?:^|\s)collapsed(?:\s|$)/);
  await expect(navbar).toBeInViewport({ ratio: 0.95, timeout: NAVBAR_OPEN_TIMEOUT_MS });
  await expect(showMenuButton).toHaveAttribute('aria-hidden', 'true');
  await expect(showMenuButton).not.toHaveClass(/(?:^|\s)menu-toggle-visible(?:\s|$)/);
}
