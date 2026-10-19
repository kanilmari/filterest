// G12_top_nav_home_button.spec.ts
// Proves Home placement, original bar visibility and live authoritative availability.
// Every Home/settings response is intercepted; no settings POST reaches any server.
// Before/after screenshots live under test-results; G11 proves menu → Home → dataset.
import { test, expect, type Page } from '@playwright/test';
import { installHomePolicy, openHomeProbeDataset, captureHomeProbe, probePhase } from '../helpers/home-policy-fixture';
import { ensureNavbarVisible } from '../helpers/navbar';
import { expandAdminTreeFolder, openAdminTreeButton } from '../helpers/admin-navigation';

async function menuState(page: Page) {
  return page.evaluate(() => ({ classes: document.getElementById('navbar')!.className,
    narrow: localStorage.getItem('navVisibleNarrow'), wide: localStorage.getItem('navVisibleWide') }));
}

for (const width of [1920, 1440, 1000]) for (const theme of ['light', 'dark'] as const) {
  test(`first larger Home and independent bar at ${width}px in ${theme}`, async ({ page, context }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    const policy = await installHomePolicy(context, theme);
    for (const menuOpen of [false, true]) {
      await openHomeProbeDataset(page, menuOpen);
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
      const parts = page.locator('#app_service_catalog_tab_parts_container');
      const hero = parts.locator('.filterbar-inline-hero');
      await expect(hero).toBeVisible();
      await expect(parts).toHaveAttribute('data-shared-topbar-visible', 'false');
      await expect(parts.locator('.dataset-shared-topbar')).toHaveAttribute('aria-hidden', 'true');
      await captureHomeProbe(page, info, `${width}-${theme}-${menuOpen ? 'open' : 'closed'}-hero`);
      if (probePhase === 'before') {
        await hero.evaluate(element => {
          const scroller = element.closest('.scrollable_content')!;
          const spacer = document.createElement('div');
          spacer.dataset.wo37Spacer = 'true'; spacer.style.height = '2000px';
          scroller.append(spacer); scroller.scrollTop = scroller.scrollHeight;
          scroller.dispatchEvent(new Event('scroll'));
        });
        try {
          await expect(parts).toHaveAttribute('data-shared-topbar-visible', 'true');
          await captureHomeProbe(page, info, `${width}-${theme}-${menuOpen ? 'open' : 'closed'}-scrolled`);
        } finally {
          await parts.evaluate(element => {
            const spacer = element.querySelector('[data-wo37-spacer]');
            const scroller = spacer?.closest('.scrollable_content');
            spacer?.remove(); if (scroller) scroller.scrollTop = 0;
            scroller?.dispatchEvent(new Event('scroll'));
          });
        }
        continue;
      }
      const home = hero.getByTestId('top-nav-home-button');
      await expect(home).toBeVisible();
      expect(await home.evaluate(el => el === el.parentElement!.firstElementChild)).toBe(true);
      const dataset = hero.locator('.hero-dataset-tabs__button[data-dataset]:visible').first();
      await expect(dataset).toBeVisible();
      await expect(home).toHaveCSS('height', '44px');
      await expect(home.locator('.navbar-front-page-icon')).toHaveCSS('width', '24px');
      await expect(home.locator('.navbar-front-page-icon')).toHaveCSS('height', '24px');
      const homeBox = (await home.boundingBox())!, datasetBox = (await dataset.boundingBox())!;
      expect(homeBox.x + homeBox.width).toBeLessThanOrEqual(datasetBox.x);
      expect(homeBox.y + homeBox.height / 2).toBeCloseTo(datasetBox.y + datasetBox.height / 2, 1);
      expect(await home.evaluate(element => getComputedStyle(element.parentElement!).flexWrap)).toBe('nowrap');
      await expect(home.locator('[data-symbol-key="home"]')).toHaveCount(1);
      await expect(home).toHaveAttribute('href', await page.locator('#navbarFrontPage a').getAttribute('href') || '/');
      // Move the original node with its keyboard focus, even when the menu is open.
      const node = await home.elementHandle();
      await home.focus();
      await hero.evaluate(element => {
        const scroller = element.closest('.scrollable_content')!;
        const spacer = document.createElement('div');
        spacer.dataset.wo37Spacer = 'true'; spacer.style.height = '2000px';
        scroller.append(spacer); scroller.scrollTop = scroller.scrollHeight;
        scroller.dispatchEvent(new Event('scroll'));
      });
      try {
        await expect(parts).toHaveAttribute('data-shared-topbar-visible', 'true');
        const compact = parts.locator('.dataset-shared-topbar .top-nav-home-button');
        await expect(compact).toBeVisible();
        await expect(compact).toBeFocused();
        expect(await node!.evaluate(el => el === document.activeElement)).toBe(true);
        await expect(parts.locator('.top-nav-home-button')).toHaveCount(1);
        await captureHomeProbe(page, info, `${width}-${theme}-${menuOpen ? 'open' : 'closed'}-scrolled`);
      } finally {
        await node?.dispose();
        await parts.evaluate(element => {
          const spacer = element.querySelector('[data-wo37-spacer]');
          const scroller = spacer?.closest('.scrollable_content');
          spacer?.remove(); if (scroller) scroller.scrollTop = 0;
          scroller?.dispatchEvent(new Event('scroll'));
        });
      }
      await expect(home).toBeVisible();
      const before = await menuState(page);
      await home.press('Enter');
      await expect(page).toHaveURL(/\/$/);
      await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
      expect(await menuState(page)).toEqual(before);
      await expect(page.locator('#front_page_container .top-nav-home-button')).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('#front_page_container .top-nav-home-button')).toHaveCSS('height', `${homeBox.height}px`);
    }
    policy.enabled = false;
    await openHomeProbeDataset(page, false);
    await expect(page.locator('.top-nav-home-button')).toHaveCount(0);
    await expect(page.locator('#navbarFrontPage a')).toHaveCount(0);
    await page.goto('/');
    await expect(page.locator('.front-page:visible')).toHaveCount(0);
    await expect(page.locator('.front-page-status')).toHaveCount(0);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`390px dataset keeps one larger Home in the existing compact bar in ${theme}`, async ({ page, context }, info) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    await installHomePolicy(context, theme);
    for (const menuOpen of [false, true]) {
      await openHomeProbeDataset(page, menuOpen);
      const parts = page.locator('#app_service_catalog_tab_parts_container');
      await expect(parts.locator('.filterbar-inline-hero .hero-dataset-tabs')).toBeHidden();
      await expect(parts.locator('.top-nav-home-button')).toHaveCount(1);
      const home = parts.locator('.dataset-shared-topbar__slot--end .top-nav-home-button');
      await expect(home).toBeVisible();
      await expect(home).toHaveCSS('width', '44px');
      await expect(home).toHaveCSS('height', '44px');
      await expect(home.locator('.navbar-front-page-icon')).toHaveCSS('width', '24px');
      const homeBox = (await home.boundingBox())!;
      const barBox = (await parts.locator('.dataset-shared-topbar__inner').boundingBox())!;
      expect(homeBox.x).toBeGreaterThanOrEqual(0);
      expect(homeBox.x + homeBox.width).toBeLessThanOrEqual(390);
      expect(homeBox.y).toBeGreaterThanOrEqual(barBox.y);
      expect(homeBox.y + homeBox.height).toBeLessThanOrEqual(barBox.y + barBox.height);
      await captureHomeProbe(page, info, `390-${theme}-${menuOpen ? 'open' : 'closed'}-compact`);
    }
  });
}

