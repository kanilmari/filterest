// G18_media_tab_shape.spec.ts
// Proves top-row buttons stay rounded while the side menu keeps one shape decided by its datasets' pictures.
// GET-only fixtures shape Home media, the two existing datasets' pictures and their catalogue settings.
// Default signed-in storageState, or none for the visitor cases; only read-only permission POSTs pass the write guard.
import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { installMediaTabFixture, openMediaTabView, useDatasetPicture, MEDIA_DATASET, PLAIN_DATASET } from '../helpers/media-tab-fixture';
import { ensureNavbarVisible } from '../helpers/navbar';

async function labelContrast(button: Locator) {
  return button.evaluate(element => {
    const style = getComputedStyle(element);
    const labelStyle = getComputedStyle(element.querySelector('.tab_button_text, .hero-dataset-tabs__label, .navbar-front-page-label') || element);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const brush = canvas.getContext('2d', { willReadFrequently: true })!;
    const rgba = (colour: string) => {
      brush.clearRect(0, 0, 1, 1); brush.fillStyle = colour; brush.fillRect(0, 0, 1, 1);
      return [...brush.getImageData(0, 0, 1, 1).data];
    };
    const luminance = (rgb: number[]) => rgb.slice(0, 3).map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const fillPath = element.querySelector('.navtab-fill-path');
    const fill = fillPath ? getComputedStyle(fillPath).fill : 'none';
    const surface = fill !== 'none' ? fill : style.backgroundColor;
    const foreground = rgba(labelStyle.color), background = rgba(surface);
    const label = foreground.slice(0, 3).map((value, index) =>
      value * foreground[3] / 255 + background[index] * (1 - foreground[3] / 255));
    const a = luminance(label), b = luminance(background);
    const tokenProbe = document.createElement('span');
    tokenProbe.style.color = 'var(--color-brand)';
    tokenProbe.style.backgroundColor = 'color-mix(in srgb, var(--color-brand) 12%, var(--button_bg_color))';
    element.append(tokenProbe);
    const tokens = getComputedStyle(tokenProbe);
    const brand = tokens.color, interaction = tokens.backgroundColor;
    tokenProbe.style.backgroundColor = 'var(--navigation-background, var(--button_bg_color))';
    tokenProbe.style.color = 'var(--border_color)';
    const ownBackground = tokens.backgroundColor, ownBorder = tokens.color;
    tokenProbe.remove();
    // Native Home keeps this higher-specificity surface even in Home's hero
    // row. Dataset Home acquires the hero button class only while in that row.
    const nativeHome = element.matches('.navbar-front-page-link.top-nav-home-button:not(.hero-dataset-tabs__button)');
    const interactive = !nativeHome && element.matches(':hover, :focus-visible, [aria-current="page"]');
    return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      alpha: background[3], foreground: labelStyle.color, background: surface,
      border: style.borderTopColor, brand, interaction,
      expectedBackground: interactive ? interaction : ownBackground,
      expectedBorder: interactive ? brand : ownBorder,
      surface: nativeHome ? 'native-home' : element.matches('.hero-dataset-tabs__button') ? 'hero-button' : 'menu-tab',
      host: element.parentElement?.className,
      selector: element.tagName.toLowerCase() + [...element.classList].map(name => `.${name}`).join('')
        + (element.hasAttribute('data-dataset') ? `[data-dataset="${element.getAttribute('data-dataset')}"]` : ''),
      selected: element.getAttribute('aria-current') === 'page',
      outline: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineAlpha: rgba(style.outlineColor)[3] };
  });
}

const topRowButtons = (page: Page, root: string) =>
  page.locator(`${root} .hero-dataset-tabs__button:visible, ${root} .top-nav-home-button:visible`);

