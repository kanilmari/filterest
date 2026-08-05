/**
 * L4_forced_login_page.spec.ts
 *
 * Verifies the forced-login landing page when login_to_browse=true.
 * Skips in environments where guest browsing is still allowed.
 */

import { test, expect } from '@playwright/test';

test.describe('L4 — Forced Login Landing', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  async function expectHeaderRowAlignment(page: import('@playwright/test').Page) {
    const tablist = page.locator('[data-testid="login-page-tablist"]');
    const controls = page.locator('[data-testid="login-page-controls"]');

    await expect(tablist).toBeVisible();
    await expect(controls).toBeVisible();

    const metrics = await page.evaluate(() => {
      const tablistRect = document.querySelector('[data-testid="login-page-tablist"]')?.getBoundingClientRect();
      const controlsRect = document.querySelector('[data-testid="login-page-controls"]')?.getBoundingClientRect();

      if (!tablistRect || !controlsRect) {
        return null;
      }

      const tablistCenterY = tablistRect.top + tablistRect.height / 2;
      const controlsCenterY = controlsRect.top + controlsRect.height / 2;

      return {
        centerDelta: Math.abs(tablistCenterY - controlsCenterY),
      };
    });

    expect(metrics).not.toBeNull();
    expect(metrics!.centerDelta).toBeLessThan(8);
  }

  test('renders the standalone Login/Tour page instead of the SPA modal shell', async ({ page, request }) => {
    const authModesResponse = await request.get('/api/auth-modes', {
      headers: {
        'X-Bypass-Ratelimit': 'test-mode',
      },
    });

    const authModes = await authModesResponse.json();
    test.skip(!authModes?.login_required_for_browse, 'Forced-login landing page is only expected when login_to_browse=true.');

    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('[data-testid="login-page-shell"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-theme-toggle"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-language-selection"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-page-tab-login"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="login-form"]')).toBeVisible();

    await page.locator('[data-testid="login-page-tab-tour"]').click();

    await expect(page.locator('[data-testid="login-page-tab-tour"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-testid="login-page-panel-tour"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-tour-gallery"]')).toBeVisible();
    await expect(page.locator('[data-testid^="login-tour-shot-"]')).toHaveCount(5);
    await expect(page.locator('[data-testid="login-form"]')).toBeHidden();
  });

  test('keeps tabs and controls aligned on the same header row in desktop and mobile views', async ({ page, request }) => {
    const authModesResponse = await request.get('/api/auth-modes', {
      headers: {
        'X-Bypass-Ratelimit': 'test-mode',
      },
    });

    const authModes = await authModesResponse.json();
    test.skip(!authModes?.login_required_for_browse, 'Forced-login landing page is only expected when login_to_browse=true.');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expectHeaderRowAlignment(page);

    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expectHeaderRowAlignment(page);
  });

  async function mountStandaloneLoginFixture(page: import('@playwright/test').Page) {
    await page.setContent(`
      <!doctype html>
      <html>
        <body class="login-page standalone-login-page">
          <div class="auth-page-shell" data-testid="login-page-shell">
            <div class="auth-page-content-card">
              <div class="auth-page-header-row" data-testid="login-page-header-row">
                <div class="auth-page-tablist" role="tablist" data-testid="login-page-tablist">
                  <button type="button" class="auth-page-tab is-active" aria-selected="true">Login</button>
                  <button type="button" class="auth-page-tab" aria-selected="false">Tour</button>
                </div>
                <div class="auth-top-controls" data-testid="login-page-controls">
                  <button type="button" id="themeToggleBtn" class="button auth-toolbar-button"></button>
                  <div class="language-selection menu-language-selection auth-language-selection">
                    <button type="button" class="language-button">EN</button>
                  </div>
                </div>
              </div>
              <section class="auth-page-tab-panel auth-page-login-panel">
                <div class="auth-login-stack">
                  <div class="auth-hero">
                    <h1 class="site_name">filterest.com</h1>
                    <div class="auth-intro-box">
                      <p>Welcome to <strong>filterest.com</strong>. Sign in to continue to this multilingual workspace.</p>
                    </div>
                  </div>
                  <form method="POST" action="/api/login" class="auth-form form_with_border" data-testid="login-form">
                    <h2>Login</h2>
                    <label for="username">Username or email</label>
                    <input type="text" id="username" name="username" data-testid="login-username">
                    <label for="password">Password</label>
                    <div class="password-wrapper">
                      <input type="password" id="password" name="password" data-testid="login-password">
                      <button type="button" id="toggle-password" aria-label="Show password"></button>
                    </div>
                    <div class="auth-secondary-actions">
                      <a href="#">Forgot password?</a>
                    </div>
                    <div class="privacy-notice-link">
                      <input type="checkbox" id="privacy-accept">
                      <label for="privacy-accept">In order to login, you must accept our privacy notice.</label>
                    </div>
                    <div id="submit">
                      <input type="submit" value="Login">
                    </div>
                  </form>
                </div>
              </section>
            </div>
          </div>
        </body>
      </html>
    `);
    await page.addStyleTag({ path: 'frontend/styles/variables.css' });
    await page.addStyleTag({ path: 'frontend/styles/base.css' });
    await page.addStyleTag({ path: 'frontend/styles/form.css' });
    await page.addStyleTag({ path: 'frontend/core_components/lang/lang_panel.css' });
    await page.addStyleTag({ path: 'frontend/core_components/auth/auth.css' });
  }

  async function expectTablistShellRemoved(page: import('@playwright/test').Page) {
    await expect(page.locator('[data-testid="login-page-shell"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-page-tablist"]')).toBeVisible();
    const metrics = await page.evaluate(() => {
      const rectFor = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) {
          return null;
        }
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          width: rect.width,
        };
      };

      const tablist = document.querySelector('[data-testid="login-page-tablist"]');
      const tablistStyle = tablist ? getComputedStyle(tablist) : null;
      const tabs = Array.from(document.querySelectorAll('.auth-page-tab')).map((tab) => {
        const rect = tab.getBoundingClientRect();
        return { top: rect.top, height: rect.height };
      });

      return {
        viewportWidth: window.innerWidth,
        tablist: rectFor('[data-testid="login-page-tablist"]'),
        form: rectFor('[data-testid="login-form"]'),
        username: rectFor('[data-testid="login-username"]'),
        password: rectFor('[data-testid="login-password"]'),
        tablistBackground: tablistStyle?.backgroundColor ?? null,
        tablistBorderTopWidth: tablistStyle?.borderTopWidth ?? null,
        tabs,
      };
    });

    expect(metrics.tablist).not.toBeNull();
    expect(metrics.tablistBackground).toBe('rgba(0, 0, 0, 0)');
    expect(metrics.tablistBorderTopWidth).toBe('0px');
    expect(metrics.tabs[1].top).toBeGreaterThan(metrics.tabs[0].top + 4);

    expect(metrics.tablist!.left).toBeGreaterThanOrEqual(0);
    expect(metrics.tablist!.right).toBeLessThanOrEqual(metrics.viewportWidth + 0.5);
    return metrics;
  }

  test('removes the standalone Login/Tour shell when tabs wrap', async ({ page }) => {
    await page.setViewportSize({ width: 472, height: 720 });
    await mountStandaloneLoginFixture(page);

    await expectTablistShellRemoved(page);
  });

  test('keeps the standalone login form usable below 420px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await mountStandaloneLoginFixture(page);

    await expect(page.locator('[data-testid="login-form"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-username"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-password"]')).toBeVisible();

    const metrics = await expectTablistShellRemoved(page);

    expect(metrics.form!.width).toBeGreaterThanOrEqual(metrics.viewportWidth - 24);

    for (const input of [metrics.username!, metrics.password!]) {
      expect(input.left).toBeGreaterThanOrEqual(metrics.form!.left + 14);
      expect(input.right).toBeLessThanOrEqual(metrics.form!.right - 14);
      expect(input.width).toBeGreaterThanOrEqual(metrics.form!.width - 40);
    }
  });
});
