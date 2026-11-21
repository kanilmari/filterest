// G24_menu_edge_stays_visible.spec.ts
// Proves nothing in the menu paints over the menu's 2px right edge, at rest or while any control is hovered.
// Connects the edge rule written at #navbar in navigation/navbar/navbar_layout.css with every control the menu shows
// to a signed-in administrator (account, Home, favorites, administration tools) and to a signed-out visitor.
// Exists because two hover backgrounds (All articles, then Home) hid the edge before anyone noticed (owner, 20.11.2026).
import { test, expect, type Browser, type Page } from '@playwright/test';
import { ensureNavbarVisible } from '../helpers/navbar';
import { ensureAdminToolsOpen } from '../helpers/admin-navigation';

/**
 * Lists the menu's elements whose own background reaches its last 2px without
 * painting the edge themselves. The dataset tabs are left out: rectangular ones
 * paint the edge with their own border, and the rounded ones cross it by design
 * (G4_svg_tab_alignment.spec.ts holds them).
 */
async function findEdgeCovers(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const navbar = document.getElementById('navbar');
    if (!navbar) return ['#navbar is missing'];
    const edge = navbar.getBoundingClientRect().right;
    const transparent = (colour: string) => !colour || colour === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(colour);
    const covers: string[] = [];
    for (const element of navbar.querySelectorAll<HTMLElement>('*')) {
      if (element.closest('.navtablinks')) continue;
      const box = element.getBoundingClientRect();
      if (!box.width || !box.height || box.right <= edge - 1.5 || box.left >= edge) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      if (transparent(style.backgroundColor) && style.backgroundImage === 'none') continue;
      const paintsTheEdge = parseFloat(style.borderRightWidth) >= 2 && style.borderRightStyle !== 'none'
        && box.right >= edge - 0.5;
      if (paintsTheEdge) continue;
      const name = element.dataset.testid || element.id || [...element.classList].join('.') || element.tagName;
      covers.push(`${name} (${element.tagName.toLowerCase()}, background ${style.backgroundColor})`);
    }
    return covers;
  });
}

/** Hovers every visible menu control in turn and records what covered the edge meanwhile. */
async function coversWhileHovering(page: Page): Promise<string[]> {
  const found: string[] = [];
  for (const cover of await findEdgeCovers(page)) found.push(`at rest: ${cover}`);
  const controls = await page.locator('#navbar :is(a, button, summary, [role="button"], [tabindex="0"]):visible').all();
  expect(controls.length, 'the menu shows controls to check').toBeGreaterThan(2);
  for (const control of controls) {
    if (await control.evaluate(element => !!element.closest('.navtablinks'))) continue;
    const label = await control.evaluate(element =>
      element.getAttribute('data-testid') || element.id || (element.textContent || '').trim().slice(0, 30) || element.tagName);
    // A control scrolled out of the menu's own view cannot be hovered there; scroll it in first.
    await control.scrollIntoViewIfNeeded().catch(() => {});
    await control.hover({ force: true }).catch(() => {});
    for (const cover of await findEdgeCovers(page)) found.push(`hovering ${label}: ${cover}`);
  }
  return [...new Set(found)];
}

async function openMenuOnHome(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await ensureNavbarVisible(page);
}

test.describe('G24 — The menu keeps its right edge', () => {
  test('a signed-in administrator\'s menu: no control hides the edge', async ({ page }) => {
    await openMenuOnHome(page);
    if (await page.locator('[data-testid="nav-group-admin_tools"]').count()) await ensureAdminToolsOpen(page);
    expect(await coversWhileHovering(page)).toEqual([]);
  });

  test('a signed-out visitor\'s menu: no control hides the edge', async ({ browser, page }, info) => {
    // Where browsing needs signing in, a visitor gets the sign-in page and no menu at all.
    const modes = await (await page.request.get('/api/auth-modes')).json();
    test.skip(Boolean(modes.login_required_for_browse), 'Visitors cannot browse this installation; they have no menu.');
    const visitor = await (browser as Browser).newContext({
      baseURL: info.project.use.baseURL, ignoreHTTPSErrors: true, extraHTTPHeaders: info.project.use.extraHTTPHeaders,
      viewport: info.project.use.viewport, storageState: { cookies: [], origins: [] },
    });
    try {
      const page = await visitor.newPage();
      await openMenuOnHome(page);
      expect(await coversWhileHovering(page)).toEqual([]);
    } finally {
      await visitor.close();
    }
  });
});
