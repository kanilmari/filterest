/**
 * M1_language_switch.spec.ts
 *
 * Verifies language selector flow and checks that active language value changes.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { waitForAppReady } from '../helpers/navigation';
import { ensureNavbarVisible } from '../helpers/navbar';

test.describe('M1 — Language Switch', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('language can be switched', async ({ page }) => {
    await waitForAppReady(page);
    await ensureNavbarVisible(page);

    const originalState = await page.evaluate(() => {
      const normalize = (value: string | null) => String(value || '').trim().toLowerCase().slice(0, 2);
      const checkedOption = document.querySelector<HTMLInputElement>(
        '[data-testid^="language-menu-option-"]:checked',
      );
      return {
        checkedLanguage: normalize(checkedOption?.value ?? null),
        htmlLanguage: normalize(document.documentElement.lang),
        storedLanguage: localStorage.getItem('chosen_language'),
      };
    });
    const originalLanguage =
      originalState.checkedLanguage ||
      String(originalState.storedLanguage || '').trim().toLowerCase().slice(0, 2) ||
      originalState.htmlLanguage;
    expect(['en', 'fi'], 'Language menu must start on a supported language').toContain(
      originalLanguage,
    );

    const alternateLanguage = originalLanguage === 'fi' ? 'en' : 'fi';
    const languageButton = page.locator('[data-testid="language-menu-button"]:visible').first();
    const languagePanel = page.locator('[data-testid="language-menu-panel"]').first();
    const alternateOption = languagePanel.locator(
      `[data-testid="language-menu-option-${alternateLanguage}"]`,
    );
    let languageWasSwitched = false;

    try {
      await expect(languageButton).toBeVisible({ timeout: 10000 });
      await languageButton.scrollIntoViewIfNeeded();
      await languageButton.click();
      await expect(languagePanel).toBeVisible();

      await expect(alternateOption).toBeVisible();
      await expect(alternateOption).toBeEnabled();
      await alternateOption.check();
      languageWasSwitched = true;

      await expect(alternateOption).toBeChecked();
      await expect(languagePanel).toBeHidden();
      await expect.poll(
        () => page.evaluate(() => localStorage.getItem('chosen_language')),
        { timeout: 5000 },
      ).toBe(alternateLanguage);
      await expect.poll(
        () => page.evaluate(() => document.documentElement.lang.toLowerCase().slice(0, 2)),
        { timeout: 5000 },
      ).toBe(alternateLanguage);
    } finally {
      if (languageWasSwitched && !page.isClosed()) {
        const restoreOption = languagePanel.locator(
          `[data-testid="language-menu-option-${originalLanguage}"]`,
        );
        if (!(await languagePanel.isVisible())) {
          await languageButton.click();
          await expect(languagePanel).toBeVisible();
        }

        await expect(restoreOption).toBeVisible();
        await restoreOption.check();
        await expect(restoreOption).toBeChecked();
        await expect(languagePanel).toBeHidden();
        await expect.poll(
          () => page.evaluate(() => document.documentElement.lang.toLowerCase().slice(0, 2)),
          { timeout: 5000 },
        ).toBe(originalLanguage);

        await page.evaluate((storedLanguage) => {
          if (storedLanguage === null) {
            localStorage.removeItem('chosen_language');
          } else {
            localStorage.setItem('chosen_language', storedLanguage);
          }
        }, originalState.storedLanguage);
        await expect.poll(
          () => page.evaluate(() => localStorage.getItem('chosen_language')),
          { timeout: 5000 },
        ).toBe(originalState.storedLanguage);
      }
    }
  });
});
