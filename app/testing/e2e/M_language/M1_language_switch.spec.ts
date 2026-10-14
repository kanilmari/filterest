// M1_language_switch.spec.ts
// Proves language switching and deterministic bottom-of-screen menu placement.
// Connects real menu interactions to pinned viewport geometry in both application themes.
// Restores language and local fixtures without depending on Home's dataset count.

import { test, expect, type Locator, type Page } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { waitForAppReady } from '../helpers/navigation';
import { ensureNavbarVisible } from '../helpers/navbar';

type BarStyle = Array<{ name: string; value: string; priority: string }>;

async function pinBottomMenuBar(page: Page): Promise<BarStyle> {
  return page.locator('#navbar').evaluate(navbar => {
    const bar = navbar as HTMLElement;
    const pinned = { top: 'calc(100vh - 120px)', bottom: '0px', height: '120px', left: '0px' };
    const saved = Object.keys(pinned).map(name => ({
      name, value: bar.style.getPropertyValue(name), priority: bar.style.getPropertyPriority(name),
    }));
    for (const [name, value] of Object.entries(pinned)) bar.style.setProperty(name, value);
    // Force a long scrolling bar even if this installation has no Home dataset buttons.
    const spacer = document.createElement('div');
    spacer.dataset.languageGeometryFixture = 'true';
    spacer.style.height = '1000px';
    bar.appendChild(spacer);
    bar.scrollTop = 0;
    return saved;
  });
}

async function expectOptionsInsideViewport(panel: Locator): Promise<void> {
  await expect.poll(() => panel.evaluate(element => {
    const inside = (rect: DOMRect) => rect.width > 0 && rect.height > 0
      && rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
    const options = Array.from(element.querySelectorAll('.language-option'));
    return inside(element.getBoundingClientRect()) && options.length > 0 && options.every(option => {
      const rect = option.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return inside(rect) && hit !== null && option.contains(hit);
    });
  }), { message: 'The whole panel and every option must be inside the viewport and free of ancestor clipping' }).toBe(true);
}

async function chooseLowerOptionOnShortScreen(page: Page, button: Locator, panel: Locator, width: number): Promise<void> {
  // Start on the upper language so clicking the lower radio must perform a real change,
  // regardless of the account's initial language or the catalogue's language order.
  const upperRadio = panel.locator('.language-option input').first();
  const upperLanguage = await upperRadio.inputValue();
  if (!(await upperRadio.isChecked())) {
    await upperRadio.click();
    await expect(upperRadio).toBeChecked();
    await expect(panel).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.documentElement.lang.slice(0, 2))).toBe(upperLanguage);
    await button.click();
    await expect(panel).toBeVisible();
  }
  await page.setViewportSize({ width, height: 260 });
  await expect.poll(() => panel.evaluate(element => element.scrollHeight > element.clientHeight
    && getComputedStyle(element).overflowY === 'auto')).toBe(true);
  const lowerOption = panel.locator('.language-option').last();
  const lowerRadio = lowerOption.locator('input');
  const lowerLanguage = await lowerRadio.inputValue();
  expect(lowerLanguage).not.toBe(upperLanguage);
  const scrollTop = await panel.evaluate(element => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  expect(scrollTop).toBeGreaterThan(0);
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  let stableReadings = 0;
  await expect.poll(async () => {
    const reachable = await lowerOption.evaluate((option, expectedScrollTop) => {
      const menu = option.closest<HTMLElement>('[data-testid="language-menu-panel"]')!;
      const rect = option.getBoundingClientRect();
      const bounds = menu.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return menu.scrollTop === expectedScrollTop && rect.width > 0 && rect.height > 0
        && rect.top >= bounds.top && rect.bottom <= bounds.bottom
        && rect.left >= bounds.left && rect.right <= bounds.right
        && bounds.top >= 0 && bounds.bottom <= window.innerHeight
        && bounds.left >= 0 && bounds.right <= window.innerWidth
        && hit !== null && option.contains(hit);
    }, scrollTop);
    stableReadings = reachable ? stableReadings + 1 : 0;
    return stableReadings;
  }, { intervals: [50], message: 'The lower option must stay reachable after queued frames and scrolling' }).toBe(3);
  await lowerRadio.click();
  await expect(lowerRadio).toBeChecked();
  await expect(panel).toBeHidden();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('chosen_language'))).toBe(lowerLanguage);
  await expect.poll(() => page.evaluate(() => document.documentElement.lang.slice(0, 2))).toBe(lowerLanguage);
}

