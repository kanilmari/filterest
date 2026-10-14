// G11_home_phone_layout.spec.ts
// Proves Home identity, phone navigation, saved text placement and display icons.
// Uses native Home GETs; boundary fixtures alter responses only, never saved settings.
// Pins the account theme without writes and drives the real menu in both states.
// Run natively with mobile-card, tablet-card and desktop-card, one worker at a time.
import { expect, test, type Page } from '@playwright/test';

type Theme = 'light' | 'dark';
type Fixture = { name: string; width: number };

test('native document fallback matches the HTML site icon for signed-out requests', async ({ page, playwright }) => {
  const state = await openHome(page, 'light', 'fi');
  const icon = await page.locator('link[rel="icon"][sizes="16x16"]').getAttribute('href');
  expect(icon).toBeTruthy();
  const expected = await page.request.get(new URL(icon!, page.url()).href);
  expect(expected.status()).toBe(200);
  const expectedBytes = await expected.body();
  const anonymous = await playwright.request.newContext({ baseURL: new URL(page.url()).origin,
    ignoreHTTPSErrors: true, storageState: { cookies: [], origins: [] } });
  try {
    for (const address of ['/favicon.ico', '/favicon4S.png']) {
      const response = await anonymous.get(address);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toBe('image/png');
      expect(response.headers()['cache-control']).toBe('public, no-cache');
      expect(await response.body()).toEqual(expectedBytes);
      const etag = response.headers().etag;
      expect(etag).toBeTruthy();
      const head = await anonymous.head(address);
      expect(head.status()).toBe(200);
      expect(head.headers()['content-length']).toBe(String(expectedBytes.length));
      expect(head.headers().etag).toBe(etag);
      expect(await head.body()).toHaveLength(0);
      const unchanged = await anonymous.get(address, { headers: { 'If-None-Match': etag } });
      expect(unchanged.status()).toBe(304);
    }
  } finally { await anonymous.dispose(); }
  expect(state.writes).toEqual([]);
});

