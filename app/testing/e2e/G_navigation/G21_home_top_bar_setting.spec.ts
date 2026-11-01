// G21_home_top_bar_setting.spec.ts
// Proves the site-wide Home top-bar decision and the administrator toggle.
// Uses response-only Home policy/settings writes, never the owner's stored settings.
// Finally restores the simulated policy; context teardown removes every interception.
import { test, expect } from '@playwright/test';
import { installHomePolicy, openHomeProbeDataset } from '../helpers/home-policy-fixture';
import { ensureNavbarVisible } from '../helpers/navbar';
import { expandAdminTreeFolder, openAdminTreeButton } from '../helpers/admin-navigation';

test('Home top-bar opt-in, phone exclusion and disabled admin toggle', async ({ page, context }, info) => {
  test.skip(info.project.name !== 'desktop-card', 'K549: own widths, one project is enough');
  const theme = 'light';
  test.setTimeout(120_000);
  await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
  await page.addInitScript(() => localStorage.setItem('chosen_language', 'fi'));
  const policy = await installHomePolicy(context, theme);
  const originalPolicy = { ...policy };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    for (const [show, width] of [[false, 1440], [false, 390], [true, 701], [true, 1440], [true, 390]] as const) {
      policy.enabled = true; policy.topBarHome = show;
      await page.setViewportSize({ width, height: 1000 });
      await openHomeProbeDataset(page, false);
      const parts = page.locator('#app_service_catalog_tab_parts_container');
      await expect(parts.locator('.top-nav-home-button')).toHaveCount(show && width > 700 ? 1 : 0);
      await expect(page.locator('#navbarFrontPage a')).toHaveAttribute('href', '/');
      if (width <= 700) {
        const columns = await parts.locator('.dataset-shared-topbar__inner').evaluate(element =>
          getComputedStyle(element).gridTemplateColumns.split(' ').map(Number.parseFloat));
        expect(columns[0]).toBeCloseTo(44, 1);
      } else {
        // Reconcile the same header in its compact placement, then check Home's own row.
        await parts.locator('.filterbar-inline-hero').evaluate(hero => {
          const scroller = hero.closest('.scrollable_content')!;
          const spacer = document.createElement('div'); spacer.style.height = '2200px';
          scroller.append(spacer); scroller.scrollTop = scroller.scrollHeight;
          scroller.dispatchEvent(new Event('scroll'));
        });
        await expect(parts).toHaveAttribute('data-shared-topbar-visible', 'true');
        await expect(parts.locator('.dataset-shared-topbar .top-nav-home-button')).toHaveCount(show ? 1 : 0);
      }
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
      await expect(page.locator('.front-page-top-row .top-nav-home-button')).toHaveCount(show && width > 700 ? 1 : 0);
      await expect(page.locator('#navbarFrontPage a')).toHaveAttribute('href', '/');
    }
    policy.enabled = false; policy.topBarHome = true;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openHomeProbeDataset(page, true);
    await expect(page.locator('.top-nav-home-button, #navbarFrontPage a')).toHaveCount(0);
    await ensureNavbarVisible(page);
    await expandAdminTreeFolder(page, 'site_settings');
    await openAdminTreeButton(page, 'front_page_settings');
    const form = page.locator('#front_page_settings_container .front-page-settings-view');
    const home = form.getByTestId('front-page-enabled');
    const top = form.getByTestId('front-page-top-bar-home');
    await expect(home).toBeEnabled();
    await expect(top).toBeDisabled();
    const label = top.locator('..');
    await expect(label).toContainText('Näytä Etusivu-painike yläpalkissa leveillä näytöillä');
    await expect(label).toHaveCSS('opacity', '0.55');
    expect(await home.evaluate(element => element.closest('label')!.nextElementSibling
      === document.querySelector('[data-testid="front-page-top-bar-home"]')!.closest('label'))).toBe(true);
    if (!/collapsed/.test(await page.locator('#navbar').getAttribute('class') || '')) {
      await page.locator('#hideMenuButton').click();
    }
    await home.check(); await expect(top).toBeEnabled();
    await top.uncheck();
    await form.getByTestId('front-page-settings-save').click();
    await expect.poll(() => policy.topBarHome).toBe(false);
    await expect(form).toHaveAttribute('aria-busy', 'false');
    await top.check();
    await form.getByTestId('front-page-settings-save').click();
    await expect.poll(() => policy.topBarHome).toBe(true);
    await expect(form).toHaveAttribute('aria-busy', 'false');
    expect(errors).toEqual([]);
  } finally {
    // Only the intercepted response state ever changes; no settings POST is
    // forwarded to the server, even if an assertion or the UI save fails.
    Object.assign(policy, originalPolicy);
  }
});
