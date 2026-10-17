// G11_home_phone_layout.spec.ts
// Proves Home identity, phone navigation, saved text placement and display icons.
// Uses native Home GETs; boundary fixtures alter responses only, never saved settings.
// Pins the account theme without writes and drives the real menu in both states.
// Run natively with mobile-card, tablet-card and desktop-card, one worker at a time.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { installMenuVisibilityProbe, type MenuProbeWindow } from '../helpers/menu_control_visibility';

type Theme = 'light' | 'dark';
type Fixture = { name: string; width: number; height?: number; datasetCount?: number };
// Observe whole rendered frames and completed mutation batches, starting before
// ownership changes. Settled locator assertions alone missed the fading copy.

async function sampleMenuTransition(page: Page, action: () => Promise<unknown>) {
  await page.evaluate(installMenuVisibilityProbe);
  try {
    await action();
    await expect.poll(() => page.evaluate(() => {
      const probe = (window as MenuProbeWindow).__homeMenuVisibilityProbe!;
      return probe.frames >= 2 && probe.idleFrames >= 2;
    }), { message: 'Sample menu ownership throughout the actual CSS transitions' }).toBe(true);
    const result = await page.evaluate(() => {
      const probe = (window as MenuProbeWindow).__homeMenuVisibilityProbe!;
      return { samples: probe.samples, failures: probe.failures };
    });
    expect(result.samples).toBeGreaterThan(2);
    expect(result.failures, 'Atomic menu ownership; empty frames require owner animation; strict settled control').toEqual([]);
    expect(await page.evaluate(() => (window as MenuProbeWindow).__homeMenuVisibilityProbe!.settled()),
      'Exactly one painted, on-screen, focusable, announced, pointer-accessible settled owner').toBe(true);
  } finally {
    await page.evaluate(() => {
      (window as MenuProbeWindow).__homeMenuVisibilityProbe?.stop();
      delete (window as MenuProbeWindow).__homeMenuVisibilityProbe;
    });
  }
}

