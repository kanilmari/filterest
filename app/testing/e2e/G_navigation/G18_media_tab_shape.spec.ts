// G18_media_tab_shape.spec.ts
// Proves Home and dataset buttons share the current-view media shape rule.
// GET-only fixtures shape Home media and the two existing datasets' tab metadata.
// Default signed-in storageState; only read-only permission POSTs pass the write guard.
import { test, expect, type Locator, type Page } from '@playwright/test';
import { installMediaTabFixture, openMediaTabView, MEDIA_DATASET, PLAIN_DATASET } from '../helpers/media-tab-fixture';
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

async function expectButtons(page: Page, root: string, media: boolean, measurements: unknown[]) {
  const buttons = page.locator(`${root} .hero-dataset-tabs__button:visible, ${root} .top-nav-home-button:visible`);
  expect(await buttons.count()).toBeGreaterThan(0);
  for (const button of await buttons.all()) {
    const radius = await button.evaluate(element => Number.parseFloat(getComputedStyle(element).borderRadius));
    if (media) expect(radius).toBe(0); else expect(radius).toBeGreaterThan(0);
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

async function expectMenuShapes(page: Page, media: boolean, width: number, measurements: unknown[] = []) {
  await ensureNavbarVisible(page);
  const tabs = page.locator('#navmenu .navtablinks');
  expect(await tabs.count()).toBeGreaterThanOrEqual(2);
  // The overlay layouts already use rectangles without media; the docked
  // 1920px proof below checks the historic connector curves as well.
  const rectangular = media || width < 1850;
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
      measurements.push({ menu: await tab.getAttribute('data-id'), state, media, ...contrast });
    }
    await page.mouse.move(0, 0);
  }
}

for (const width of [1440, 390]) for (const theme of ['light', 'dark'] as const) {
  test(`current-view media shapes and label contrast at ${width}px in ${theme}`, async ({ page, context }, info) => {
    test.setTimeout(120_000);
    const policy = await installMediaTabFixture(page, context, width, theme);
    const measurements: unknown[] = [];
    try {
      for (const home of ['video', 'image', 'none', 'hidden'] as const) {
        policy.home = home;
        await openMediaTabView(page, home === 'video' ? 'home_video' : 'home');
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
        const media = home === 'video' || home === 'image';
        await expect(page.locator('body')).toHaveAttribute('data-view-has-presentation-media', String(media));
        await expectButtons(page, '#front_page_container', media, measurements);
        await expectMenuShapes(page, media, width, measurements);
      }
      for (const view of ['dataset_media', 'dataset_plain'] as const) {
        await openMediaTabView(page, view);
        const media = view === 'dataset_media', dataset = media ? MEDIA_DATASET : PLAIN_DATASET;
        await expect(page.locator('body')).toHaveAttribute('data-view-has-presentation-media', String(media));
        await expectButtons(page, `#${dataset}_tab_parts_container`, media, measurements);
        await expectMenuShapes(page, media, width, measurements);
      }
      // These in-page switches catch stale flags that cold loads cannot expose.
      policy.home = 'video';
      await page.locator('#navbarFrontPage a').click();
      await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
      await expect(page.locator('body')).toHaveAttribute('data-view-has-presentation-media', 'true');
      // Menu Home is an inside click: close its drawer through the real control
      // at both widths, then wait until the destination is no longer covered.
      await page.locator('#hideMenuButton').click();
      await expect(page.locator('#navbar')).toHaveClass(/\bcollapsed\b/);
      await expect(page.locator('#navbar')).not.toBeInViewport();
      await expect(page.locator('#hideMenuButton')).toBeHidden();
      await page.locator(`#front_page_container [data-dataset="${PLAIN_DATASET}"]`).click();
      await expect(page.locator('body')).toHaveAttribute('data-view-has-presentation-media', 'false');
      await ensureNavbarVisible(page);
      await page.locator(`#navmenu [data-id="${MEDIA_DATASET}"]`).click();
      await expect(page.locator('body')).toHaveAttribute('data-view-has-presentation-media', 'true');
    } finally {
      await info.attach('label-contrast', { body: JSON.stringify({ width, theme, measurements, blocked: policy.blocked }, null, 2), contentType: 'application/json' });
    }
  });
}

test('docked side-menu connector follows the same flag and restores its curves', async ({ page, context }) => {
  test.setTimeout(90_000);
  const policy = await installMediaTabFixture(page, context, 1920, 'light');
  for (const home of ['video', 'none'] as const) {
    policy.home = home;
    await openMediaTabView(page, home === 'video' ? 'home_video' : 'home');
    await expectMenuShapes(page, home === 'video', 1920);
  }
  await openMediaTabView(page, 'dataset_media');await expectMenuShapes(page, true, 1920);
  await openMediaTabView(page, 'dataset_plain');await expectMenuShapes(page, false, 1920);
});