async function expectButtons(page: Page, root: string, media: boolean, measurements: unknown[]) {
  const buttons = topRowButtons(page, root);
  expect(await buttons.count()).toBeGreaterThan(0);
  for (const button of await buttons.all()) {
    const radius = await button.evaluate(element => Number.parseFloat(getComputedStyle(element).borderRadius));
    expect(radius).toBeGreaterThan(0);
    await button.evaluate((element: HTMLElement) => element.blur());
    await page.mouse.move(0, 0);
    for (const state of ['rest', 'hover', 'focus'] as const) {
      if (state === 'hover') await button.hover();
      if (state === 'focus') {
        await page.mouse.move(0, 0);
        await page.keyboard.press('Tab'); await button.focus();
      }
      let contrast = await labelContrast(button);
      // Save identity and actual rest/hover colours before polling; the final
      // attachment also survives a failed poll and includes its last sample.
      const measurement = { root, label: (await button.textContent())?.trim(), state, media, ...contrast };
      measurements.push(measurement);
      await expect.poll(async () => {
        contrast = await labelContrast(button);
        Object.assign(measurement, contrast);
        return { background: contrast.background === contrast.expectedBackground,
          border: contrast.border === contrast.expectedBorder };
      }, { message: `${measurement.selector} (${measurement.label}) ${state} in ${measurement.host}` })
        .toEqual({ background: true, border: true });
      expect(contrast.alpha, 'Button surface stays opaque').toBe(255);
      expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(4.5);
      if (state === 'focus') {
        await expect(button).toBeFocused();
        expect(contrast.outline).not.toMatch(/^(none|hidden)$/);
        expect(contrast.outlineWidth).toBeGreaterThan(0);
        expect(contrast.outlineAlpha).toBeGreaterThan(0);
      }
    }
    await button.evaluate((element: HTMLElement) => element.blur());
    await page.mouse.move(0, 0);
  }
}

/** The side menu's one shape (side_menu_tab_shape.js, owner 2026-11-22); narrow and overlay menus keep rows. */
async function expectMenuShapes(page: Page, boxLike: boolean, width: number, measurements: unknown[] = []) {
  await ensureNavbarVisible(page);
  await expect(page.locator('body')).toHaveAttribute('data-side-menu-tab-shape', boxLike ? 'box' : 'rounded');
  const tabs = page.locator('#navmenu .navtablinks');
  expect(await tabs.count()).toBeGreaterThanOrEqual(1);
  const rectangular = boxLike || width < 1850;
  for (const tab of await tabs.all()) {
    await expect(tab).toHaveAttribute('data-tab-presentation', rectangular ? /^button-/ : /^tab-/);
    const paths = tab.locator('.navtab-shape-path');
    expect(await paths.count()).toBeGreaterThan(0);
    for (const path of await paths.all()) {
      await expect(path).toHaveAttribute('d', rectangular ? /A 0 0/ : /A 7 7/);
      const arcs = (await path.getAttribute('d'))!.match(/A [\d.]+ [\d.]+/g);
      expect(arcs).toEqual(Array(4).fill(rectangular ? 'A 0 0' : 'A 7 7'));
    }
    for (const state of ['rest', 'hover'] as const) {
      if (state === 'hover') await tab.hover();
      const contrast = await labelContrast(tab);
      expect(contrast.alpha).toBe(255);
      expect(contrast.ratio, JSON.stringify(contrast)).toBeGreaterThanOrEqual(4.5);
      measurements.push({ menu: await tab.getAttribute('data-id'), state, boxLike, ...contrast });
    }
    await page.mouse.move(0, 0);
  }
}