async function expectFocusWithMenuOwner(page: Page, control: Locator) {
  const ownsProbe = await page.evaluate(() => !(window as MenuProbeWindow).__homeMenuVisibilityProbe);
  if (ownsProbe) await page.evaluate(installMenuVisibilityProbe);
  try {
    await expect.poll(() => page.evaluate(() => (window as MenuProbeWindow).__homeMenuVisibilityProbe!.settled()),
      { message: 'Every focus assertion requires exactly one painted and actionable menu owner' }).toBe(true);
    expect(await control.evaluate(element => !element.matches(
      '#showMenuButton, #hideMenuButton, [data-navbar-menu-button="true"]')
      || (element.getAttribute('aria-hidden') === 'false' && (element as HTMLElement).tabIndex === 0
        && !element.closest('[hidden], [inert], .hidden, [aria-hidden="true"]'))),
      'A focused menu control must be the announced owner').toBe(true);
    await expect(control).toBeFocused();
    expect(await page.evaluate(() => (window as MenuProbeWindow).__homeMenuVisibilityProbe!.failures)).toEqual([]);
  } finally {
    if (ownsProbe) await page.evaluate(() => {
      (window as MenuProbeWindow).__homeMenuVisibilityProbe?.stop();
      delete (window as MenuProbeWindow).__homeMenuVisibilityProbe;
    });
  }
}

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
  if (fixture) await page.route(url => url.pathname === '/api/datasets', async route => {
    expect(route.request().method()).toBe('GET');
    // Response-only destinations: no datasets, accounts or keys are created.
    // Both Home's projection and the real navbar consume this same catalogue.
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const data = await response.json();
    data.datasets = Array.from({ length: fixture.datasetCount ?? 2 }, (_, index) => ({
      dataset_name: `app_e2e_home_menu_fixture_${index + 1}`, table_uid: 900000 + index,
      is_top_level_in_current_project: true, can_read_rows: true, icon_key: 'table',
    }));
    data.tab_order = null;
    await route.fulfill({ response, json: data });
  });
  if (fixture) await page.route(url => url.pathname === '/api/translations', async route => {
    expect(route.request().method()).toBe('GET');
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const data = await response.json();
    const translations = data.translations && typeof data.translations === 'object' ? data.translations : data;
    const label = new URL(route.request().url()).searchParams.get('lang') === 'fi' ? 'Testiaineisto' : 'Fixture dataset';
    for (let index = 1; index <= (fixture.datasetCount ?? 2); index++) {
      translations[`app_e2e_home_menu_fixture_${index}`] = `${label} ${index}`;
    }
    // Response-only copy plus the protected E2E prefix prevents synthetic keys
    // from entering translation maintenance even before a dictionary arrives.
    await route.fulfill({ response, json: data });
  });
  await page.route(url => url.pathname === '/api/front-page', async route => {
    expect(route.request().method()).toBe('GET');
    const response = await route.fetch();
    expect(response.ok(), 'Native Home must be enabled and readable').toBe(true);
    const data = await response.json();
    if (fixture) {
      // Preserve viewer identity, copy and media while pinning header geometry.
      // These fixtures never navigate to their response-only destinations.
      data.site_name = fixture.name;
      data.presentation = { ...data.presentation,
        text_style: { preset: 'default', reveal: { mode: 'none', start_ms: 3000, interval_ms: 800 } }, anchor: 'center-left', alignment: 'left',
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
  if (fixture) await page.setViewportSize({ width: fixture.width, height: fixture.height ?? 900 });
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
  const close = page.locator('#hideMenuButton');
  await expect(menu).toHaveCount(1);
  const collapsed = /\bcollapsed\b/.test(await navbar.getAttribute('class') || '');
  if (collapsed === open) {
    const trigger = collapsed ? menu : close;
    if (key) {
      await trigger.focus(); await expectFocusWithMenuOwner(page, trigger); await trigger.press(key);
    } else await trigger.click();
  }
  if (open) await expect(navbar).not.toHaveClass(/\bcollapsed\b/);
  else await expect(navbar).toHaveClass(/\bcollapsed\b/);
  // Wait for the actual 700ms shell transition through measured geometry, not sleep.
  await expect.poll(() => navbar.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.classList.contains('collapsed') ? box.right <= 1 : Math.abs(box.left) <= 1;
  })).toBe(true);
  await expect(menu).toHaveAttribute('aria-expanded', String(open));
  if (key) await expectFocusWithMenuOwner(page, open ? close : menu);
  // Check the restored on-screen state; the ownership probes below sample
  // Home/dataset and shared-topbar handoffs through their actual transitions.
  await sampleMenuTransition(page, async () => {});
}

async function proveHome(page: Page, open: boolean, alignment: string, cappedMargin: boolean) {
  const phone = page.viewportSize()!.width <= 700;
  const name = page.locator('.front-page-site-name');
  const icon = page.locator('.front-page-site-icon');
  const menu = page.locator('#showMenuButton');
  await expect(name).toBeVisible();
  const close = page.locator('#hideMenuButton');
  const slot = page.locator('.front-page-top-row .dataset-shared-topbar__menu-slot');
  // Owner 14.10.2026: an open menu retains its own control and leaves no Home slot gap.
  if (open) {
    await expect(menu).toBeHidden(); await expect(close).toBeVisible(); await expect(slot).toBeHidden();
    expect(await slot.evaluate(element => element.getBoundingClientRect().width)).toBe(0);
  } else {
    await expect(menu).toBeVisible(); await expect(close).toBeHidden(); await expect(slot).toBeVisible();
    await expect(menu).not.toHaveClass(/shared-topbar-menu-source-hidden/);
  }
  await expect(slot).toHaveJSProperty('inert', open);
  await expect(slot).toHaveAttribute('aria-hidden', String(open));
  await expect(menu).toHaveAttribute('aria-hidden', String(open));
  await expect(menu).toHaveAttribute('tabindex', open ? '-1' : '0');
  await expect(close).toHaveAttribute('aria-hidden', String(!open));
  await expect(close).toHaveAttribute('tabindex', open ? '0' : '-1');
  const control = open ? close : menu;
  await expect(control).toBeEnabled(); await expect(control).toHaveAccessibleName(/\S/);
  await expect.poll(() => control.evaluate(element => {
    const box = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }), { message: 'The visible menu control must receive pointer input' }).toBe(true);
  await expect.poll(() => name.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect.poll(() => icon.evaluate((image: HTMLImageElement) =>
    image.complete && image.naturalWidth === 128 && /-128\.png$/.test(image.currentSrc))).toBe(true);
  await expect(icon).toHaveCSS('image-rendering', 'auto');
  await expect(icon).toHaveCSS('width', '32px');
  const nameBox = (await name.boundingBox())!, iconBox = (await icon.boundingBox())!;
  expect(nameBox.x - iconBox.x - iconBox.width).toBeGreaterThanOrEqual(8);
  if (open) {
    const identity = (await page.locator('.front-page-top-row__identity').boundingBox())!;
    expect(iconBox.x).toBeCloseTo(identity.x, 1);
  } else {
    const menuBox = (await menu.boundingBox())!;
    expect(iconBox.x - menuBox.x - menuBox.width).toBeGreaterThanOrEqual(8);
    expect(iconBox.x - menuBox.x - menuBox.width).toBeLessThanOrEqual(12);
    expect(nameBox.x).toBeGreaterThanOrEqual(menuBox.x + menuBox.width);
  }
  expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  const hero = page.locator('.front-page-text-stage .front-page-hero');
  await expect(hero).toHaveCSS('text-align', alignment);
  const stage = page.locator('.front-page-text-stage');
  if (open && phone) {
    await expect(page.locator('#navbar')).toHaveCSS('position', 'fixed');
    await expect.poll(() => page.locator('#navbar').evaluate(element => {
      const box = element.getBoundingClientRect();
      return box.top === 0 && box.bottom <= innerHeight && box.height > 0;
    }), { message: 'Phone Home uses the viewport, independent of its dataset count' }).toBe(true);
  }
  if (open && !phone && page.viewportSize()!.width <= 1850) await expect.poll(() => page.locator('#navbar').evaluate(element => {
    const header = document.querySelector('.front-page-top-row')!.getBoundingClientRect();
    return element.getBoundingClientRect().top >= header.bottom - 1;
  })).toBe(true);
  // Destination geometry belongs to a fixed two-dataset response, so native
  // Home checks do not assume its current count or that all tabs fit on screen.
  if (phone && cappedMargin) {
    const stageBox = (await stage.boundingBox())!, heroBox = (await hero.boundingBox())!;
    expect(heroBox.x + heroBox.width / 2).toBeCloseTo(stageBox.x + stageBox.width / 2, 0);
    expect(heroBox.x - stageBox.x).toBeCloseTo(16, 0);
    expect(stageBox.x + stageBox.width - heroBox.x - heroBox.width).toBeCloseTo(16, 0);
    const tabs = page.locator('.front-page-top-row > .hero-dataset-tabs');
    await expect(tabs).toBeVisible();
    const buttons = tabs.locator(':scope > button');
    await expect(buttons).toHaveCount(2);
    await expect.poll(() => buttons.evaluateAll(elements => elements.every(element =>
      !(element as HTMLButtonElement).hidden && getComputedStyle(element).display !== 'none'))).toBe(true);
    const boxes = await buttons.evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }));
    const homeBox = (await page.locator('.front-page').boundingBox())!;
    for (const [index, box] of boxes.entries()) {
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeCloseTo(boxes[0].width, 1);
      expect(box.x).toBeCloseTo(boxes[0].x, 1);
      expect(box.x).toBeGreaterThanOrEqual(homeBox.x + 16);
      expect(box.x + box.width).toBeLessThanOrEqual(homeBox.x + homeBox.width - 16);
      if (index) expect(box.y).toBeGreaterThanOrEqual(boxes[index - 1].y + boxes[index - 1].height);
      await expect(buttons.nth(index).locator('.hero-dataset-tabs__icon')).toBeVisible();
      await expect(buttons.nth(index)).toHaveAccessibleName(/\S/);
      if (!open) expect(await buttons.nth(index).evaluate(element => {
        const box = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }), 'Closed-menu Home destinations must receive pointer input').toBe(true);
    }
    // Home has no selected dataset; its shared renderer preserves the current-page contract.
    await expect(tabs.locator(':scope > button[aria-current]')).toHaveCount(0);
    // Enter from the preceding control in DOM tab order, including the open
    // navbar. Pointer-driven programmatic focus alone cannot prove :focus-visible.
    const beforeTabs = open ? page.locator('#navbar :is(button, a[href], input, select, [tabindex="0"]):visible:not([disabled]):not([tabindex="-1"])').last() : menu;
    await beforeTabs.focus(); await beforeTabs.press('Tab');
    await expectFocusWithMenuOwner(page, buttons.first());
    await expect(buttons.first()).toHaveCSS('outline-style', 'solid');
    await expect(buttons.first()).toHaveCSS('outline-width', '2px');
  } else if (!phone && cappedMargin) {
    const insets = await stage.evaluate(element => ({ width: element.getBoundingClientRect().width,
      left: Number.parseFloat(getComputedStyle(element).paddingLeft),
      right: Number.parseFloat(getComputedStyle(element).paddingRight) }));
    const expected = Math.min(160, insets.width * 0.08, Math.max(0, (insets.width - 320) / 2));
    expect(insets.left).toBeCloseTo(expected, 1); expect(insets.right).toBeCloseTo(expected, 1);
  }
}

