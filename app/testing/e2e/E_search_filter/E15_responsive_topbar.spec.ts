// E15_responsive_topbar.spec.ts
// Verifies measured navigation, phone search toggling and filterbar appearance.
// Exercises an existing readable dataset on the native instance without data writes.
// Requires FILTEREST_E2E_TOPBAR_DATASET; preserves shared layout with temporary reveals.
import { expect, test, type Page } from '@playwright/test';
import { revealActiveFilterbarSection, waitForActiveFilterbarLayout } from '../helpers/filterbar';
import { assertPhoneHeroSpacing } from '../helpers/phone-hero-spacing';
import { installHomePolicy } from '../helpers/home-policy-fixture';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest } from '../helpers/temp-dataset';
import { installMediaTabFixture, MEDIA_DATASET } from '../helpers/media-tab-fixture';

// Keep the real scrollbar thumb available to the native pointer proof.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

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
      const glass = bar.locator('.dataset-search-field-icon');
      await expect(glass).toHaveAttribute('aria-hidden', 'true');
      const fieldGeometry = await input.evaluate(element => {
        const field = element.getBoundingClientRect();
        const glass = element.parentElement!.querySelector('.dataset-search-field-icon')!.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { textStart: field.left + Number.parseFloat(style.paddingInlineStart), glassWidth: glass.width,
          radius: style.borderTopLeftRadius, token: style.getPropertyValue('--search_tools_radius').trim() };
      });
      expect(fieldGeometry.glassWidth).toBe(0);
      // K580: only the phone bar field is square; the hero keeps K465.
      expect(fieldGeometry.radius).toBe('0px');
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
    const tabs = page.locator(`[id="${DATASET}_tab_parts_container"] .filterbar-inline-hero__top-row .hero-dataset-tabs`);
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

// Standard matrix runs own their long scroll fixture. A configured preview is read-only.
const nativeScroll = test.extend<{ longDataset: string }>({
  longDataset: async ({ page }, use, info) => {
    if (DATASET || info.project.metadata.screenWidth !== 'desktop' || info.project.metadata.cardView === 'big') {
      await use(DATASET); return;
    }
    const dataset = buildTempDatasetName('e2e_toolbar_scroll');
    await page.goto('/');
    try {
      await createTempDataset(page, { datasetName: dataset, columns: { id: 'SERIAL', title: 'TEXT' },
        seedRows: Array.from({ length: 32 }, (_, index) => ({ title: `Service ${index + 1}` })) });
      await use(dataset);
    } finally { await cleanupDatasetViaRequest(page.request, dataset); }
  },
});

