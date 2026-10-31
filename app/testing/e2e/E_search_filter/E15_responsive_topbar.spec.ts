// E15_responsive_topbar.spec.ts
// Verifies measured navigation, phone search toggling and filterbar appearance.
// Exercises an existing readable dataset on the native instance without data writes.
// Requires FILTEREST_E2E_TOPBAR_DATASET; preserves shared layout with temporary reveals.
import { expect, test, type Page } from '@playwright/test';
import { revealActiveFilterbarSection, waitForActiveFilterbarLayout } from '../helpers/filterbar';
import { assertPhoneHeroSpacing } from '../helpers/phone-hero-spacing';
import { installHomePolicy } from '../helpers/home-policy-fixture';

const DATASET = process.env.FILTEREST_E2E_TOPBAR_DATASET || '';
const LANGUAGES = ['fi', 'en', 'zh-CN', 'zh-TW', 'zh-HK'];

async function topbarCopyForLanguage(page: Page, language: string) {
  // Read language-key values, including site-authored copy, rather than duplicate seed strings.
  // This source is independent of the label on the control under test.
  const response = await page.request.get(`/api/translations?lang=${encodeURIComponent(language)}`);
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  const dictionary = payload.translations || payload;
  const served = ['filterbar_show_search', 'filterbar_hide_search', 'filterbar_style_and_colors']
    .map(key => dictionary[key] as string);
  expect(served.every(label => typeof label === 'string' && Boolean(label.trim()) && !label.includes('filterbar_'))).toBe(true);
  expect(served[0]).not.toBe(served[1]);
  return served;
}