/** Records every change between rounded tabs and button rows in the side menu, from the first paint on. */
async function trackMenuShapeFamilies(page: Page) {
  await page.addInitScript(() => {
    const families: string[] = [];
    (window as unknown as { __sideMenuFamilies: string[] }).__sideMenuFamilies = families;
    new MutationObserver(records => {
      for (const { target } of records) {
        const tab = target as HTMLElement;
        if (!tab.matches?.('#navmenu .navtablinks')) continue;
        const family = String(tab.dataset.tabPresentation || '').split('-')[0];
        if (family && families[families.length - 1] !== family) families.push(family);
      }
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-tab-presentation'] });
  });
}
const menuShapeFamilies = (page: Page) =>
  page.evaluate(() => (window as unknown as { __sideMenuFamilies: string[] }).__sideMenuFamilies);

async function saveShot(page: Page, info: TestInfo, name: string) {
  // Saved before the shape checks, so a failing run still shows the menu it drew.
  await ensureNavbarVisible(page);
  const shot = info.outputPath(`${name}.png`);
  await page.screenshot({ path: shot });
  await info.attach(name, { path: shot, contentType: 'image/png' });
}

for (const width of [1440, 390]) for (const theme of ['light', 'dark'] as const) {
  test(`rounded top row, one side-menu shape and label contrast at ${width}px in ${theme}`, async ({ page, context }, info) => {
    test.setTimeout(120_000);
    // The media dataset's background shows, so the whole side menu is box-like on every page.
    const policy = await installMediaTabFixture(page, context, width, theme);
    const measurements: unknown[] = [];
    try {
      for (const home of ['video', 'image', 'none', 'hidden'] as const) {
        policy.home = home;
        await openMediaTabView(page, home === 'video' ? 'home_video' : 'home');
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
        const media = home === 'video' || home === 'image';
        await expectButtons(page, '#front_page_container', media, measurements);
        await expectMenuShapes(page, true, width, measurements);
      }
      for (const view of ['dataset_media', 'dataset_plain'] as const) {
        await openMediaTabView(page, view);
        const media = view === 'dataset_media', dataset = media ? MEDIA_DATASET : PLAIN_DATASET;
        const root = `#${dataset}_tab_parts_container`;
        // K529: a phone's dataset view has no top-row buttons: Main hides the hero row and Home is off the bar.
        if (width <= 700) await expect(topRowButtons(page, root)).toHaveCount(0);
        else await expectButtons(page, root, media, measurements);
        await expectMenuShapes(page, true, width, measurements);
      }
      // These in-page switches catch a shape that follows the page instead of the menu.
      policy.home = 'video';
      await page.locator('#navbarFrontPage a').click();
      await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
      await expect(page.locator('body')).toHaveAttribute('data-side-menu-tab-shape', 'box');
      // Menu Home is an inside click: close its drawer through the real control
      // at both widths, then wait until the destination is no longer covered.
      await page.locator('#hideMenuButton').click();
      await expect(page.locator('#navbar')).toHaveClass(/\bcollapsed\b/);
      await expect(page.locator('#navbar')).not.toBeInViewport();
      await expect(page.locator('#hideMenuButton')).toBeHidden();
      await page.locator(`#front_page_container [data-dataset="${PLAIN_DATASET}"]`).click();
      await expect(page.locator('body')).toHaveAttribute('data-side-menu-tab-shape', 'box');
      await ensureNavbarVisible(page);
      await page.locator(`#navmenu [data-id="${MEDIA_DATASET}"]`).click();
      await expect(page.locator('body')).toHaveAttribute('data-side-menu-tab-shape', 'box');
    } finally {
      await info.attach('label-contrast', { body: JSON.stringify({ width, theme, measurements, blocked: policy.blocked }, null, 2), contentType: 'application/json' });
    }
  });
}

// Owner rule (2026-11-22): rounded side-menu tabs only when none of the viewer's menu datasets shows a picture in
// the light or the dark theme; one such dataset makes every tab box-like, in every theme, on every page, Home
// included (Home's own picture or video does not count). A picture that is set but hidden does not count.
const MENU_CASES = [
  { picture: 'cover_dark_only', boxLike: true },
  { picture: 'background_hidden', boxLike: false },
  { picture: 'cover_theme_hidden', boxLike: false },
] as const;
for (const { picture, boxLike } of MENU_CASES) for (const theme of ['light', 'dark'] as const) {
  test(`administrator's side menu over a ${picture.replaceAll('_', ' ')} picture is ${boxLike ? 'box-like' : 'rounded'} in ${theme}, Home included`, async ({ page, context }, info) => {
    test.setTimeout(90_000);
    const policy = await installMediaTabFixture(page, context, 1920, theme);
    await useDatasetPicture(page, policy, picture);
    await trackMenuShapeFamilies(page);
    await openMediaTabView(page, 'dataset_picture');
    await saveShot(page, info, `admin-${picture}-${theme}-dataset`);
    await expectMenuShapes(page, boxLike, 1920);
    // In-page navigation to the plain dataset, to Home with its video and back never changes the shape.
    await page.locator(`#navmenu [data-id="${PLAIN_DATASET}"]`).click();
    await expect(page.locator(`#${PLAIN_DATASET}_tab_parts_container`)).toBeVisible();
    await expectMenuShapes(page, boxLike, 1920);
    policy.home = 'video';
    await page.locator('#navbarFrontPage a').click();
    await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
    await saveShot(page, info, `admin-${picture}-${theme}-home`);
    await expectMenuShapes(page, boxLike, 1920);
    await page.locator(`#navmenu [data-id="${MEDIA_DATASET}"]`).click();
    await expect(page.locator(`#${MEDIA_DATASET}_tab_parts_container`)).toBeVisible();
    await expectMenuShapes(page, boxLike, 1920);
    expect(await menuShapeFamilies(page)).toEqual([boxLike ? 'button' : 'tab']);
  });
}

test.describe('visitor', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  // Owner 2026-11-22: the visitor's search hero takes the cover from the results, as the background does; the
  // menu counts that cover, so the visitor sees the picture that makes the tabs box-like.
  test("visitor sees the dataset cover the menu counts, from the results alone", async ({ page, context }, info) => {
    test.setTimeout(90_000);
    const policy = await installMediaTabFixture(page, context, 1920, 'dark', { visitor: true });
    policy.dataset = 'cover_dark_only';
    await openMediaTabView(page, 'dataset_picture');
    const hero = page.locator(`#${MEDIA_DATASET}_tab_parts_container .filterbar-inline-hero`);
    await expect(hero).toHaveClass(/filterbar-inline-hero--has-cover/);
    await expect.poll(() => hero.evaluate(element => getComputedStyle(element, '::before').opacity)).toBe('0.3');
    await saveShot(page, info, 'visitor-cover-dark');
    await expectMenuShapes(page, true, 1920);
  });
  // The set is each viewer's own visible tabs: a pictured dataset the visitor may not read does not count.
  for (const { readable, boxLike } of [{ readable: true, boxLike: true }, { readable: false, boxLike: false }]) {
    test(`visitor's side menu ${readable ? 'with' : 'without'} the dataset whose cover shows in the dark theme is ${boxLike ? 'box-like' : 'rounded'}`, async ({ page, context }, info) => {
      test.setTimeout(90_000);
      const policy = await installMediaTabFixture(page, context, 1920, 'light', { visitor: true });
      policy.dataset = 'cover_dark_only';
      if (!readable) policy.unreadable = [MEDIA_DATASET];
      await trackMenuShapeFamilies(page);
      await openMediaTabView(page, 'dataset_plain');
      await expect(page.locator(`#navmenu [data-id="${MEDIA_DATASET}"]`)).toHaveCount(readable ? 1 : 0);
      await saveShot(page, info, `visitor-${readable ? 'with' : 'without'}-picture-dataset`);
      await expectMenuShapes(page, boxLike, 1920);
      await page.locator('#navbarFrontPage a').click();
      await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
      await expectMenuShapes(page, boxLike, 1920);
      expect(await menuShapeFamilies(page)).toEqual([boxLike ? 'button' : 'tab']);
    });
  }
});