test.describe('dataset toolbar scroll boundary', () => {

  nativeScroll('#999: the original hero row and listing tools share a stable bar during a slow thumb drag', async ({ page, longDataset }, info) => {
    test.skip(info.project.metadata.screenWidth !== 'desktop' || info.project.metadata.cardView === 'big', 'Native desktop scrollbar.');
    await page.addInitScript(dataset => {
      localStorage.setItem('navVisibleNarrow', 'false');
      localStorage.setItem('navVisibleWide', 'false');
      localStorage.setItem(`${dataset}_filterbar_visible`, 'false');
    }, longDataset);
    await page.goto(`/${longDataset}?view=card`);
    const parts = page.locator(`[id="${longDataset}_tab_parts_container"]`);
    const hero = parts.locator('.filterbar-inline-hero');
    const owner = hero.locator('xpath=parent::*[contains(@class, "scrollable_content")]');
    const bar = parts.locator('.dataset-shared-topbar');
    await expect(hero.locator('.dataset-search-input')).toBeVisible();
    await expect(bar).toHaveAttribute('data-topbar-mode', 'hero');
    const row = bar.locator('.filterbar-inline-hero__top-row');
    await expect(row.locator('.hero-dataset-tabs')).toBeVisible();
    await expect(bar.locator('.dataset-search-input')).toBeHidden();
    const original = await row.elementHandle();
    const sample = () => owner.evaluate(scroller => {
      const host = scroller.closest('.tab_parts_container')!;
      const bar = host.querySelector<HTMLElement>('.dataset-shared-topbar')!;
      const rect = scroller.getBoundingClientRect();
      const hero = scroller.querySelector('.filterbar-inline-hero')!.getBoundingClientRect();
      return { scroll: scroller.scrollTop, client: scroller.clientHeight, total: scroller.scrollHeight,
        top: rect.top, height: rect.height, right: rect.right, gutter: (scroller as HTMLElement).offsetWidth - scroller.clientWidth,
        threshold: hero.bottom - rect.top + scroller.scrollTop, mode: bar.dataset.topbarMode, barHeight: bar.getBoundingClientRect().height };
    });
    // Wait for asynchronous cards and fonts before recording the actual scroll range.
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(async () => {
      const first = await sample();
      await page.waitForTimeout(320);
      const next = await sample();
      return first.total === next.total && next.threshold + 100 < next.total - next.client;
    }).toBe(true);
    const initial = await sample();
    expect(initial.gutter, 'the native thumb must be hit-testable').toBeGreaterThan(0);
    const thumb = Math.max(24, initial.client * initial.client / initial.total);
    const travel = initial.client - thumb;
    const x = Math.floor(initial.right - initial.gutter / 2);
    const y = initial.top + thumb / 2;
    const end = y + (initial.threshold + 95) * travel / (initial.total - initial.client);
    await page.mouse.move(x, y);
    await page.mouse.down();
    const traces: Array<Awaited<ReturnType<typeof sample>>[]> = [];
    try {
      for (const [from, to] of [[y, end], [end, y]]) {
        const trace = [await sample()];
        const steps = Math.max(30, Math.ceil(Math.abs(to - from)));
        for (let step = 1; step <= steps; step++) {
          await page.mouse.move(x, from + (to - from) * step / steps);
          await page.waitForTimeout(16);
          trace.push(await sample());
        }
        await page.waitForTimeout(320);
        trace.push(await sample());
        traces.push(trace);
      }
    } finally { await page.mouse.up(); }
    await info.attach('native scrollbar traces', { body: JSON.stringify(traces), contentType: 'application/json' });
    const modes = traces.map(trace => trace.map(s => s.mode).filter((mode, i, values) => !i || mode !== values[i - 1]));
    expect(modes).toEqual([['hero', 'content'], ['content', 'hero']]);
    for (const trace of traces) {
      expect(Math.abs(trace[0].scroll - trace.at(-1)!.scroll)).toBeGreaterThan(100);
      for (const s of trace) {
        expect([s.client, s.total, s.top, s.height, s.barHeight]).toEqual(
          [initial.client, initial.total, initial.top, initial.height, initial.barHeight]);
      }
    }
    expect(await original!.evaluate(node => node === document.querySelector('.dataset-shared-topbar .filterbar-inline-hero__top-row'))).toBe(true);
    await original!.dispose();
    await expect(bar.getByTestId('shared-topbar-menu-button')).toBeVisible();
    await expect(bar.getByTestId('filterbar-toggle')).toBeVisible();
    await expect(row.locator('.hero-dataset-tabs')).toBeVisible();
  });
});

test('#999: a moved dataset tab opens by keyboard and pointer, and Back restores its active tab', async ({ page }, info) => {
  const dataset = DATASET || MEDIA_DATASET;
  test.skip(info.project.metadata.screenWidth !== 'desktop' || info.project.metadata.cardView === 'big', 'Measured horizontal tabs.');
  if (!DATASET) await installMediaTabFixture(page, page.context(), 1440, 'light');
  await page.addInitScript(dataset => {
    localStorage.setItem('navVisibleNarrow', 'false');
    localStorage.setItem(`${dataset}_filterbar_visible`, 'false');
  }, dataset);
  await page.goto(`/${dataset}?view=card`);
  const live = page.locator(`[id="${dataset}_tab_parts_container"] .dataset-shared-topbar[data-topbar-mode="hero"]`);
  const tabs = live.locator('.filterbar-inline-hero__top-row .hero-dataset-tabs');
  const start = tabs.locator('button[data-dataset][aria-current="page"]');
  await expect(start).toHaveAttribute('data-dataset', dataset);
  const target = tabs.locator('button[data-dataset]:not([aria-current="page"]):visible').first();
  await expect(target).toBeVisible();
  const other = await target.getAttribute('data-dataset');
  expect(other).toMatch(/^[a-z][a-z0-9_]*$/);
  const initialURL = page.url();
  const reachableCurrent = () => page.locator('.hero-dataset-tabs button[aria-current="page"]').evaluateAll(buttons =>
    buttons.filter(button => {
      const r = button.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }).map(button => (button as HTMLElement).dataset.dataset));
  await expect.poll(reachableCurrent).toEqual([dataset]);
  for (const input of ['keyboard', 'pointer']) {
    if (input === 'keyboard') { await target.focus(); await target.press('Enter'); }
    else await target.click();
    await expect(page).not.toHaveURL(initialURL);
    await expect.poll(reachableCurrent).toEqual([other]);
    await page.goBack();
    await expect(page).toHaveURL(initialURL);
    await expect(start).toHaveAttribute('data-dataset', dataset);
    await expect.poll(reachableCurrent).toEqual([dataset]);
  }
});

