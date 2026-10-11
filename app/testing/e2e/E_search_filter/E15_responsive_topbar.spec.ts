// E15_responsive_topbar.spec.ts
// Verifies measured navigation, phone search toggling and filterbar appearance.
// Exercises an existing readable dataset on the native instance without data writes.
// Requires FILTEREST_E2E_TOPBAR_DATASET; preserves shared layout with temporary reveals.
import { expect, test, type Page } from '@playwright/test';
import { revealActiveFilterbarSection, waitForActiveFilterbarLayout } from '../helpers/filterbar';

const DATASET = process.env.FILTEREST_E2E_TOPBAR_DATASET || '';
const COPY = {
  fi: ['Näytä haku', 'Piilota haku', 'Tyyli- ja väriasetukset'],
  en: ['Show search', 'Hide search', 'Style and color settings'],
  'zh-CN': ['显示搜索', '隐藏搜索', '样式和颜色设置'],
  'zh-TW': ['顯示搜尋', '隱藏搜尋', '樣式與色彩設定'],
  'zh-HK': ['顯示搜尋', '隱藏搜尋', '樣式及顏色設定'],
};

async function servedTopbarCopy(page: Page, requestedLanguage: string) {
  // Disabled installation locales legitimately use the served English dictionary.
  // Read that independent source, never the label on the control under test.
  await expect(page.locator('body')).not.toHaveClass(/\bloading\b/);
  const activeLanguage = await page.locator('html').getAttribute('lang') || 'en';
  const response = await page.request.get(`/api/translations?lang=${encodeURIComponent(activeLanguage)}`);
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  const dictionary = payload.translations || payload;
  const served = ['filterbar_show_search', 'filterbar_hide_search', 'filterbar_style_and_colors']
    .map(key => dictionary[key] as string);
  expect(served.every(label => typeof label === 'string' && Boolean(label.trim()) && !label.includes('filterbar_'))).toBe(true);
  // The server can return English for a disabled canonical locale with HTTP 200,
  // while document.lang still names the requested Chinese locale.
  if (requestedLanguage === 'fi' || requestedLanguage === 'en') expect(served).toEqual(COPY[requestedLanguage]);
  expect(served[0]).not.toBe(served[1]);
  return served;
}