for (const width of [1440, 1000, 390]) {
  test(`simulated settings save removes cached Home in both tabs at ${width}px`, async ({ page, context }) => {
    test.skip(probePhase === 'before', 'Live policy regression is verified on the fixed version.');
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 1000 });
    const policy = await installHomePolicy(context);
    await openHomeProbeDataset(page, false);
    const timeOrigin = await page.evaluate(() => performance.timeOrigin);
    const cached = await page.locator('#app_service_catalog_tab_parts_container').elementHandle();
    const editor = await context.newPage();
    try {
      await openHomeProbeDataset(editor, true, 'card', false);
      await ensureNavbarVisible(editor);
      await expandAdminTreeFolder(editor, 'site_settings');
      await openAdminTreeButton(editor, 'front_page_settings');
      const form = editor.locator('#front_page_settings_container .front-page-settings-view');
      await expect(form.getByTestId('front-page-enabled')).toBeEnabled();
      if (!/collapsed/.test(await editor.locator('#navbar').getAttribute('class') || '')) {
        await editor.locator('#hideMenuButton').click();
      }
      await form.getByTestId('front-page-enabled').uncheck();
      await form.getByTestId('front-page-settings-save').click();
      await expect.poll(() => policy.enabled).toBe(false);
      await expect(form).toHaveAttribute('aria-busy', 'false');
      // The save's real localStorage write emits storage in the other page.
      // Dispatch it in the saving page too, proving both notification paths.
      await editor.evaluate(() => window.dispatchEvent(new StorageEvent('storage', {
        key: 'separate_front_page', newValue: 'false', storageArea: localStorage,
      })));
      for (const tab of [page, editor]) {
        await expect(tab.locator('.top-nav-home-button')).toHaveCount(0);
        await expect(tab.locator('#navbarFrontPage a')).toHaveCount(0);
      }
      expect(await cached!.evaluate(el => el === document.getElementById('app_service_catalog_tab_parts_container'))).toBe(true);
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
      await page.goto('/');
      await expect(page.locator('.content_div:visible')).toBeVisible();
      await expect(page.locator('.front-page:visible, .front-page-status')).toHaveCount(0);
    } finally { await cached?.dispose(); await editor.close(); }
  });
}