test('#999: exactly one reachable menu and filter control in all panel combinations', async ({ page }, info) => {
  const dataset = DATASET || MEDIA_DATASET;
  test.skip(info.project.metadata.cardView === 'big', 'Panel ownership is independent of card presentation.');
  if (info.project.metadata.screenWidth === 'desktop') {
    await page.setViewportSize({ width: 1198, height: 900 });
  }
  await page.addInitScript(dataset => {
    localStorage.setItem('navVisibleNarrow', 'false');
    localStorage.setItem('navVisibleWide', 'false');
    localStorage.setItem(`${dataset}_filterbar_visible`, 'false');
  }, dataset);
  await page.goto(`/${dataset}?view=card`);
  const parts = page.locator(`[id="${dataset}_tab_parts_container"]`);
  const bar = parts.locator('.dataset-shared-topbar');
  const menu = '#showMenuButton, #hideMenuButton, [data-testid="shared-topbar-menu-button"]';
  const filter = '[data-testid="filterbar-toggle"], .hide_filter_bar_button';
  let step = 0;
  for (const [navOpen, filtersOpen, next] of [
    [false, false, 'menu'], [true, false, 'filter'], [true, true, 'menu'],
    [false, true, 'filter'], [false, false, 'filter'], [false, true, 'menu'],
    [true, true, 'filter'], [true, false, 'menu'], [false, false, null],
  ] as const) {
    const barHidden = navOpen && filtersOpen;
    await expect(bar).toHaveAttribute('aria-hidden', String(barHidden));
    const targets = [];
    for (const [selector, open, side] of [[menu, navOpen, 'left'], [filter, filtersOpen, 'right']] as const) {
      const visible = page.locator(selector).filter({ visible: true });
      await expect(visible).toHaveCount(1);
      await expect(visible).toHaveAttribute('aria-expanded', String(open));
      await expect(visible).toHaveAttribute('aria-hidden', 'false');
      await expect(visible).toHaveAttribute('tabindex', '0');
      await expect.poll(() => visible.evaluate((node, expected) => {
        const { side, open } = expected;
        const rect = node.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        const viewportWidth = document.documentElement.clientWidth;
        const left = side === 'left';
        const inset = left ? rect.left : viewportWidth - rect.right;
        if (rect.top < -1 || rect.top >= 32 || inset < -1 || inset >= 32
          || !node.contains(hit) || node.closest('[inert]')) return false;
        if (!open) return !!node.closest('.dataset-shared-topbar');
        const panel = node.closest(left ? '#navbar' : '.filterbar-panel--compact');
        if (!panel || Math.abs(panel.getBoundingClientRect().top) > 1) return false;
        // A button relocated over a lowered drawer is insufficient. Hit the panel
        // itself inside its top edge, outside the button, on either side.
        return panel.contains(document.elementFromPoint(left ? 2 : viewportWidth - 3, 3));
      }, { side, open })).toBe(true);
      targets.push(visible);
    }
    if (next) {
      const target = targets[next === 'menu' ? 0 : 1];
      if (step++ < 4) await target.click(); else await target.press('Enter');
    }
  }
});

