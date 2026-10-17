// J4_client_error_notices.spec.ts
// Proves browser-injected errors stay in the console and app errors show notices.
// Connects real runtime handlers, identity, translation and theme on every viewport.
// Test-only intercepted modules throw asynchronously; no server hook or data is created.
import { test, expect } from '@playwright/test';
import { login, loadCredentials, loadUserCredentials } from '../helpers/auth';

const foreignMarker = 'WO35 browser wallet injection';
const ownMarker = 'WO35 own module failure';
const modulePath = '/frontend/wo35-error-probe.js';

for (const identity of ['visitor', 'user', 'admin'] as const) {
  test.describe(`WO35 ${identity}`, () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    for (const theme of ['light', 'dark'] as const) {
      for (const language of ['fi', 'en'] as const) {
        test(`${theme} ${language}: console for injection, toast for own module`, async ({ page }, testInfo) => {
          test.setTimeout(60_000);
          const consoleErrors: string[] = [];
          page.on('console', message => {
            if (message.type() === 'error') consoleErrors.push(message.text());
          });
          // Keep preferences isolated from the reserved accounts' saved theme.
          await page.route('**/api/user-visual-preference', route => route.fulfill({
            json: { theme_mode: theme, revision: 1, configured: true },
          }));
          await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
          await page.addInitScript(({ theme, foreignMarker, language }) => {
            localStorage.setItem('theme', theme);
            localStorage.setItem('chosen_language', language);
            // Wait for this document's permission bootstrap, not a previous
            // login page's cached grants, before triggering the proof.
            sessionStorage.removeItem('user_permissions');
            // Init scripts bypass CSP, just as browser injections do. Delay the
            // throw until the real monitor is installed; no inline tag is added.
            window.addEventListener('wo35-inject', () => {
              setTimeout(() => { throw new Error(foreignMarker); }, 0);
            });
          }, { theme, foreignMarker, language });

          if (identity !== 'visitor') {
            await login(page, identity === 'admin' ? loadCredentials() : loadUserCredentials());
          }
          await page.goto('/', { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => typeof (window as Window & { __resetSession?: unknown }).__resetSession === 'function');
          await page.waitForFunction(() => sessionStorage.getItem('user_permissions') !== null);
          if (identity === 'admin') {
            await page.waitForFunction(() => localStorage.getItem('button_state') === 'logout'
              && JSON.parse(sessionStorage.getItem('user_permissions') || '[]')
                .includes('/api/admin/version-info'));
          }
          await expect(page.locator('body')).toHaveClass(new RegExp(`${theme}-mode`));
          await expect(page.locator('html')).toHaveAttribute('lang', language);

          // Remove unrelated startup notices; the probe must create none of its own.
          await page.locator('[data-testid="toast"] .toast-notification-close').evaluateAll(buttons =>
            buttons.forEach(button => (button as HTMLButtonElement).click()));
          await expect(page.locator('[data-testid="toast"]')).toHaveCount(0);
          await page.evaluate(() => window.dispatchEvent(new Event('wo35-inject')));
          await expect.poll(() => consoleErrors.some(text => text.includes('[JS]') && text.includes(foreignMarker))).toBe(true);
          await expect(page.locator('[data-testid="toast"]')).toHaveCount(0);

          // Route fulfillment serves a real module at an app-owned URL. Each
          // mode throws outside evaluate(), exercising native browser events.
          await page.route(`**${modulePath}*`, route => route.fulfill({
            contentType: 'text/javascript',
            body: `const message = ${JSON.stringify(ownMarker + ' https://example.invalid/module.js?private=value ' + 'x'.repeat(300))};
              if (new URL(import.meta.url).searchParams.get('mode') === 'promise') Promise.reject(new Error(message));
              else setTimeout(() => { throw new TypeError(message); }, 0);`,
          }));
          for (const mode of ['error', 'promise']) {
            await page.evaluate(async path => { await import(path); }, `${modulePath}?mode=${mode}`);
            const notice = page.locator('[data-testid="toast"]').filter({ hasText: identity === 'admin' ? ownMarker
              : language === 'fi' ? 'Sovelluksessa tapahtui virhe.' : 'The application ran into an error.' });
            await expect(notice).toBeVisible();
            const text = await notice.locator('.toast-notification-text').textContent() || '';
            if (identity === 'admin') {
              expect(text.length).toBeLessThanOrEqual(240);
              expect(text).not.toMatch(/https?:|example\.invalid|[?#]|private=value/);
            } else {
              expect(text).not.toContain(ownMarker);
              await expect(notice.locator('[data-lang-key="client_error_notice"]')).toBeVisible();
            }
            const bounds = await notice.boundingBox();
            expect(bounds).not.toBeNull();
            expect(bounds!.x).toBeGreaterThanOrEqual(0);
            expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
            // Past the old rejection timeout: own errors require manual dismissal.
            await page.waitForTimeout(8000);
            await expect(notice).toBeVisible();
            await notice.screenshot({ path: testInfo.outputPath(`${identity}-${theme}-${language}-${mode}.png`) });
            await notice.locator('.toast-notification-close').click();
            await expect(notice).toHaveCount(0);
          }
          // Routes and browser storage die with this per-test context; no temp
          // datasets, accounts, language keys or preference writes need cleanup.
        });
      }
    }
  });
}
