// G26_frosted_bars.spec.ts
// Proves the frosted-bars experiment (WL182): an administrator's per-browser switch turns the menu,
// the dataset top bar and the filter panel into translucent blurred panes that let the background
// picture through, keeps their text readable, and restores today's look exactly when switched off.
// Uses the GET-only media fixture (no settings are saved) and the default signed-in storageState.
import { test, expect, type Page } from '@playwright/test';
import { installMediaTabFixture, openMediaTabView } from '../helpers/media-tab-fixture';
import { ensureNavbarVisible } from '../helpers/navbar';
import { openBigCard } from '../helpers/view-switch';

const KEY = 'filterest_experimental_bar_surface_v1';
const PANES = ['#navbar', '#navbar > .top-button-bar', '.content_div:not(.hidden) .dataset-shared-topbar'];

/** Computed paint values of the bar panes and of every element inside the menu. */
async function barPaint(page: Page) {
  return page.evaluate((panes) => {
    const out: Record<string, string[]> = {};
    for (const selector of panes) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const style = getComputedStyle(element);
      out[selector] = [style.backgroundColor, style.backgroundImage, style.backdropFilter];
    }
    document.querySelectorAll('#navbar *').forEach((element, index) => {
      const style = getComputedStyle(element);
      out[`#navbar *:${index}`] = [style.backgroundColor, style.backdropFilter, (element as SVGElement).getAttribute?.('fill') || ''];
    });
    return out;
  }, PANES);
}

const alphaOf = (colour: string) => {
  const match = colour.match(/\/\s*([\d.]+)\)$|rgba\([^)]*,\s*([\d.]+)\)$/);
  return match ? Number(match[1] ?? match[2]) : 1;
};

async function setSurface(page: Page, choice: 'frosted' | 'solid') {
  await page.evaluate(([key, value]) => {
    localStorage.setItem(key, value);
    if (value === 'frosted') document.documentElement.setAttribute('data-bar-surface', 'frosted');
    else document.documentElement.removeAttribute('data-bar-surface');
  }, [KEY, choice]);
  // Some menu backgrounds fade between values; compare only after every transition has ended.
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame);
    await Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {})));
  });
}

/**
 * Composed-pixel contrast of each visible menu label: the label's own colour against the most common
 * colour of the screenshot pixels around it, so whatever shows through the glass counts.
 */