test('#1017: dataset navigation centers on the toolbar and clears either limiting edge', async ({ page }, info) => {
  test.skip(info.project.metadata.screenWidth !== 'desktop' || info.project.metadata.cardView === 'big', 'Measured horizontal dataset navigation.');
  const dataset = DATASET || MEDIA_DATASET;
  if (!DATASET) await installMediaTabFixture(page, page.context(), 1440, 'light');
  await page.addInitScript(name => {
    localStorage.setItem('navVisibleNarrow', 'false');
    localStorage.setItem('navVisibleWide', 'false');
    localStorage.setItem(`${name}_filterbar_visible`, 'false');
  }, dataset);
  await page.goto(`/${dataset}?view=card`);
  const inner = page.locator(`[id="${dataset}_tab_parts_container"] .dataset-shared-topbar[data-topbar-mode="hero"] .dataset-shared-topbar__inner`);
  const tabs = inner.locator('.hero-dataset-tabs');
  await expect(tabs.locator('button[aria-current="page"]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const measure = () => inner.evaluate(bar => {
    const box = bar.getBoundingClientRect();
    const left = bar.querySelector('.dataset-shared-topbar__slot--start')!.getBoundingClientRect();
    const right = bar.querySelector('.dataset-shared-topbar__slot--end')!.getBoundingClientRect();
    const destinations = [...bar.querySelectorAll('.hero-dataset-tabs > :is(a,button)')];
    const rects = destinations.map(item => item.getBoundingClientRect()).filter(rect => rect.width > 0);
    const first = Math.min(...rects.map(rect => rect.left));
    const last = Math.max(...rects.map(rect => rect.right));
    const midpoint = (box.left + box.right) / 2;
    const width = last - first;
    return { offset: (first + last) / 2 - midpoint, leftGap: first - left.right,
      rightGap: right.left - last, halfSpace: (box.width - width - 40) / 2,
      visible: rects.length, total: destinations.length };
  });
  const original = await measure();
  expect(original.total).toBeGreaterThan(1);
  expect(original.visible).toBe(original.total);
  // Make one real edge group wider without changing the viewport or writing site preferences.
  const setEdges = (left: number, right: number) => inner.evaluate((bar, widths) => {
    for (const [index, slot] of ['start', 'end'].entries()) {
      bar.querySelector<HTMLElement>(`.dataset-shared-topbar__slot--${slot}`)!.style.minWidth =
        widths[index] ? `${widths[index]}px` : '';
    }
  }, [left, right]);
  const wide = original.halfSpace + 40;
  for (const [label, left, right, expected] of [
    ['roomy asymmetric edges', original.halfSpace - 40, 0, 0],
    ['left edge limits', wide, 0, 40],
    ['right edge limits', 0, wide, -40],
    ['room restored', 0, 0, 0],
  ] as const) {
    await test.step(label, async () => {
      await setEdges(left, right);
      await expect.poll(async () => Math.abs((await measure()).offset - expected)).toBeLessThan(1);
      const position = await measure();
      expect(position.visible).toBe(original.total);
      expect(position.leftGap).toBeGreaterThanOrEqual(19);
      expect(position.rightGap).toBeGreaterThanOrEqual(19);
      if (expected > 0) expect(Math.abs(position.leftGap - 20)).toBeLessThan(1);
      if (expected < 0) expect(Math.abs(position.rightGap - 20)).toBeLessThan(1);
    });
  }
});

nativeScroll('#1017: cards and the article reading column follow the toolbar center', async ({ page, longDataset }, info) => {
  test.skip(info.project.metadata.screenWidth !== 'desktop' || info.project.metadata.cardView === 'big', 'Single-column and two-column reading layouts.');
  await page.addInitScript(name => {
    localStorage.setItem('navVisibleNarrow', 'false');
    localStorage.setItem('navVisibleWide', 'false');
    localStorage.setItem(`${name}_filterbar_visible`, 'false');
  }, longDataset);
  await page.setViewportSize({ width: 1098, height: 850 });
  await page.goto(`/${longDataset}?view=card`);
  const parts = page.locator(`[id="${longDataset}_tab_parts_container"]`);
  const cards = parts.locator('.card_view_wrapper:not(.big-card-open) .card_container .card[data-id]');
  await expect(cards.first()).toBeVisible();
  const center = () => parts.locator('.dataset-shared-topbar').evaluate(el => {
    const { left, right } = el.getBoundingClientRect(); return (left + right) / 2;
  });
  await expect.poll(async () => Math.abs(await cards.evaluateAll(nodes => {
    const cards = nodes.map(el => el.getBoundingClientRect());
    const row = cards.filter(rect => rect.width > 0 && Math.abs(rect.top - cards[0].top) < 1);
    return (Math.min(...row.map(rect => rect.left)) + Math.max(...row.map(rect => rect.right))) / 2;
  }) - await center())).toBeLessThan(1);
  const row = await cards.first().getAttribute('data-id');
  expect(row).toMatch(/^\d+$/);
  await page.goto(`/${longDataset}/${row}?view=article_view`);
  const article = parts.locator('.active_row_article');
  await expect(article.locator('.big_card_header_value')).toBeVisible();
  const description = article.locator('.big_description_value').first();
  const text = await description.count() ? description : article.locator('.big_card_header');
  for (const width of [1098, 2048]) {
    await page.setViewportSize({ width, height: 850 });
    const selector = parts.locator('.card_view_wrapper.big-card-open .card_sidebar_panel');
    if (width === 2048) await expect(selector).toBeVisible();
    else await expect(selector).toBeHidden();
    await expect.poll(async () => Math.abs(await text.evaluate(el => {
      const { left, right } = el.getBoundingClientRect(); return (left + right) / 2;
    }) - await center())).toBeLessThan(1);
  }
});