async function expectPointerInsideViewport(control: Locator) {
  await expect.poll(() => control.evaluate(element => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return box.width > 0 && box.height > 0 && box.top >= 0 && box.left >= 0
      && box.bottom <= innerHeight && box.right <= innerWidth && hit !== null && element.contains(hit);
  }), { message: 'The whole control must fit the viewport and receive pointer input at its centre' }).toBe(true);
}

async function provePhoneDrawerControls(page: Page) {
  const navbar = page.locator('#navbar');
  const topControls = navbar.locator('.top-button-bar button:visible');
  // Close, history in both directions (including disabled buttons), theme and language.
  expect(await topControls.count()).toBeGreaterThanOrEqual(5);
  for (const control of await topControls.all()) await expectPointerInsideViewport(control);
  const controls = navbar.locator(':is(button, a[href], input:not([type="hidden"]), select, [role="button"], [tabindex="0"]):visible');
  expect(await controls.count()).toBeGreaterThan(12);
  for (const control of await controls.all()) {
    // Real internal scrolling reveals lower controls below the sticky close row.
    await control.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await expectPointerInsideViewport(control);
    if (await control.isEnabled()) await control.click({ trial: true });
  }
  await navbar.evaluate(element => { element.scrollTop = element.scrollHeight; });
  expect(await navbar.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  for (const control of await topControls.all()) await expectPointerInsideViewport(control);
  // Batch 150's language panel remains portalled outside the drawer's scroller.
  const language = navbar.getByTestId('language-menu-button');
  await language.click();
  const panel = page.getByTestId('language-menu-panel');
  await expect(panel).toBeVisible();
  expect(await panel.evaluate(element => element.parentElement === document.body)).toBe(true);
  await expectPointerInsideViewport(panel);
  for (const option of await panel.locator('.language-option').all()) {
    await option.evaluate(element => element.scrollIntoView({ block: 'nearest' }));
    await expectPointerInsideViewport(option);
  }
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(navbar).not.toHaveClass(/\bcollapsed\b/);
  // A pointer close from the scrolled drawer must restore Home's sole opener.
  await navbar.locator('#hideMenuButton').click();
  await setMenu(page, false);
  await expect(page.locator('#showMenuButton')).toBeVisible();
  await expect(page.locator('#hideMenuButton')).toBeHidden();
}

async function proveDatasetMenuOwnership(page: Page, sample = true) {
  const source = page.locator('#showMenuButton');
  const topbar = page.locator('.dataset-shared-topbar:visible');
  const menu = topbar.getByTestId('shared-topbar-menu-button');
  const open = !/\bcollapsed\b/.test(await page.locator('#navbar').getAttribute('class') || '');
  // Round 5: the open navbar owns its closer on phones as on larger screens.
  if (open) {
    await expect(menu).toBeHidden();
    await expect(menu).toHaveAttribute('aria-hidden', 'true'); await expect(menu).toHaveAttribute('tabindex', '-1');
    await expect(topbar.locator('.dataset-shared-topbar__menu-slot')).toHaveJSProperty('inert', true);
    await expect(source).not.toHaveClass(/shared-topbar-menu-source-hidden/);
    await expect(source).toHaveAttribute('aria-hidden', 'true'); await expect(source).toHaveAttribute('tabindex', '-1');
    await expect(page.locator('#hideMenuButton')).toBeVisible();
    await expect(page.locator('#hideMenuButton')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#hideMenuButton')).toHaveAttribute('tabindex', '0');
    if (sample) await sampleMenuTransition(page, async () => {});
    return;
  }
  await expect(topbar).toBeVisible(); await expect(menu).toBeVisible();
  await expect(source).toHaveClass(/shared-topbar-menu-source-hidden/);
  await expect(source).toHaveAttribute('aria-hidden', 'true');
  await expect(source).toHaveAttribute('tabindex', '-1');
  await expect(menu).toHaveAttribute('aria-hidden', 'false');
  await expect(menu).toHaveAttribute('tabindex', '0');
  await expect(menu).toHaveAccessibleName(/\S/);
  await expect(topbar.locator('.dataset-shared-topbar__menu-slot')).toHaveJSProperty('inert', false);
  if (sample) await sampleMenuTransition(page, async () => {});
}

async function focusOutgoingMenu(page: Page, control: Locator) {
  await expect(control).toBeVisible();
  await control.focus();
  // Return through actual keyboard tab order before history navigation. There
  // is no focus call on the incoming control after Back or Forward.
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  await expectFocusWithMenuOwner(page, control);
}

async function proveKeyboardMenu(page: Page, state: { alignment: string; cappedMargin: boolean }) {
  for (const key of ['Enter', 'Space'] as const) {
    for (const open of [true, false]) {
      await setMenu(page, open, key); await proveHome(page, open, state.alignment, state.cappedMargin);
    }
  }
}

// Every Playwright project crosses the breakpoint with a destination focused,
// using a fixed catalogue and a pinned account theme over the opposite OS theme.
test('Home response fixture keeps focus and restores every destination across 700px', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 900 });
  const state = await openHome(page, 'light', 'fi', { name: 'Fintravel', width: 700, datasetCount: 12 });
  await setMenu(page, true);
  await proveHome(page, true, state.alignment, false);
  const buttons = page.locator('.front-page-top-row > .hero-dataset-tabs > button');
  const count = await buttons.count();
  const trailing = buttons.last();
  await trailing.focus();
  await expectFocusWithMenuOwner(page, trailing);

  await page.setViewportSize({ width: 706, height: 900 });
  await expect(trailing).toHaveJSProperty('hidden', true);
  await expect(trailing).toBeHidden();
  // Resizing an open Home sends focus to the menu bar's visible closer.
  const menu = page.locator('#hideMenuButton');
  await expect(menu).toBeVisible(); await expect(menu).toHaveAttribute('aria-hidden', 'false');
  await expectFocusWithMenuOwner(page, menu);
  await expect(page.locator('#navbar')).not.toHaveClass(/\bcollapsed\b/);
  await expect(page.locator('.front-page-top-row #showMenuButton')).toBeHidden();
  await expect(page.locator('.front-page-top-row #showMenuButton')).toHaveAttribute('aria-hidden', 'true');

  await page.setViewportSize({ width: 700, height: 900 });
  await expect(buttons).toHaveCount(count);
  for (const button of await buttons.all()) {
    await expect(button).toHaveJSProperty('hidden', false);
    await expect(button).toBeVisible();
  }
  await expectFocusWithMenuOwner(page, menu);
  await proveHome(page, true, state.alignment, false);
  expect(state.writes).toEqual([]);
});

