// G14_home_menu_parity.spec.ts
// Compares native Home with the existing service catalogue, in both menu states.
// Home policy and appearance use response-only fixtures; no settings are saved.
// Pins full viewport geometry, pointer ownership and the shared outside-click rule.
import { expect, test, type Page } from '@playwright/test';
import { installHomePolicy } from '../helpers/home-policy-fixture';
import { closeActiveFilterbarIfOpen } from '../helpers/filterbar';

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

async function menuGeometry(page: Page, open: boolean) {
  const control = page.locator(MENU_CONTROL);
  await expect(control).toHaveCount(1);
  await expect(control).toHaveAttribute('aria-hidden', 'false');
  await expect(control).toHaveAttribute('tabindex', '0');
  await expect(control).toHaveAccessibleName(/\S/);
  await expect.poll(() => control.evaluate(element => {
    const box = element.getBoundingClientRect();
    return Math.abs(box.x - 12) <= 1 && Math.abs(box.y - 12) <= 1
      && element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }), { message: 'The sole menu control stays actionable in the top-left corner' }).toBe(true);
  const geometry = await page.locator('#navbar').evaluate(element => {
    const box = element.getBoundingClientRect();
    return { top: box.top, height: box.height };
  });
  expect(geometry.top).toBeCloseTo(0, 0);
  expect(geometry.height).toBeCloseTo(page.viewportSize()!.height, 0);
  const box = (await control.boundingBox())!;
  if (open) {
    await expect(control).toHaveAttribute('id', 'hideMenuButton');
    // Narrow menus overlay the content without shifting or shrinking its host.
    const content = await page.locator('#tabs_container').boundingBox();
    expect(content!.x).toBeCloseTo(0, 0);
    expect(content!.width).toBeCloseTo(page.viewportSize()!.width, 0);
  }
  return { ...geometry, x: box.x, y: box.y, width: box.width, buttonHeight: box.height };
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
    const homeGeometry = new Map<boolean, Awaited<ReturnType<typeof menuGeometry>>>();
    for (const surface of ['home', 'dataset'] as const) {
      await page.goto(surface === 'home' ? '/front_page' : '/app_service_catalog?view=card', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (window as Window & {
        __filterestShellBoot?: { status: () => { ready: boolean } };
      }).__filterestShellBoot?.status().ready === true);
      if (surface === 'home') await expect(page.locator('.front-page-top-row')).toBeVisible();
      else {
        await expect(page.locator('#app_service_catalog_tab_parts_container')).toBeVisible();
        await closeActiveFilterbarIfOpen(page);
      }
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
      for (const open of [false, true]) {
        await setMenu(page, open);
        const current = await menuGeometry(page, open);
        if (surface === 'home') homeGeometry.set(open, current);
        else for (const key of Object.keys(current) as (keyof typeof current)[]) {
          expect(current[key], `${key} matches Home with open=${open}`).toBeCloseTo(homeGeometry.get(open)![key], 0);
        }
      }
      const identity = surface === 'home' ? '.front-page-site-icon, .front-page-site-name'
        : '.dataset-shared-topbar__site-identity img, .dataset-shared-topbar__site-identity span, .morphing-title__site-name, [data-site-identity="true"]';
      // The drawer can cover identity. Dispatch bubbling clicks on those actual
      // nodes too, so an outside-click exemption cannot pass through occlusion.
      for (const element of await page.locator(identity).all()) {
        await element.dispatchEvent('click');
        await expect(page.locator('#navbar')).not.toHaveClass(/\bcollapsed\b/);
      }
      // A plain content click uses the same outside policy on both surfaces;
      // avoid activating a dataset card/link at an arbitrary screen coordinate.
      await page.locator('#tabs_container').dispatchEvent('click');
      await expect(page.locator('#navbar')).toHaveClass(/\bcollapsed\b/);
      await menuGeometry(page, false);
    }
    expect(writes, 'No server mutations were attempted').toEqual([]);
  });
}
