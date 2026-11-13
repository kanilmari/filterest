// G14_home_menu_parity.spec.ts
// Compares native Home with the existing service catalogue, in both menu states.
// Home policy and appearance use response-only fixtures; no settings are saved.
// Measures each menu against the bar that owns its controls and checks the shared outside-click rule.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { installHomePolicy } from '../helpers/home-policy-fixture';
import { closeActiveFilterbarIfOpen, waitForActiveFilterbarLayout } from '../helpers/filterbar';

const DATASET = process.env.FILTEREST_E2E_TOPBAR_DATASET || 'app_service_catalog';
const FILTER_CONTROL = '[data-testid="filterbar-toggle"]:visible, .hide_filter_bar_button:visible, .show_filter_bar_button:visible';
const MENU_CONTROL = '#hideMenuButton:visible, #showMenuButton:visible, [data-navbar-menu-button="true"]:visible';
// The shell's own best-effort background POSTs on every page load (browser identity, OID refresh, translation
// discovery, client-error logging). They are blocked like any mutation but are not attempts by this test.
const SHELL_BACKGROUND_POSTS = new Set(['/api/check-fingerprint', '/api/update-oids', '/api/generateTranslations', '/api/log-client-error']);

async function setMenu(page: Page, open: boolean) {
  const navbar = page.locator('#navbar');
  if (/\bcollapsed\b/.test(await navbar.getAttribute('class') || '') === open) {
    await page.locator(MENU_CONTROL).click();
  }
  await expect(navbar).toHaveClass(open ? /^(?!.*\bcollapsed\b)/ : /\bcollapsed\b/);
  await expect.poll(() => navbar.evaluate((element, open) => {
    const box = element.getBoundingClientRect();
    return open ? Math.abs(box.left) <= 1 : box.right <= 1;
  }, open)).toBe(true);
}

async function expectBarControl(
  bar: Locator, selector: string, edge: 'left' | 'right', phoneCell: boolean, expanded: boolean,
) {
  const button = bar.locator(selector);
  await expect(button).toHaveAttribute('aria-hidden', 'false');
  await expect(button).toHaveAttribute('aria-expanded', String(expanded));
  await expect(button).toHaveAttribute('tabindex', '0');
  await expect(button).toHaveAccessibleName(/\S/);
  const inset = phoneCell ? 0 : 12;
  await expect.poll(() => bar.evaluate((bar, { selector, edge }) => {
    const button = bar.querySelector(selector)!;
    const row = bar.getBoundingClientRect(), box = button.getBoundingClientRect();
    return {
      edgeInset: Math.round(edge === 'left' ? box.left - row.left : row.right - box.right),
      topInset: Math.round(box.top - row.top), width: Math.round(box.width), height: Math.round(box.height),
      hit: button.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)),
    };
  }, { selector, edge }), { message: `${selector} occupies the ${edge} corner of its own bar and receives the centre hit` })
    .toEqual({ edgeInset: inset, topInset: inset, width: phoneCell ? 52 : 44, height: phoneCell ? 47 : 44, hit: true });
}

async function menuGeometry(page: Page, surface: 'home' | 'dataset', open: boolean) {
  const viewport = page.viewportSize()!;
  const navbar = page.locator('#navbar');
  await expect(page.locator(MENU_CONTROL)).toHaveCount(1);
  await expect(page.locator(FILTER_CONTROL)).toHaveCount(surface === 'dataset' ? 1 : 0);
  const phone = viewport.width <= 700;
  const homeBar = open ? '#navbar > .top-button-bar' : phone ? '.front-page-phone-topbar' : '.front-page > .front-page-top-row';
  const bar = surface === 'home' ? page.locator(homeBar)
    : page.locator(`[id="${DATASET}_tab_parts_container"] .dataset-shared-topbar:visible`);
  const menu = surface === 'dataset' ? '[data-testid="shared-topbar-menu-button"]' : open ? '#hideMenuButton' : '#showMenuButton';
  await expect(bar).toBeVisible();
  await expectBarControl(bar, menu, 'left', phone && (surface === 'dataset' || !open), open);
  await expect(bar.locator(menu)).toHaveAttribute('aria-controls', 'navbar');
  await expect(bar.locator(menu)).toHaveCSS('box-shadow', 'none');
  const row = (await bar.boundingBox())!;
  const drawer = await navbar.evaluate(element => {
    const box = element.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom };
  });
  // Home keeps its full-height overlay. Only an open dataset drawer yields the toolbar's space.
  expect(drawer.top).toBeCloseTo(surface === 'dataset' && open ? row.y + row.height : 0, 0);
  expect(drawer.bottom).toBeCloseTo(viewport.height, 0);
  expect(row.x).toBeCloseTo(0, 0);
  expect(row.y).toBeCloseTo(0, 0);
  if (surface === 'home' && !phone) {
    const homeRow = (await page.locator('.front-page > .front-page-top-row').boundingBox())!;
    const controls = (await navbar.locator(':scope > .top-button-bar').boundingBox())!;
    expect(homeRow.height).toBeCloseTo(controls.height, 0);
    expect(homeRow.y + homeRow.height).toBeCloseTo(controls.y + controls.height, 0);
  }
  if (surface === 'dataset') {
    await expectBarControl(bar, '[data-testid="filterbar-toggle"]', 'right', phone, false);
    expect(row.height).toBeCloseTo(phone ? 48 : 70, 0);
  }
  if (open) {
    // Overlay menus leave the content host at its full viewport width.
    const content = (await page.locator('#tabs_container').boundingBox())!;
    expect(content.x).toBeCloseTo(0, 0);
    expect(content.width).toBeCloseTo(viewport.width, 0);
  }
}