async function menuLabelContrast(page: Page) {
  const labels = await page.locator('#navbar :is(.tab_button_text, .navbar-front-page-label, .animated-disclosure-title):visible').all();
  const ratios: { label: string; ratio: number }[] = [];
  for (const label of labels.slice(0, 8)) {
    const box = await label.boundingBox();
    if (!box || box.width < 8) continue;
    const shot = await page.screenshot({ clip: { x: box.x, y: Math.max(0, box.y - 4), width: box.width, height: box.height + 8 } });
    ratios.push(await label.evaluate(async (element, base64) => {
      // A Blob decode needs no image URL, so the page's image policy does not block it.
      const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const brush = canvas.getContext('2d', { willReadFrequently: true })!; brush.drawImage(image, 0, 0);
      const data = brush.getImageData(0, 0, canvas.width, canvas.height).data;
      const counts = new Map<string, number>();
      for (let i = 0; i < data.length; i += 4) {
        const key = `${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const [r, g, b] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(v => Number(v) * 8 + 4);
      brush.clearRect(0, 0, 1, 1); brush.fillStyle = getComputedStyle(element).color; brush.fillRect(0, 0, 1, 1);
      const text = [...brush.getImageData(0, 0, 1, 1).data];
      const luminance = (rgb: number[]) => rgb.slice(0, 3).map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const a = luminance(text), c = luminance([r, g, b]);
      return { label: (element.textContent || '').trim().slice(0, 24), ratio: (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05) };
    }, shot.toString('base64')));
  }
  return ratios;
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`G26 — Frosted bars (${theme})`, () => {
    test.beforeEach(async ({ page, context }) => {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await installMediaTabFixture(page, context, 1600, theme);
      await page.addInitScript(key => { if (localStorage.getItem(key) === null) localStorage.setItem(key, 'solid'); }, KEY);
    });

    test('the switch is in the administration tools, remembers the choice and follows to Home', async ({ page }) => {
      await openMediaTabView(page, 'dataset_media');
      await ensureNavbarVisible(page);
      const heading = page.locator('[data-testid="nav-group-admin-and-development-tools"]');
      await heading.scrollIntoViewIfNeeded();
      if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
      const toggle = page.locator('[data-testid="bar-surface-experiment-switch"] input');
      await expect(toggle).toBeVisible();
      // The media fixture reads the interface in Finnish; the label comes from the DB 9.13.9 seed.
      await expect(page.locator('[data-testid="bar-surface-experiment-switch"] [data-lang-key="bar_surface_frosted_experiment"]'))
        .toHaveText('Huurretut palkit (kokeilu)');
      await expect(toggle).not.toBeChecked();
      await expect(page.locator('html')).not.toHaveAttribute('data-bar-surface', 'frosted');
      await toggle.click();
      await expect(page.locator('html')).toHaveAttribute('data-bar-surface', 'frosted');
      await page.reload({ waitUntil: 'domcontentloaded' });
      // The first-paint script marks the root before the application starts.
      await expect(page.locator('html')).toHaveAttribute('data-bar-surface', 'frosted');
      await openMediaTabView(page, 'home');
      await expect(page.locator('html')).toHaveAttribute('data-bar-surface', 'frosted');
      await ensureNavbarVisible(page);
      expect(await page.locator('#navbar').evaluate(element => getComputedStyle(element).backdropFilter)).toContain('blur');
    });

    test('frosted panes let the picture through; switching off restores today\'s look exactly', async ({ page }) => {
      await openMediaTabView(page, 'dataset_media');
      await ensureNavbarVisible(page);
      const solid = await barPaint(page);
      await setSurface(page, 'frosted');
      const frosted = await barPaint(page);
      // The menu pane is translucent and blurred; its plain layers are transparent; the controls row stays denser.
      expect(alphaOf(frosted['#navbar'][0])).toBeCloseTo(theme === 'light' ? 0.78 : 0.8, 2);
      expect(frosted['#navbar'][2]).toMatch(/blur\(16px\) saturate/);
      expect(alphaOf(frosted['#navbar > .top-button-bar'][0])).toBeCloseTo(0.6, 2);
      expect(frosted['#navbar > .top-button-bar'][2]).toBe('blur(8px)');
      const topbar = frosted['.content_div:not(.hidden) .dataset-shared-topbar'];
      if (topbar) expect(topbar[2]).toMatch(/blur\(16px\) saturate/);
      const opaqueLayers = await page.evaluate(() => [...document.querySelectorAll(
        '#navbar .navbar-disclosure-section, #navbar .navbar-disclosure-section > .navbar-section-heading',
      )].map(element => getComputedStyle(element).backgroundColor).filter(colour => colour !== 'rgba(0, 0, 0, 0)'));
      expect(opaqueLayers).toEqual([]);
      // Composed-pixel contrast: normal text needs 4.5:1 over whatever shows through.
      const contrast = await menuLabelContrast(page);
      expect(contrast.length, 'menu labels were measured').toBeGreaterThan(2);
      for (const { label, ratio } of contrast) expect(ratio, label).toBeGreaterThanOrEqual(4.5);
      await setSurface(page, 'solid');
      expect(await barPaint(page)).toEqual(solid);
    });

    test('the bars stay solid while an article is open', async ({ page }) => {
      await openMediaTabView(page, 'dataset_media');
      await setSurface(page, 'frosted');
      expect(await page.locator('#navbar').evaluate(element => getComputedStyle(element).backdropFilter)).toContain('blur');
      expect(await openBigCard(page)).toBe(true);
      await expect.poll(() => page.locator('#navbar').evaluate(element => getComputedStyle(element).backdropFilter)).toBe('none');
    });

    test('forced colours and a request for more contrast keep the solid bars', async ({ page }) => {
      await openMediaTabView(page, 'dataset_media');
      const solid = await page.locator('#navbar').evaluate(element => getComputedStyle(element).backgroundColor);
      await setSurface(page, 'frosted');
      for (const media of [{ contrast: 'more' as const }, { forcedColors: 'active' as const }]) {
        await page.emulateMedia(media);
        const style = await page.locator('#navbar').evaluate(element => {
          const computed = getComputedStyle(element); return [computed.backgroundColor, computed.backdropFilter];
        });
        expect(style[1], JSON.stringify(media)).toBe('none');
        if (!('forcedColors' in media)) expect(style[0]).toBe(solid);
        await page.emulateMedia({ contrast: 'no-preference', forcedColors: 'none' });
      }
    });
  });
}