async function geometry(page: Page) {
  return page.locator('.dataset-shared-topbar:visible').evaluate(bar => {
    const target = (selector: string) => {
      const box = bar.querySelector(selector)!.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const listing = bar.closest('.tab_parts_container')!.querySelector('.tab-content-body')!.getBoundingClientRect();
    return { menu: target('[data-testid="shared-topbar-menu-button"]'),
      search: target('[data-testid="mobile-search-toggle"]'), filter: target('[data-testid="filterbar-toggle"]'),
      listingTop: listing.top };
  });
}

test.describe('guest phone toolbar and style controls', () => {
  test.use({ storageState: { cookies: [], origins: [] }, hasTouch: true });
  for (const language of Object.keys(COPY)) for (const theme of ['light', 'dark'] as const) {
    test(`#901b/#902: phone search button and translated style (${language}, ${theme})`, async ({ page }, info) => {
      test.skip(!/^[a-z][a-z0-9_]{0,62}$/.test(DATASET), 'Set FILTEREST_E2E_TOPBAR_DATASET to an existing readable dataset.');
      test.skip(info.project.metadata.screenWidth !== 'mobile' || info.project.metadata.cardView === 'big', 'Phone proof.');
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await page.addInitScript(({ language, theme }) => {
        localStorage.setItem('chosen_language', language); localStorage.setItem('theme', theme);
      }, { language, theme });
      await page.goto(`/${DATASET}?view=card`);
      await waitForActiveFilterbarLayout(page);
      const labels = await servedTopbarCopy(page, language);
      const bar = page.locator('.dataset-shared-topbar:visible');
      await expect(bar).toBeVisible();
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
      const identity = bar.getByTestId('mobile-site-identity');
      const input = bar.locator('.dataset-search-input');
      const toggle = bar.getByTestId('mobile-search-toggle');
      await expect(identity).toBeVisible(); await expect(identity).not.toHaveText('');
      await expect(bar.locator('.dataset-shared-topbar__dataset-title')).toBeHidden();
      await expect(input).toBeHidden(); await expect(toggle).toHaveAccessibleName(labels[0]);
      await expect(toggle).toHaveAttribute('data-aria-label-lang-key', 'filterbar_show_search');
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      const before = await geometry(page);
      expect(before.search.x + before.search.width).toBeLessThanOrEqual(before.filter.x);
      expect(before.filter.x - before.search.x - before.search.width).toBeLessThanOrEqual(9);
      await toggle.tap(); await expect(input).toBeFocused();
      await expect(toggle).toHaveAccessibleName(labels[1]);
      await expect(toggle).toHaveAttribute('data-aria-label-lang-key', 'filterbar_hide_search');
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      expect(await geometry(page)).toEqual(before); await expect(identity).toBeVisible();
      await input.fill('Helsinki'); const url = page.url();
      await input.press('Escape'); await expect(input).toBeHidden(); await expect(toggle).toBeFocused();
      expect(page.url()).toBe(url); expect(await geometry(page)).toEqual(before);
      await toggle.press('Enter'); await expect(input).toBeFocused(); await expect(input).toHaveValue('Helsinki');
      await toggle.tap(); await expect(input).toBeHidden();
      const scrollable = page.locator('.scrollable_content:visible').first();
      await scrollable.evaluate(element => { element.scrollTop = 300; element.dispatchEvent(new Event('scroll')); });
      await expect(input).toBeHidden(); await expect(identity).toBeVisible();
      await expect(bar.getByTestId('shared-topbar-menu-button')).toBeVisible();
      await expect(bar.getByTestId('filterbar-toggle')).toBeVisible();
      const style = await revealActiveFilterbarSection(page, 'style');
      await expect(style.locator('[data-lang-key="filterbar_style_and_colors"]')).toHaveText(labels[2]);
      await expect(style.getByTestId('filterbar-theme-toggle')).toBeVisible();
      await expect(style.locator('.language-button')).toBeVisible();
      await style.locator('.language-button').press('Enter');
      await expect(style.locator('.floating-language-panel')).toBeVisible();
      await style.locator('.language-button').press('Escape');
      await expect(style.locator('.floating-language-panel')).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});

test.describe('measured tablet and desktop navigation', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('#901a: whole buttons progressively hide and all menu destinations survive', async ({ page }, info) => {
    test.skip(!/^[a-z][a-z0-9_]{0,62}$/.test(DATASET), 'Set FILTEREST_E2E_TOPBAR_DATASET.');
    test.skip(info.project.metadata.cardView === 'big', 'Navigation does not depend on card presentation.');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${DATASET}?view=card`);
    await waitForActiveFilterbarLayout(page);
    const tabs = page.locator(`.filterbar-inline-hero[data-filterbar-inline-hero-for="${DATASET}"] .hero-dataset-tabs`);
    await expect.poll(() => tabs.locator(':scope > button').count()).toBeGreaterThan(1);
    await expect(tabs).toBeVisible();
    const destinations = await tabs.locator(':scope > button').evaluateAll(buttons =>
      buttons.map(button => (button as HTMLElement).dataset.dataset!));
    expect(destinations.length, 'The native dataset needs at least two main navigation destinations.').toBeGreaterThan(1);
    // Restrict the actual row at a fixed viewport: fitting must follow measured room, not a breakpoint.
    const { widths, gap } = await tabs.evaluate(element => ({
      gap: Number.parseFloat(getComputedStyle(element).columnGap) || 0,
      widths: [...element.querySelectorAll(':scope > button')].map(button => {
        const target = button as HTMLElement, wasHidden = target.hidden, previousStyle = target.style.cssText;
        target.hidden = false;
        target.style.cssText += ';position:absolute;visibility:hidden;display:inline-flex;width:max-content;max-width:none;';
        const width = target.getBoundingClientRect().width;
        target.style.cssText = previousStyle; target.hidden = wasHidden;
        return width;
      }),
    }));
    expect(widths.every(width => width > 0)).toBe(true);
    const two = widths[0] + widths[1] + gap;
    await tabs.evaluate((element, width) => { (element as HTMLElement).style.width = `${width}px`; }, two + 1);
    await expect(tabs.locator(':scope > button:visible')).toHaveCount(2);
    await tabs.evaluate((element, width) => { (element as HTMLElement).style.width = `${width}px`; }, widths[0] + 1);
    await expect(tabs.locator(':scope > button:visible')).toHaveCount(1);
    await tabs.evaluate(element => { (element as HTMLElement).style.width = '1px'; });
    await expect(tabs.locator(':scope > button:visible')).toHaveCount(0);
    await tabs.evaluate(element => { (element as HTMLElement).style.removeProperty('width'); });
    for (const width of [1440, 1100, 900, 768, 701, 700, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      if (width <= 700) await expect(tabs).toBeHidden();
      else await expect.poll(() => tabs.evaluate(element => [...element.querySelectorAll('button:not([hidden])')]
        .every(button => {
          const row = element.getBoundingClientRect(), box = button.getBoundingClientRect();
          return box.left >= row.left - 1 && box.right <= row.right + 1;
        }))).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.locator('.dataset-shared-topbar:visible [data-testid="shared-topbar-menu-button"]').click();
    await expect(page.locator('#navbar')).not.toHaveClass(/collapsed/);
    const menuDatasets = await page.locator('#navbar .navtablinks').evaluateAll(buttons =>
      buttons.map(button => (button as HTMLElement).dataset.id));
    for (const destination of destinations) expect(menuDatasets).toContain(destination);
  });
});

test('#901b: authorized gear and palette open from style; no top-row editing controls', async ({ page }, info) => {
  test.skip(!/^[a-z][a-z0-9_]{0,62}$/.test(DATASET), 'Set FILTEREST_E2E_TOPBAR_DATASET to an administrator-readable dataset.');
  test.skip(info.project.metadata.cardView === 'big', 'Shared style controls.');
  await page.goto(`/${DATASET}?view=card`);
  const style = await revealActiveFilterbarSection(page, 'style');
  const gear = style.getByTestId('dataset-header-config-hero-button');
  await expect(gear).toBeVisible();
  await gear.focus(); await gear.press('Enter');
  await expect(page.getByTestId('dataset-header-config-modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dataset-header-config-modal')).toBeHidden();
  const palette = style.getByTestId('dataset-cover-test-palette-button');
  await expect(palette).toBeVisible(); await palette.focus(); await palette.press('Enter');
  await expect(page.getByTestId('dataset-cover-test-palette')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dataset-cover-test-palette')).toBeHidden();
  await expect(page.locator('.filterbar-inline-hero__top-row [data-testid="dataset-header-config-hero-button"], .filterbar-inline-hero__top-row [data-testid="dataset-cover-test-palette-button"]')).toHaveCount(0);
});