for (const open of [false, true]) {
  test(`Home restores menu ownership through Back/Forward with open=${open}`, async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 900 });
    const state = await openHome(page, 'light', 'fi');
    await setMenu(page, open);
    await page.locator('.front-page-top-row .hero-dataset-tabs__button').first().click();
    await expect(page.locator('.front-page-top-row')).toHaveCount(0);
    await expect(page.locator('#showMenuButton')).toHaveCount(1);
    await expect(page.locator('.front-page-top-row #showMenuButton')).toHaveCount(0);
    await proveDatasetMenuOwnership(page);
    const identity = page.locator('.dataset-shared-topbar:visible [data-testid="mobile-site-identity"]');
    await expect(identity).toBeVisible();
    await expect.poll(() => identity.locator('img').evaluate((image: HTMLImageElement) =>
      image.complete && /-128\.png$/.test(image.currentSrc))).toBe(true);
    await expect(identity.locator('img')).toHaveCSS('image-rendering', 'auto');
    await expect(page.locator('.tab_parts_container:visible .filterbar-inline-hero .hero-dataset-tabs')).toBeHidden();
    const datasetMenu = page.locator('.dataset-shared-topbar:visible').getByTestId('shared-topbar-menu-button');
    const navbar = page.locator('#navbar');
    // Clicking the destination may close the overlay; explicitly exercise both
    // outgoing dataset states instead of relying on the Home state from earlier.
    if (/\bcollapsed\b/.test(await navbar.getAttribute('class') || '') === open) {
      await (open ? datasetMenu : page.locator('#hideMenuButton')).click();
    }
    if (open) await expect(navbar).not.toHaveClass(/\bcollapsed\b/);
    else await expect(navbar).toHaveClass(/\bcollapsed\b/);
    await focusOutgoingMenu(page, open ? page.locator('#hideMenuButton') : datasetMenu);
    await sampleMenuTransition(page, async () => {
      await page.goBack();
      await expect(page.locator('.front-page-top-row')).toBeVisible();
      // Routing can close a narrow panel; prove the actual restored state before toggling it.
      const restoredOpen = !/\bcollapsed\b/.test(await page.locator('#navbar').getAttribute('class') || '');
      await expectFocusWithMenuOwner(page, page.locator(restoredOpen ? '#hideMenuButton' : '#showMenuButton'));
      await proveHome(page, restoredOpen, state.alignment, false);
    });
    await setMenu(page, open); await proveHome(page, open, state.alignment, false);
    await focusOutgoingMenu(page, page.locator(open ? '#hideMenuButton' : '#showMenuButton'));
    await sampleMenuTransition(page, async () => {
      await page.goForward();
      await expect(page.locator('.front-page-top-row')).toHaveCount(0);
      // Keep the ownership assertions here; the surrounding probe already samples.
      await proveDatasetMenuOwnership(page, false);
      const forwardOpen = !/\bcollapsed\b/.test(await navbar.getAttribute('class') || '');
      await expectFocusWithMenuOwner(page, forwardOpen ? page.locator('#hideMenuButton') : datasetMenu);
    });
    await sampleMenuTransition(page, () => page.goBack());
    await setMenu(page, !open); await proveHome(page, !open, state.alignment, false);
    // Cross the overlay boundary and check the independently remembered wide state.
    await page.setViewportSize({ width: 1851, height: 900 });
    await expect(page.locator('#navbar')).toHaveClass(/\bcollapsed\b/);
    await setMenu(page, true); await proveHome(page, true, state.alignment, false);
    // NAVBAR_WIDTH_THRESHOLD is 1850 and wide means innerWidth >= 1850, so 1849 is the first narrow width.
    await page.setViewportSize({ width: 1849, height: 900 });
    if (open) await expect(page.locator('#navbar')).toHaveClass(/\bcollapsed\b/);
    else await expect(page.locator('#navbar')).not.toHaveClass(/\bcollapsed\b/);
    await setMenu(page, false); await proveHome(page, false, state.alignment, false);
    // Reuse the same history entry at overlay, boundary and docked widths.
    // The dataset may own its hero opener, topbar opener or shell fallback.
    for (const width of [1280, 1850, 1851]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => {
        const stored = localStorage.getItem(window.innerWidth >= 1850 ? 'navVisibleWide' : 'navVisibleNarrow');
        return !document.getElementById('navbar')!.classList.contains('collapsed') === (stored === 'true');
      })).toBe(true);
      await setMenu(page, open);
      await focusOutgoingMenu(page, page.locator(open ? '#hideMenuButton' : '#showMenuButton'));
      let incoming: Locator;
      await sampleMenuTransition(page, async () => {
        await page.goForward();
        await expect(page.locator('.front-page-top-row')).toHaveCount(0);
        const datasetOpen = !/\bcollapsed\b/.test(await navbar.getAttribute('class') || '');
        incoming = datasetOpen ? page.locator('#hideMenuButton')
          : page.locator('[data-navbar-menu-button="true"]:visible, #showMenuButton:visible');
        await expect(incoming).toHaveCount(1); await expect(incoming).toBeVisible();
        await expect(incoming).toHaveAttribute('aria-hidden', 'false');
        await expect(incoming).toHaveAttribute('tabindex', '0');
        await expect(incoming).toHaveAccessibleName(/\S/);
        await expectFocusWithMenuOwner(page, incoming);
      });
      await focusOutgoingMenu(page, incoming!);
      await sampleMenuTransition(page, async () => {
        await page.goBack();
        await expect(page.locator('.front-page-top-row')).toBeVisible();
        const homeOpen = !/\bcollapsed\b/.test(await navbar.getAttribute('class') || '');
        await expectFocusWithMenuOwner(page, page.locator(homeOpen ? '#hideMenuButton' : '#showMenuButton'));
      });
    }
    expect(state.writes).toEqual([]);
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const viewport of [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 414, height: 896 }]) {
    test(`12 datasets ${viewport.width}×${viewport.height}/${theme}: phone Home drawer controls stay reachable`, async ({ page }) => {
      const state = await openHome(page, theme, 'fi', { name: 'Fintravel', ...viewport, datasetCount: 12 });
      await expect(page.locator('.front-page-top-row .hero-dataset-tabs__button')).toHaveCount(12);
      await setMenu(page, true);
      await proveHome(page, true, state.alignment, false);
      await provePhoneDrawerControls(page);
      await proveHome(page, false, state.alignment, false);
      expect(state.writes).toEqual([]);
    });
  }
  for (const language of ['fi', 'en']) {
    test(`native Home in ${language}/${theme}: matrix width, menu closed and open`, async ({ page }) => {
      const state = await openHome(page, theme, language);
      for (const open of [false, true, false, true, false]) {
        await setMenu(page, open); await proveHome(page, open, state.alignment, false);
      }
      await proveKeyboardMenu(page, state);
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