async function openHome(page: Page, theme: Theme, language: string, fixture?: Fixture) {
  const writes: string[] = [];
  let alignment = 'left';
  page.on('request', request => {
    if (/\/api\/(?:admin\/)?front-page(?:[/?]|$)/.test(request.url()) && request.method() !== 'GET') {
      writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  await page.route(url => url.pathname === '/api/user-visual-preference', async route => {
    expect(route.request().method(), 'The spec must never save account appearance').toBe('GET');
    await route.fulfill({ json: { theme_mode: theme, revision: 1, configured: true } });
  });
  await page.route(url => url.pathname === '/api/front-page', async route => {
    expect(route.request().method()).toBe('GET');
    const response = await route.fetch();
    expect(response.ok(), 'Native Home must be enabled and readable').toBe(true);
    const data = await response.json();
    if (fixture) {
      // Preserve viewer identity, live destinations, copy and media. Exercise the
      // owner's saved Fintravel geometry without storing a presentation anywhere.
      data.site_name = fixture.name;
      data.presentation = { ...data.presentation, schema_version: 2, anchor: 'center-left', alignment: 'left',
        max_width_px: 750, horizontal_margin_px: 160, vertical_margin_px: 40 };
    }
    alignment = data.presentation?.alignment || 'left';
    await route.fulfill({ response, json: data });
  });
  await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
  await page.addInitScript(({ theme, language }) => {
    localStorage.setItem('theme', theme);
    localStorage.setItem('chosen_language', language);
    localStorage.setItem('navVisibleWide', 'false');
    localStorage.setItem('navVisibleNarrow', 'false');
  }, { theme, language });
  if (fixture) await page.setViewportSize({ width: fixture.width, height: 900 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (window as Window & {
    __filterestShellBoot?: { status: () => { ready: boolean } };
  }).__filterestShellBoot?.status().ready === true);
  await expect(page.locator('.front-page-top-row')).toBeVisible();
  await expect(page.locator('.front-page-hero')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
  return { writes, alignment, cappedMargin: Boolean(fixture) };
}

async function setMenu(page: Page, open: boolean, key?: 'Enter' | 'Space') {
  const navbar = page.locator('#navbar');
  const menu = page.locator('#showMenuButton');
  await expect(menu).toHaveCount(1);
  const collapsed = /\bcollapsed\b/.test(await navbar.getAttribute('class') || '');
  if (collapsed === open) {
    if (key) {
      await menu.focus(); await expect(menu).toBeFocused(); await menu.press(key);
    } else await menu.click();
  }
  if (open) await expect(navbar).not.toHaveClass(/\bcollapsed\b/);
  else await expect(navbar).toHaveClass(/\bcollapsed\b/);
  // Wait for the actual 700ms shell transition through measured geometry, not sleep.
  await expect.poll(() => navbar.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.classList.contains('collapsed') ? box.right <= 1 : Math.abs(box.left) <= 1;
  })).toBe(true);
  await expect(menu).toHaveAttribute('aria-expanded', String(open));
  if (key) await expect(menu).toBeFocused();
}

async function proveHome(page: Page, open: boolean, alignment: string, cappedMargin: boolean) {
  const phone = page.viewportSize()!.width <= 700;
  const name = page.locator('.front-page-site-name');
  const icon = page.locator('.front-page-site-icon');
  const menu = page.locator('#showMenuButton');
  await expect(name).toBeVisible(); await expect(menu).toBeVisible();
  await expect(menu).toBeEnabled();
  await expect(menu).toHaveAttribute('aria-hidden', 'false');
  await expect(menu).toHaveAttribute('tabindex', '0');
  const close = page.locator('#hideMenuButton');
  await expect(close).toBeHidden();
  await expect(close).toHaveAttribute('aria-hidden', 'true');
  await expect(close).toHaveAttribute('tabindex', '-1');
  await expect.poll(() => menu.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }), { message: 'The Home menu toggle must receive pointer input in both panel states' }).toBe(true);
  await expect.poll(() => name.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect.poll(() => icon.evaluate((image: HTMLImageElement) =>
    image.complete && image.naturalWidth === 128 && /-128\.png$/.test(image.currentSrc))).toBe(true);
  await expect(icon).toHaveCSS('image-rendering', 'auto');
  await expect(icon).toHaveCSS('width', '32px');
  const nameBox = (await name.boundingBox())!, iconBox = (await icon.boundingBox())!, menuBox = (await menu.boundingBox())!;
  expect(nameBox.x - iconBox.x - iconBox.width).toBeGreaterThanOrEqual(8);
  expect(iconBox.x - menuBox.x - menuBox.width).toBeGreaterThanOrEqual(8);
  expect(iconBox.x - menuBox.x - menuBox.width).toBeLessThanOrEqual(12);
  expect(nameBox.x).toBeGreaterThanOrEqual(menuBox.x + menuBox.width);
  expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const hero = page.locator('.front-page-text-stage .front-page-hero');
  await expect(hero).toHaveCSS('text-align', alignment);
  const stage = page.locator('.front-page-text-stage');
  if (open && page.viewportSize()!.width <= 1850) await expect.poll(() => page.locator('#navbar').evaluate(element => {
    const header = document.querySelector('.front-page-top-row')!.getBoundingClientRect();
    return element.getBoundingClientRect().top >= header.bottom - 1;
  })).toBe(true);
  if (phone) {
    const stageBox = (await stage.boundingBox())!, heroBox = (await hero.boundingBox())!;
    expect(heroBox.x + heroBox.width / 2).toBeCloseTo(stageBox.x + stageBox.width / 2, 0);
    expect(heroBox.x - stageBox.x).toBeCloseTo(16, 0);
    expect(stageBox.x + stageBox.width - heroBox.x - heroBox.width).toBeCloseTo(16, 0);
    const tabs = page.locator('.front-page-top-row > .hero-dataset-tabs');
    await expect(tabs).toBeVisible();
    const buttons = tabs.locator(':scope > button');
    expect(await buttons.count(), 'Native Home needs at least two accepted dataset destinations').toBeGreaterThan(1);
    await expect.poll(() => buttons.evaluateAll(elements => elements.every(element =>
      !(element as HTMLButtonElement).hidden && getComputedStyle(element).display !== 'none'))).toBe(true);
    const boxes = await buttons.evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }));
    const homeBox = (await page.locator('.front-page').boundingBox())!;
    if (open) await expect.poll(() => page.locator('#navbar').evaluate(element => {
      const header = document.querySelector('.front-page-top-row')!.getBoundingClientRect();
      return element.getBoundingClientRect().top >= header.bottom - 1;
    })).toBe(true);
    for (const [index, box] of boxes.entries()) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeCloseTo(boxes[0].width, 1);
      expect(box.x).toBeCloseTo(boxes[0].x, 1);
      expect(box.x).toBeGreaterThanOrEqual(homeBox.x + 16);
      expect(box.x + box.width).toBeLessThanOrEqual(homeBox.x + homeBox.width - 16);
      if (index) expect(box.y).toBeGreaterThanOrEqual(boxes[index - 1].y + boxes[index - 1].height);
      await expect(buttons.nth(index).locator('.hero-dataset-tabs__icon')).toBeVisible();
      await expect(buttons.nth(index)).toHaveAccessibleName(/\S/);
      expect(await buttons.nth(index).evaluate(element => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }), 'The menu must not cover Home destinations').toBe(true);
    }
    // Home has no selected dataset; its shared renderer preserves the current-page contract.
    await expect(tabs.locator(':scope > button[aria-current]')).toHaveCount(0);
    await menu.focus(); await menu.press('Tab');
    await expect(buttons.first()).toBeFocused();
    await expect(buttons.first()).toHaveCSS('outline-style', 'solid');
    await expect(buttons.first()).toHaveCSS('outline-width', '2px');
  } else if (cappedMargin) {
    const insets = await stage.evaluate(element => ({ width: element.getBoundingClientRect().width,
      left: Number.parseFloat(getComputedStyle(element).paddingLeft),
      right: Number.parseFloat(getComputedStyle(element).paddingRight) }));
    const expected = Math.min(160, insets.width * 0.08, Math.max(0, (insets.width - 320) / 2));
    expect(insets.left).toBeCloseTo(expected, 1); expect(insets.right).toBeCloseTo(expected, 1);
  }
}

