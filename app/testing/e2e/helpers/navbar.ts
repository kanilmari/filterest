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
 * Home and datasets both leave the open-state control inside the navbar.
 */
export async function ensureNavbarVisible(page: Page): Promise<void> {
  const navbar = page.locator('#navbar');
  const showMenuButton = page.locator('#showMenuButton');
  // When the shared top bar renders its own menu button, #showMenuButton stays as its hidden source
  // (shared-topbar-menu-source-hidden), so open through whichever real button is visible.
  const visibleMenuButton = page.locator('[data-navbar-menu-button="true"]:visible, #showMenuButton:visible').first();
  await expect(navbar).toHaveCount(1);

  const navbarClasses = await navbar.getAttribute('class');
  if (String(navbarClasses || '').split(/\s+/).includes('collapsed')) {
    await expect(visibleMenuButton).toBeVisible({ timeout: NAVBAR_OPEN_TIMEOUT_MS });
    await expect(visibleMenuButton).toBeEnabled();

    await Promise.all([
      waitForNavbarOpenedEvent(page),
      visibleMenuButton.click(),
    ]);
  }

  await expect(navbar).not.toHaveClass(/(?:^|\s)collapsed(?:\s|$)/);
  await expect(navbar).toBeInViewport({ ratio: 0.95, timeout: NAVBAR_OPEN_TIMEOUT_MS });
  if (await page.locator('.front-page-top-row').count()) {
    // Owner 14.10.2026: an open Home hides its borrowed slot without an identity gap.
    await expect(page.locator('.front-page-top-row #showMenuButton')).toHaveCount(1);
    const slot = page.locator('.front-page-top-row .dataset-shared-topbar__menu-slot');
    await expect(slot).toBeHidden();
    await expect(slot).toHaveAttribute('aria-hidden', 'true');
    await expect(slot).toHaveJSProperty('inert', true);
  }
  await expect(showMenuButton).toBeHidden();
  await expect(showMenuButton).toHaveAttribute('aria-hidden', 'true');
  await expect(showMenuButton).toHaveAttribute('tabindex', '-1');
  await expect(showMenuButton).not.toHaveClass(/(?:^|\s)menu-toggle-visible(?:\s|$)/);
  const close = page.locator('#hideMenuButton');
  await expect(close).toBeVisible();
  await expect(close).toHaveAttribute('aria-hidden', 'false');
  await expect(close).toHaveAttribute('aria-expanded', 'true');
  await expect(close).toHaveAttribute('tabindex', '0');
  await expect(close).toBeEnabled();
  // Check stability and pointer access without changing the panel state.
  await close.click({ trial: true });
}