test('unavailable Home opens normal start without an error; other failures offer retry', async ({ page, context }, info) => {
  test.skip(probePhase === 'before', 'Disabled-response recovery is verified on the fixed version.');
  test.setTimeout(60_000);
  const policy = await installHomePolicy(context);
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const status of [500, 404]) {
    policy.enabled = true; policy.failure = status === 500 ? 500 : 0;
    await openHomeProbeDataset(page, false);
    const home = page.getByTestId('top-nav-home-button').filter({ visible: true });
    await expect(home).toHaveCount(1);
    if (status === 404) policy.enabled = false; // Stale client, current simulated server off.
    await home.click();
    if (status === 500) {
      await expect(page.locator('.front-page-status button')).toBeVisible();
    } else {
      await expect(page.locator('#app_service_catalog_container')).toBeVisible();
      await expect(page.locator('.top-nav-home-button, #navbarFrontPage a, .front-page-status')).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('separate_front_page'))).toBe('false');
    }
    await captureHomeProbe(page, info, `response-${status}`);
  }
});

// Retain G12's existing presentation coverage alongside the focused hero proof.
for (const width of [1440, 1000, 375]) for (const theme of ['light', 'dark'] as const) {
  test(`Home policy and menu memory across dataset presentations at ${width}px in ${theme}`, async ({ page, context }, info) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    const policy = await installHomePolicy(context, theme);
    for (const enabled of [true, false]) for (const view of ['card', 'table', 'article_view', 'image_first_view', 'normal', 'transposed']) {
      policy.enabled = enabled;
      for (const menuOpen of [false, true]) {
        await openHomeProbeDataset(page, menuOpen, view);
        await captureHomeProbe(page, info, `${width}-${theme}-${enabled ? 'on' : 'off'}-${view}-${menuOpen ? 'open' : 'closed'}`);
        if (probePhase === 'before') continue;
        const home = page.getByTestId('top-nav-home-button').filter({ visible: true });
        await expect(home).toHaveCount(enabled ? 1 : 0);
        if (!enabled) {
          await expect(page.locator('#navbarFrontPage a')).toHaveCount(0);
          continue;
        }
        await expect(home).toHaveAccessibleName(/\S/);
        expect(await home.getAttribute('href')).toBe(await page.locator('#navbarFrontPage a').getAttribute('href'));
        const before = await menuState(page);
        // Keyboard activation does not trigger the menu's outside-pointer policy.
        await home.focus(); await home.press('Enter');
        await expect(page).toHaveURL(/\/$/);
        await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
        expect(await menuState(page)).toEqual(before);
        await expect(page.getByTestId('top-nav-home-button').filter({ visible: true })).toHaveCount(1);
      }
    }
  });
}