async function proveKeyboardMenu(page: Page, state: { alignment: string; cappedMargin: boolean }) {
  for (const key of ['Enter', 'Space'] as const) {
    for (const open of [true, false]) {
      await setMenu(page, open, key); await proveHome(page, open, state.alignment, state.cappedMargin);
    }
  }
}

// Every Playwright project crosses the breakpoint with a destination focused,
// using native destinations and a pinned account theme over the opposite OS theme.
test('native Home keeps focus and restores every destination across 700px', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  const state = await openHome(page, 'light', 'fi');
  await setMenu(page, true);
  await proveHome(page, true, state.alignment, false);
  const buttons = page.locator('.front-page-top-row > .hero-dataset-tabs > button');
  const count = await buttons.count();
  const trailing = buttons.last();
  await trailing.focus();
  await expect(trailing).toBeFocused();

  await page.setViewportSize({ width: 706, height: 900 });
  await expect(trailing).toHaveJSProperty('hidden', true);
  await expect(trailing).toBeHidden();
  const menu = page.locator('.front-page-top-row #showMenuButton');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('aria-hidden', 'false');
  await expect(menu).toBeFocused();
  await expect(page.locator('#navbar')).not.toHaveClass(/\bcollapsed\b/);
  await expect(page.locator('#hideMenuButton')).toBeHidden();
  await expect(page.locator('#hideMenuButton')).toHaveAttribute('aria-hidden', 'true');

  await page.setViewportSize({ width: 700, height: 900 });
  await expect(buttons).toHaveCount(count);
  for (const button of await buttons.all()) {
    await expect(button).toHaveJSProperty('hidden', false);
    await expect(button).toBeVisible();
  }
  await expect(menu).toBeFocused();
  await proveHome(page, true, state.alignment, false);
  expect(state.writes).toEqual([]);
});

for (const theme of ['light', 'dark'] as const) {
  for (const language of ['fi', 'en']) {
    test(`native Home in ${language}/${theme}: matrix width, menu closed and open`, async ({ page }) => {
      const state = await openHome(page, theme, language);
      for (const open of [false, true, false, true, false]) {
        await setMenu(page, open); await proveHome(page, open, state.alignment, false);
      }
      await proveKeyboardMenu(page, state);
      if (page.viewportSize()!.width <= 700) {
        await page.locator('.front-page-top-row .hero-dataset-tabs__button').first().click();
        const identity = page.locator('.dataset-shared-topbar:visible [data-testid="mobile-site-identity"]');
        await expect(identity).toBeVisible();
        await expect.poll(() => identity.locator('img').evaluate((image: HTMLImageElement) =>
          image.complete && /-128\.png$/.test(image.currentSrc))).toBe(true);
        await expect(identity.locator('img')).toHaveCSS('image-rendering', 'auto');
        // The Home exception must not make the dataset hero tabs visible on phones.
        await expect(page.locator('.tab_parts_container:visible .filterbar-inline-hero .hero-dataset-tabs')).toBeHidden();
      }
      expect(state.writes).toEqual([]);
    });
  }
  for (const fixture of [
    { name: 'Fintravel', width: 320 }, { name: 'Easelect', width: 320 }, { name: 'Serlog', width: 320 },
    { name: 'Fintravel', width: 650 }, { name: 'Fintravel', width: 700 }, { name: 'Fintravel', width: 706 },
    { name: 'Fintravel', width: 1850 }, { name: 'Fintravel', width: 1851 },
  ]) {
    test(`${fixture.name} ${fixture.width}px/${theme}: read-only response fixture, both menu states`, async ({ page }) => {
      const state = await openHome(page, theme, 'fi', fixture);
      await expect(page.locator('.front-page-site-name')).toHaveText(fixture.name);
      await expect(page.locator('.front-page-text-stage')).toHaveAttribute('data-anchor', 'center-left');
      for (const open of [false, true, false, true, false]) {
        await setMenu(page, open); await proveHome(page, open, state.alignment, state.cappedMargin);
      }
      await proveKeyboardMenu(page, state);
      expect(state.writes).toEqual([]);
    });
  }
}