test.describe('M1 — Language Switch', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  for (const scenario of [
    { name: 'language can be switched', theme: null },
    { name: 'language menu fits a pinned bottom menu bar in light mode over OS dark', theme: 'light' },
    { name: 'language menu fits a pinned bottom menu bar in dark mode', theme: 'dark' },
  ] as const) {
    test(scenario.name, async ({ page }) => {
      if (scenario.theme) {
        // Fixture the account's theme read; changing this page never saves an account preference.
        await page.route(url => url.pathname === '/api/user-visual-preference', route => {
          if (route.request().method() !== 'GET') return route.continue();
          return route.fulfill({ json: { theme_mode: scenario.theme, revision: 1, configured: true } });
        });
        await page.emulateMedia({ colorScheme: 'dark' });
      }
      await login(page, credentials);
      await waitForAppReady(page);
      await ensureNavbarVisible(page);

      const originalViewport = page.viewportSize();
      let barStyle: BarStyle | null = null;

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
      const panelId = await languageButton.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();
      const languagePanel = page.locator(`[id="${panelId}"]`);
      const alternateOption = languagePanel.locator(
        `[data-testid="language-menu-option-${alternateLanguage}"]`,
      );
      const originalOption = languagePanel.locator(`[data-testid="language-menu-option-${originalLanguage}"]`);
      let languageWasSwitched = false;
      let primaryFailure: unknown;

      try {
        if (scenario.theme) {
          await expect(page.locator('body')).toHaveClass(new RegExp(`(?:^|\\s)${scenario.theme}-mode(?:\\s|$)`));
          expect(originalViewport).not.toBeNull();
          barStyle = await pinBottomMenuBar(page);
        }
        await expect(languageButton).toBeVisible();
        await languageButton.scrollIntoViewIfNeeded();
        await languageButton.click();
        await expect(languagePanel).toBeVisible();

        if (scenario.theme) {
          // Resize with the panel already open: the selector has at most 120 px below it,
          // and all options fit above. No installed datasets or page text influence this case.
          await page.setViewportSize({ width: originalViewport!.width, height: 400 });
          await expect.poll(() => page.locator('#navbar').evaluate(bar => {
            const rect = bar.getBoundingClientRect();
            return Math.abs(rect.bottom - window.innerHeight) < 1 && rect.height === 120
              && bar.scrollHeight > bar.clientHeight && getComputedStyle(bar).overflowY === 'auto';
          })).toBe(true);
          const selectorRect = await languageButton.evaluate(button => button.parentElement!.getBoundingClientRect().toJSON());
          expect(selectorRect.top).toBeGreaterThan(270);
          expect(400 - selectorRect.bottom).toBeLessThan(120);
          await expectOptionsInsideViewport(languagePanel);
          expect(await languagePanel.evaluate(panel => panel.closest('#navbar') === null)).toBe(true);
          expect(await languagePanel.evaluate(panel => panel.getBoundingClientRect().bottom)).toBeLessThanOrEqual(selectorRect.top);

          // Neither side fits on this shorter screen; only the menu scrolls to reveal an option.
          await page.setViewportSize({ width: originalViewport!.width, height: 260 });
          await expect.poll(() => languagePanel.evaluate(panel => {
            const rect = panel.getBoundingClientRect();
            return panel.scrollHeight > panel.clientHeight && getComputedStyle(panel).overflowY === 'auto'
              && rect.top >= 0 && rect.bottom <= window.innerHeight;
          })).toBe(true);
          await languageButton.focus();
          await languageButton.press('Tab');
          await expect(originalOption).toBeFocused();
          expect(await originalOption.evaluate(option => {
            const rect = option.getBoundingClientRect();
            const panel = option.closest('[data-testid="language-menu-panel"]')!.getBoundingClientRect();
            return rect.top >= panel.top && rect.bottom <= panel.bottom;
          })).toBe(true);
          await alternateOption.scrollIntoViewIfNeeded();
          expect(await alternateOption.evaluate(option => {
            const rect = option.getBoundingClientRect();
            const panel = option.closest('[data-testid="language-menu-panel"]')!.getBoundingClientRect();
            return rect.top >= panel.top && rect.bottom <= panel.bottom && rect.bottom <= window.innerHeight;
          })).toBe(true);
          await page.setViewportSize({ width: originalViewport!.width, height: 400 });
          await expectOptionsInsideViewport(languagePanel);

          await languageButton.focus();
          await languageButton.press('Tab');
          await expect(originalOption).toBeFocused();
          await originalOption.press('Escape');
          await expect(languagePanel).toBeHidden();
          await expect(languageButton).toBeFocused();
          await expect(languageButton).toHaveAttribute('aria-expanded', 'false');
          await languageButton.press('Enter');
          await expect(languagePanel).toBeVisible();
          await languageButton.press('Tab');
          await expect(originalOption).toBeFocused();
          const values = await languagePanel.locator('input[type="radio"]').evaluateAll(options =>
            options.map(option => (option as HTMLInputElement).value));
          expect(values).toHaveLength(2);
          languageWasSwitched = true; // Restore even if the following assertion fails after the native change.
          await originalOption.press(values.indexOf(alternateLanguage) > values.indexOf(originalLanguage) ? 'ArrowRight' : 'ArrowLeft');
        } else {
          await expect(alternateOption).toBeVisible();
          await expect(alternateOption).toBeEnabled();
          languageWasSwitched = true;
          await alternateOption.check();
        }

        await expect(alternateOption).toBeChecked();
        await expect(languagePanel).toBeHidden();
        await expect.poll(
          () => page.evaluate(() => localStorage.getItem('chosen_language')),
        ).toBe(alternateLanguage);
        await expect.poll(
          () => page.evaluate(() => document.documentElement.lang.toLowerCase().slice(0, 2)),
        ).toBe(alternateLanguage);
        // A portalled option is still inside the menu: switching must not slide the bar away.
        await expect(page.locator('#navbar')).not.toHaveClass(/(?:^|\s)collapsed(?:\s|$)/);
        await languageButton.click();
        await expect(languagePanel).toBeVisible();
        await expectOptionsInsideViewport(languagePanel);
        if (scenario.theme) {
          await chooseLowerOptionOnShortScreen(page, languageButton, languagePanel, originalViewport!.width);
          await page.setViewportSize({ width: originalViewport!.width, height: 400 });
          await languageButton.click();
          await expect(languagePanel).toBeVisible();
          await expectOptionsInsideViewport(languagePanel);
        }
        await languageButton.click();
        await expect(languagePanel).toBeHidden();
      } catch (error) {
        primaryFailure = error;
        throw error;
      } finally {
        try {
          if (languageWasSwitched && !page.isClosed()) {
            // Re-establish the bar through its real opener and resolve the current selector,
            // including when translation or view refresh has replaced its DOM nodes.
            // An earlier capped-height assertion may have left the fixture at 260 px.
            if (barStyle) await page.setViewportSize({ width: originalViewport!.width, height: 400 });
            await ensureNavbarVisible(page);
            const restoreButton = page.locator('#navbar [data-testid="language-menu-button"]');
            const restorePanelId = await restoreButton.getAttribute('aria-controls');
            expect(restorePanelId).toBeTruthy();
            const restorePanel = page.locator(`[id="${restorePanelId}"]`);
            const restoreOption = restorePanel.locator(
              `[data-testid="language-menu-option-${originalLanguage}"]`,
            );
            if (!(await restorePanel.isVisible())) {
              await restoreButton.click();
              await expect(restorePanel).toBeVisible();
            }

            await expectOptionsInsideViewport(restorePanel);
            await expect(restoreOption).toBeVisible();
            if (await restoreOption.isChecked()) await restoreButton.click();
            else await restoreOption.check();
            await expect(restoreOption).toBeChecked();
            await expect(restorePanel).toBeHidden();
            await expect.poll(
              () => page.evaluate(() => document.documentElement.lang.toLowerCase().slice(0, 2)),
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
            ).toBe(originalState.storedLanguage);
          }
        } catch (error) {
          if (primaryFailure === undefined) {
            primaryFailure = error;
            throw error;
          }
          // Keep the first switch/geometry assertion in the report if restoration also fails.
          await test.info().attach('language-menu-restore-failure', {
            body: String(error), contentType: 'text/plain',
          });
        } finally {
          try {
            if (!page.isClosed() && barStyle) {
              await page.locator('#navbar').evaluate((navbar, saved) => {
                const bar = navbar as HTMLElement;
                bar.querySelector('[data-language-geometry-fixture]')?.remove();
                for (const { name, value, priority } of saved) {
                  if (value) bar.style.setProperty(name, value, priority);
                  else bar.style.removeProperty(name);
                }
              }, barStyle);
              await page.setViewportSize(originalViewport!);
            }
          } catch (error) {
            if (primaryFailure === undefined) throw error;
            await test.info().attach('language-menu-fixture-restore-failure', {
              body: String(error), contentType: 'text/plain',
            });
          }
        }
      }
    });
  }
});