for (const width of [1280, 1800, 390]) for (const theme of ['light', 'dark'] as const) {
  test(`Home and dataset menu parity at ${width}px/${theme}, closed and open`, async ({ page, context }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    const writes: string[] = [];
    await installHomePolicy(context, theme, { site_name: 'Fintravel' });
    // Fail closed for mutations, while allowing the shell's read-only rights POSTs. Registered AFTER the Home
    // fixtures: Playwright runs the newest matching handler first, so a settings save reaches this recorder
    // instead of the fixture's simulated save, and reads fall back to the fixtures.
    await context.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())
        || (request.method() === 'POST' && ['/api/check-table-rights', '/api/check-table-rights-multi'].includes(path))) {
        await route.fallback(); return;
      }
      if (request.method() === 'POST' && SHELL_BACKGROUND_POSTS.has(path)) {
        await route.abort('blockedbyclient'); return;
      }
      writes.push(`${request.method()} ${path}`);
      await route.abort('blockedbyclient');
    });
    await page.addInitScript(theme => {
      localStorage.setItem('theme', theme); localStorage.setItem('chosen_language', 'fi');
      localStorage.setItem('navVisibleWide', 'false'); localStorage.setItem('navVisibleNarrow', 'false');
    }, theme);
    const dataset = page.locator(`[id="${DATASET}_tab_parts_container"]`);
    for (const surface of ['home', 'dataset'] as const) {
      await page.goto(surface === 'home' ? '/front_page' : `/${encodeURIComponent(DATASET)}?view=card`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as Window & {
        __filterestShellBoot?: { status: () => { ready: boolean } };
      }).__filterestShellBoot?.status().ready === true);
      if (surface === 'home') {
        await expect(page.locator('.front-page-top-row')).toBeVisible();
        if (width <= 700) {
          await expect(page.locator('.front-page-scroller > .front-page-phone-topbar #showMenuButton')).toHaveCount(1);
          await page.locator('.front-page-scroller').evaluate(element => { element.scrollTop = 100; });
          await expect.poll(() => page.locator('.front-page-scroller').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        }
      }
      else {
        await expect(dataset).toBeVisible();
        await expect(dataset).toHaveAttribute('data-view', 'card');
        await waitForActiveFilterbarLayout(page, dataset);
        await closeActiveFilterbarIfOpen(page, dataset);
        await expect(dataset.locator('.filterbar-panel')).toHaveClass(/filterbar-panel--hidden/);
      }
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
      for (const open of [false, true]) {
        await setMenu(page, open);
        await menuGeometry(page, surface, open);
      }
      const identity = surface === 'home' ? '.front-page-site-icon, .front-page-site-name'
        : '.dataset-shared-topbar__site-identity img, .dataset-shared-topbar__site-identity span, .morphing-title__site-name, [data-site-identity="true"]';
      // The drawer can cover identity. Dispatch bubbling clicks on those actual
      // nodes too, so an outside-click exemption cannot pass through occlusion.
      const identities = (surface === 'home' ? page : dataset).locator(identity);
      await expect(identities.first()).toBeAttached();
      for (const element of await identities.all()) {
        await element.dispatchEvent('click');
        await expect(page.locator('#navbar')).not.toHaveClass(/\bcollapsed\b/);
      }
      // A plain content click uses the same outside policy on both surfaces;
      // avoid activating a dataset card/link at an arbitrary screen coordinate.
      await page.locator('#tabs_container').dispatchEvent('click');
      await expect(page.locator('#navbar')).toHaveClass(/\bcollapsed\b/);
      await menuGeometry(page, surface, false);
      if (surface === 'dataset') {
        const sharedBar = dataset.locator('.dataset-shared-topbar:visible');
        const menu = sharedBar.getByTestId('shared-topbar-menu-button');
        await menu.press('Enter');
        await expect(page.locator('#navbar')).not.toHaveClass(/\bcollapsed\b/);
        await expect(menu).toBeFocused();
        await menu.click();
        await expect(page.locator('#navbar')).toHaveClass(/\bcollapsed\b/);
        await expect(menu).toBeFocused();

        const filter = sharedBar.getByTestId('filterbar-toggle');
        const panel = dataset.locator('.filterbar-panel');
        await expect(filter).toHaveAttribute('aria-controls', (await panel.getAttribute('id'))!);
        await filter.click();
        await expect(panel).not.toHaveClass(/filterbar-panel--hidden/);
        await expect(filter).toHaveAttribute('aria-expanded', 'true');
        await filter.click();
        await expect(panel).toHaveClass(/filterbar-panel--hidden/);
      }
      if (surface === 'home') {
        const homeBar = width <= 700 ? '.front-page-phone-topbar' : '.front-page-top-row';
        const opener = page.locator(homeBar).locator('#showMenuButton');
        const currentHome = page.locator('#navbarFrontPage a[aria-current="page"]');
        if (width <= 700) {
          await opener.focus(); await opener.press('Enter'); await expect(page.locator('#hideMenuButton')).toBeFocused();
          await page.locator('#hideMenuButton').press('Enter'); await expect(opener).toBeFocused();
          await menuGeometry(page, surface, false);

          await opener.press('Enter');
          await expect(currentHome).toBeVisible();
          await currentHome.focus();
          await currentHome.press('Enter');
          await expect(page.locator('#navbar')).toHaveClass(/\bcollapsed\b/);
          await expect(opener).toBeFocused();
          await expect(opener).toBeInViewport();
        }
        await opener.click();
        await currentHome.click({ button: 'left' });
        await expect(page.locator('#navbar')).toHaveClass(/\bcollapsed\b/);
        await expect(opener).toBeFocused();
        await expect(opener).toBeInViewport();
      }
    }
    expect(writes, 'No server mutations were attempted').toEqual([]);
  });
}