async function servedTopbarCopy(page: Page, requestedLanguage: string) {
  await expect(page.locator('body')).not.toHaveClass(/\bloading\b/);
  // Public selector eligibility: frontend/core_components/lang/ui_language_catalog.js:90-99.
  const response = await page.request.get('/api/ui-languages');
  expect(response.ok(), 'Public site-language catalogue must be available.').toBe(true);
  const { languages } = await response.json() as { languages: Array<{
    language_code: string; is_enabled: boolean; public_selector_ready: boolean; is_default: boolean;
  }> };
  expect(Array.isArray(languages), 'Public site-language catalogue must contain languages.').toBe(true);
  const enabled = languages.filter(language => language.is_enabled && language.public_selector_ready);
  const defaults = enabled.filter(language => language.is_default);
  expect(defaults, 'Public site-language catalogue must have one enabled default.').toHaveLength(1);
  const codes = enabled.map(language => language.language_code);
  // Startup uses saved preference -> browser -> site default (frontend/main.js:80-85,
  // state_stores/lang_preference_reader.js:72-84). This group's browser locale is en-US.
  const fallback = codes.includes('en') ? 'en' : defaults[0].language_code;
  const intendedLanguage = codes.includes(requestedLanguage) ? requestedLanguage : fallback;
  await expect(page.locator('html'),
    `Requested ${requestedLanguage}; expected ${intendedLanguage} (${codes.includes(requestedLanguage)
      ? 'enabled on this site' : 'unavailable in the public selector; browser/site-default fallback'}).`)
    .toHaveAttribute('lang', intendedLanguage);

  const labels = await topbarCopyForLanguage(page, intendedLanguage);
  const englishLabels = intendedLanguage === 'en' ? labels : await topbarCopyForLanguage(page, 'en');
  const nonEnglishCopies = await Promise.all(LANGUAGES.filter(language => language !== 'en' && codes.includes(language))
    .map(language => language === intendedLanguage ? labels : topbarCopyForLanguage(page, language)));
  // Require a non-English witness among the requested cases. Its label assertions below
  // then prove that differing dictionary copy renders, even if other locales fall back to English.
  expect(nonEnglishCopies.some(copy => copy.some((label, index) => label !== englishLabels[index])),
    'At least one enabled requested non-English locale must have topbar copy different from English.').toBe(true);
  return { labels, englishLabels };
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
  test.use({ storageState: { cookies: [], origins: [] }, hasTouch: true, locale: 'en-US' });
  for (const language of LANGUAGES) for (const theme of ['light', 'dark'] as const) {
    test(`#901b/#902: phone search button and translated style (${language}, ${theme})`, async ({ page }, info) => {
      test.skip(!/^[a-z][a-z0-9_]{0,62}$/.test(DATASET), 'Set FILTEREST_E2E_TOPBAR_DATASET to an existing readable dataset.');
      test.skip(info.project.metadata.screenWidth !== 'mobile' || info.project.metadata.cardView === 'big', 'Phone proof.');
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await page.addInitScript(({ language, theme }) => {
        localStorage.setItem('chosen_language', language); localStorage.setItem('theme', theme);
      }, { language, theme });
      await page.goto(`/${DATASET}?view=card`);
      await waitForActiveFilterbarLayout(page);
      const { labels, englishLabels } = await servedTopbarCopy(page, language);
      const bar = page.locator('.dataset-shared-topbar:visible');
      await expect(bar).toBeVisible();
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
      const identity = bar.getByTestId('mobile-site-identity');
      const input = bar.locator('.dataset-search-input');
      const toggle = bar.getByTestId('mobile-search-toggle');
      const heroInput = page.locator(`.filterbar-inline-hero[data-filterbar-inline-hero-for="${DATASET}"] .dataset-search-input`);
      await expect(identity).toBeVisible(); await expect(identity).not.toHaveText('');
      await expect(bar.locator('.dataset-shared-topbar__dataset-title')).toBeHidden();
      await expect(input).toBeHidden(); await expect(toggle).toHaveAccessibleName(labels[0]);
      if (labels[0] !== englishLabels[0]) await expect(toggle).not.toHaveAccessibleName(englishLabels[0]);
      await expect(toggle).toHaveAttribute('data-aria-label-lang-key', 'filterbar_show_search');
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      const viewport = page.viewportSize()!;
      for (const width of [320, 375, 390, 700]) {
        await page.setViewportSize({ ...viewport, width });
        await info.attach(`phone hero gaps ${width}px`, {
          body: JSON.stringify(await assertPhoneHeroSpacing(page, DATASET), null, 2), contentType: 'application/json',
        });
      }
      await page.setViewportSize(viewport);
      await expect(heroInput).toBeEditable();
      await heroInput.fill('Helsinki');
      const before = await geometry(page);
      expect(before.search.x + before.search.width).toBeLessThanOrEqual(before.filter.x);
      expect(before.filter.x - before.search.x - before.search.width).toBeLessThanOrEqual(9);
      // The general search helper now finds the visible hero; exercise the toolbar button explicitly.
      await toggle.tap(); await expect(input).toBeFocused();
      await expect(input).toHaveValue('Helsinki'); await expect(heroInput).toBeVisible();
      await expect(toggle).toHaveAccessibleName(labels[1]);
      if (labels[1] !== englishLabels[1]) await expect(toggle).not.toHaveAccessibleName(englishLabels[1]);
      await expect(toggle).toHaveAttribute('data-aria-label-lang-key', 'filterbar_hide_search');
      await expect(toggle).toHaveAttribute('aria-pressed', 'true');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(await geometry(page)).toEqual(before); await expect(identity).toBeHidden();
      await input.fill('Turku'); await expect(heroInput).toHaveValue('Turku'); const url = page.url();
      await input.press('Escape'); await expect(input).toBeHidden(); await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(toggle).toHaveAttribute('aria-pressed', 'false');
      expect(page.url()).toBe(url); expect(await geometry(page)).toEqual(before);
      await expect(identity).toBeVisible();
      await toggle.press('Enter'); await expect(input).toBeFocused(); await expect(input).toHaveValue('Turku');
      await toggle.tap(); await expect(input).toBeHidden();
      await expect(toggle).toBeFocused();
      const scrollable = page.locator('.scrollable_content:visible').first();
      await scrollable.evaluate(element => { element.scrollTop = 300; element.dispatchEvent(new Event('scroll')); });
      await expect(input).toBeHidden(); await expect(identity).toBeVisible();
      await toggle.tap(); await expect(input).toBeFocused(); await expect(input).toHaveValue('Turku');
      await input.press('Escape'); await expect(toggle).toBeFocused(); await expect(input).toBeHidden();
      await expect(bar.getByTestId('shared-topbar-menu-button')).toBeVisible();
      await expect(bar.getByTestId('filterbar-toggle')).toBeVisible();
      const style = await revealActiveFilterbarSection(page, 'style');
      await expect(style.locator('[data-lang-key="filterbar_style_and_colors"]')).toHaveText(labels[2]);
      if (labels[2] !== englishLabels[2]) {
        await expect(style.locator('[data-lang-key="filterbar_style_and_colors"]')).not.toHaveText(englishLabels[2]);
      }
      const widths = await style.evaluate(element => {
        // The panel body reserves a scrollbar gutter (filterbar_layout.css scrollbar-gutter: stable), so compare with
        // its usable content width: clientWidth excludes the gutter, minus its own inline padding (gate 254b P3).
        const parent = element.parentElement!;
        const css = getComputedStyle(parent);
        const usable = parent.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
        const section = element.getBoundingClientRect();
        const preferences = element.querySelector('.filterbar-preference-controls')?.getBoundingClientRect();
        return { panel: usable, section: section.width, preferences: preferences?.width || 0 };
      });
      expect(widths.section).toBeCloseTo(widths.panel, 0);
      expect(widths.preferences).toBeLessThanOrEqual(widths.section);
      await expect(style.getByTestId('filterbar-theme-toggle')).toBeVisible();
      const button = style.locator('.language-button');
      await expect(button).toBeVisible();
      await expect(button).toHaveAttribute('aria-controls', /\S+/);
      // Opening moves the panel to document.body; its button-owned ID stays stable.
      const panel = page.locator(`[id="${await button.getAttribute('aria-controls')}"]`);
      await button.press('Enter');
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(panel).toBeVisible();
      await button.press('Escape');
      await expect(button).toHaveAttribute('aria-expanded', 'false');
      await expect(panel).toBeHidden();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }
});

test.describe('measured tablet and desktop navigation', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('#901a: whole buttons progressively hide and all menu destinations survive', async ({ page }, info) => {
    test.skip(!/^[a-z][a-z0-9_]{0,62}$/.test(DATASET), 'Set FILTEREST_E2E_TOPBAR_DATASET.');
    test.skip(info.project.metadata.cardView === 'big', 'Navigation does not depend on card presentation.');
    // Pin the post-WO52 Home link without changing the installation's setting.
    await installHomePolicy(page.context());
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${DATASET}?view=card`);
    await waitForActiveFilterbarLayout(page);
    const tabs = page.locator(`.filterbar-inline-hero[data-filterbar-inline-hero-for="${DATASET}"] .hero-dataset-tabs`);
    await expect.poll(() => tabs.locator(':scope > button').count()).toBeGreaterThan(1);
    await expect(tabs).toBeVisible();
    const home = tabs.locator(':scope > .top-nav-home-button');
    await expect(home).toBeVisible();
    expect(await home.evaluate(element => element === element.parentElement!.firstElementChild)).toBe(true);
    await expect(home).toHaveCSS('height', '44px');
    await expect(home.locator('.navbar-front-page-icon')).toHaveCSS('width', '24px');
    const homeHref = await home.getAttribute('href');
    const destinations = await tabs.locator(':scope > button').evaluateAll(buttons =>
      buttons.map(button => (button as HTMLElement).dataset.dataset!));
    expect(destinations.length, 'The native dataset needs at least two main navigation destinations.').toBeGreaterThan(1);
    // Restrict the actual row at a fixed viewport: fitting must follow measured room, not a breakpoint.
    const { widths, gap, homeWidth } = await tabs.evaluate(element => ({
      gap: Number.parseFloat(getComputedStyle(element).columnGap) || 0,
      homeWidth: element.querySelector('.top-nav-home-button')!.getBoundingClientRect().width,
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
    // Home is a retained link, not a progressively hidden dataset button. Its
    // measured width and leading gap must be reserved before fitting datasets.
    const reserved = homeWidth + gap;
    const two = reserved + widths[0] + widths[1] + gap;
    try {
      for (const [available, count] of [[two + 1, 2], [reserved + widths[0] + 1, 1], [1, 0]]) {
        await tabs.evaluate((element, width) => { (element as HTMLElement).style.width = `${width}px`; }, available);
        await expect(tabs.locator(':scope > button:visible')).toHaveCount(count);
        expect(await tabs.locator(':scope > button:visible').evaluateAll(buttons =>
          buttons.map(button => (button as HTMLElement).dataset.dataset))).toEqual(destinations.slice(0, count));
        expect(await home.evaluate(element => !(element as HTMLElement).hidden)).toBe(true);
      }
    } finally {
      await tabs.evaluate(element => { (element as HTMLElement).style.removeProperty('width'); });
    }
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
    await expect(page.locator('#navbarFrontPage a')).toBeVisible();
    await expect(page.locator('#navbarFrontPage a')).toHaveAttribute('href', homeHref || '/');
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
