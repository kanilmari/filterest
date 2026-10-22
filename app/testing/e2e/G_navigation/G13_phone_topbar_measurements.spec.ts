// G13_phone_topbar_measurements.spec.ts
// Measures phone toolbar order, clipping, focus and the unchanged desktop cascade.
// Run WO37_PROBE_PHASE=before/after on the respective native checkout, --workers=1.
// Records CSS pixels, hero/search/bar geometry and screenshots under test-results.
import { test, expect, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { assertPhoneHeroSpacing, measurePhoneHeroSpacing } from '../helpers/phone-hero-spacing';
import { installHomePolicy, openHomeProbeDataset, captureHomeProbe, probePhase } from '../helpers/home-policy-fixture';

async function measure(page: Page) {
  return page.locator('#app_service_catalog_tab_parts_container').evaluate(element => {
    const hero = element.querySelector('.filterbar-inline-hero')!;
    const scroller = hero.closest('.scrollable_content')!;
    const bar = element.querySelector('.dataset-shared-topbar')!;
    const rect = (node: Element) => {
      const box = node.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const heroBox = rect(hero); const scrollBox = rect(scroller);
    const heroVisible = heroBox.height > 0 && heroBox.bottom > scrollBox.top;
    const menuOpen = !document.getElementById('navbar')!.classList.contains('collapsed');
    const filterOpen = !element.querySelector('.filterbar-panel')!.classList.contains('filterbar-panel--hidden');
    const phone = innerWidth <= 700;
    const expectedBar = phone || (!heroVisible && (!menuOpen || !filterOpen));
    return { width: innerWidth, height: innerHeight, phone, menuOpen, filterOpen, heroVisible,
      expectedBar, barHidden: (bar as HTMLElement).hidden, opacity: Number.parseFloat(getComputedStyle(bar).opacity),
      actualBar: (element as HTMLElement).dataset.sharedTopbarVisible === 'true',
      ariaHidden: bar.getAttribute('aria-hidden'), hero: heroBox, scroller: scrollBox, bar: rect(bar),
      search: [...hero.querySelectorAll('.dataset-search-panel')].map(node => ({
        rect: rect(node), display: getComputedStyle(node).display,
      })) };
  });
}

async function phoneControls(page: Page) {
  return page.locator('.dataset-shared-topbar:visible').evaluate(bar => {
    const selectors = ['.dataset-shared-topbar__menu-button', '.top-nav-home-button',
      '.dataset-shared-topbar__site-identity', '.dataset-shared-topbar__search-toggle', '.filterbar-fixed-toggle'];
    const rect = (node: Element) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return { x: box.x, right: box.right, y: box.y, width: box.width, height: box.height,
        overflow: style.overflow, margin: style.margin, left: style.left };
    };
    return { controls: selectors.map(selector => rect(bar.querySelector(selector)!)),
      slot: rect(bar.querySelector('.dataset-shared-topbar__menu-slot')!),
      image: rect(bar.querySelector('.dataset-shared-topbar__site-identity img')!),
      tracks: getComputedStyle(bar.querySelector('.dataset-shared-topbar__inner')!).gridTemplateColumns };
  });
}

for (const width of [320, 375, 390, 414, 700, 701]) for (const theme of ['light', 'dark'] as const) {
  test(`Home compact bar geometry ${width}px ${theme}`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    await installHomePolicy(context, theme, { site_name: 'Fintravel' });
    await page.addInitScript(theme => {
      localStorage.setItem('theme', theme); localStorage.setItem('navVisibleNarrow', 'false');
      localStorage.setItem('navVisibleWide', 'false');
    }, theme);
    await page.goto('/front_page', { waitUntil: 'domcontentloaded' });
    const row = page.locator('.front-page-top-row'); await expect(row).toBeVisible();
    const bar = page.locator('.front-page-phone-topbar');
    if (width === 701) {
      await expect(bar).toHaveCount(0);
      expect(await row.evaluate(element => element.parentElement!.classList.contains('front-page')
        && element.nextElementSibling!.classList.contains('front-page-scroller'))).toBe(true);
    } else {
      await expect(page.locator('.front-page-scroller > .front-page-phone-topbar + .front-page-top-row')).toHaveCount(1);
      const menu = bar.locator('#showMenuButton'), identity = bar.locator('.front-page-top-row__identity');
      const end = bar.locator('.front-page-phone-topbar__end');
      await expect(end).toHaveAttribute('aria-hidden', 'true'); await expect(end).toBeEmpty();
      await expect(bar.locator('.front-page-site-name')).toBeVisible();
      const header = (await bar.boundingBox())!, button = (await menu.boundingBox())!, middle = (await identity.boundingBox())!;
      expect(header.y).toBeCloseTo(0, 0);
      expect(header.width).toBe(await page.locator('.front-page-scroller').evaluate(element => element.clientWidth));
      expect(button.x).toBeCloseTo(12, 0); expect(button.y).toBeCloseTo(12, 0);
      expect(button.width).toBe(44); expect(button.height).toBe(44);
      expect(middle.x + middle.width / 2).toBeCloseTo(header.x + header.width / 2, 0);
      expect((await end.boundingBox())!.width).toBe(44);
      await expect.poll(() => page.locator('.front-page-scroller').evaluate(element =>
        parseFloat(getComputedStyle(element).getPropertyValue('--home-phone-bar-size')))).toBeCloseTo(header.height, 0);
      await page.locator('.front-page-scroller').evaluate(element => { element.scrollTop = 100; });
      expect((await bar.boundingBox())!.y).toBeCloseTo(0, 0);
    }
    await captureHomeProbe(page, info, `${width}-${theme}-home-bar`);
  });
}

for (const width of [320, 375, 390, 700]) for (const theme of ['light', 'dark'] as const) {
  test(`phone order and complete menu border ${width}px ${theme}`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light', reducedMotion: 'no-preference' });
    await installHomePolicy(context, theme);
    await openHomeProbeDataset(page, false);
    const bar = page.locator('.dataset-shared-topbar:visible');
    const sample = await phoneControls(page);
    await info.attach(`${probePhase}-phone-control-boxes`, { body: JSON.stringify(sample, null, 2), contentType: 'application/json' });
    await info.attach(`${probePhase}-phone-hero-gaps`, {
      body: JSON.stringify(await (probePhase === 'before' ? measurePhoneHeroSpacing : assertPhoneHeroSpacing)(page, 'app_service_catalog'), null, 2),
      contentType: 'application/json',
    });
    if (probePhase === 'before') return;
    const [menuBox, homeBox, identityBox, searchBox, filterBox] = sample.controls;
    for (const box of [menuBox, homeBox, searchBox, filterBox]) {
      expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    for (let index = 1; index < sample.controls.length; index++) {
      expect(sample.controls[index - 1].right).toBeLessThanOrEqual(sample.controls[index].x);
    }
    expect(menuBox.x).toBeGreaterThanOrEqual(sample.slot.x);
    expect(menuBox.right).toBeLessThanOrEqual(sample.slot.right);
    expect(menuBox.right).toBeLessThanOrEqual(identityBox.x);
    if (sample.image.width) expect(menuBox.right).toBeLessThanOrEqual(sample.image.x);
    expect(filterBox.right).toBeLessThanOrEqual(width);
    const menu = bar.getByTestId('shared-topbar-menu-button');
    const home = bar.getByTestId('top-nav-home-button');
    const search = bar.getByTestId('mobile-search-toggle');
    const filter = bar.getByTestId('filterbar-toggle');
    await menu.focus(); await page.keyboard.press('Tab'); await expect(home).toBeFocused();
    await page.keyboard.press('Tab'); await expect(search).toBeFocused();
    await page.keyboard.press('Tab'); await expect(filter).toBeFocused();
    await page.keyboard.press('Shift+Tab'); await expect(search).toBeFocused();
    await search.press('Enter');
    const input = bar.locator('.dataset-search-input');
    await expect(input).toBeFocused();
    await expect(search).toHaveAttribute('aria-expanded', 'true');
    await expect(search).toHaveAttribute('aria-pressed', 'true');
    await input.press('Escape');
    await expect(input).toBeHidden(); await expect(search).toBeFocused();
    await expect(search).toHaveAttribute('aria-expanded', 'false');
    await expect(search).toHaveAttribute('aria-pressed', 'false');
    expect(await phoneControls(page)).toEqual(sample);
    // Identity is decorative; native keyboard order skips it, matching the row.
    expect(await bar.getByTestId('mobile-site-identity').evaluate(el => (el as HTMLElement).tabIndex)).toBe(-1);
    const opening = await menu.evaluate(button => {
      (button as HTMLButtonElement).click();
      const navbar = document.getElementById('navbar')!;
      return { active: navbar.classList.contains('navbar-opening'),
        row: getComputedStyle(navbar.querySelector('.top-button-bar')!).cursor,
        gap: getComputedStyle(navbar.querySelector('.nav-history-buttons')!).cursor,
        menu: getComputedStyle(navbar.querySelector('#hideMenuButton')!).cursor };
    });
    expect(opening).toEqual({ active: true, row: 'default', gap: 'default', menu: 'pointer' });
    expect(await phoneControls(page)).toEqual(sample);
    await captureHomeProbe(page, info, `${width}-${theme}-phone-order`);
  });
}

for (const width of [1440, 1920]) for (const theme of ['light', 'dark'] as const) {
  test(`desktop computed styles remain equal ${width}px ${theme}`, async ({ page, context }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    await installHomePolicy(context, theme);
    await openHomeProbeDataset(page, false);
    await page.evaluate(() => document.fonts.ready);
    const styles = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#app_service_catalog_tab_parts_container :is(.top-nav-home-button, '
        + '.dataset-shared-topbar__inner, .dataset-shared-topbar__slot--start, .dataset-shared-topbar__menu-slot, '
        + '.dataset-shared-topbar__menu-button, .dataset-shared-topbar__site-identity, .filterbar-inline-hero, '
        + '.filter-content-inner, .morphing-header, .morphing-title, .morphing-subtitle, '
        + '.filterbar-hero-dataset-icon, .dataset-search-panel, .dataset-filter-section)')];
      const snapshot = () => nodes.map(node => {
        const style = getComputedStyle(node);
        return { selector: node.className, style: Object.fromEntries([...style].map(key => [key, style.getPropertyValue(key)])) };
      });
      const before = snapshot();
      const media: { rule: CSSMediaRule; text: string }[] = [];
      const disablePhoneRules = (rules: CSSRuleList) => {
        for (const rule of [...rules]) {
          if (rule instanceof CSSMediaRule && /^\((?:width\s*<=\s*700px|max-width:\s*700px)\)$/.test(rule.conditionText)) {
            media.push({ rule, text: rule.media.mediaText }); rule.media.mediaText = 'not all';
          } else if ('cssRules' in rule) disablePhoneRules((rule as CSSGroupingRule).cssRules);
          if (rule instanceof CSSImportRule && rule.styleSheet) disablePhoneRules(rule.styleSheet.cssRules);
        }
      };
      try {
        for (const sheet of [...document.styleSheets]) {
          // Cross-origin fonts do not own these application selectors.
          if (sheet.href && new URL(sheet.href).origin !== location.origin) continue;
          disablePhoneRules(sheet.cssRules);
        }
        return { before, after: snapshot(), phoneRules: media.length };
      } finally { media.forEach(({ rule, text }) => { rule.media.mediaText = text; }); }
    });
    expect(styles.before.length).toBeGreaterThan(0); expect(styles.phoneRules).toBeGreaterThan(0);
    expect(styles.after).toEqual(styles.before);
    const name = `desktop-${width}-${theme}.json`;
    await writeFile(info.outputPath(name), JSON.stringify(styles.before, null, 2));
    await info.attach(`${probePhase}-computed-styles`, { path: info.outputPath(name), contentType: 'application/json' });
    // Maintenance can compare native before/after artifacts as well as the
    // in-browser phone-rule isolation and Vitest's non-phone source hashes.
    if (probePhase === 'after' && process.env.WO70_BASELINE_DIR) {
      expect(styles.before).toEqual(JSON.parse(await readFile(join(process.env.WO70_BASELINE_DIR, name), 'utf8')));
    }
  });
}

for (const [portraitWidth, portraitHeight] of [[390, 844], [412, 915], [430, 932]]) {
  for (const landscape of [false, true]) {
    const width = landscape ? portraitHeight : portraitWidth;
    const height = landscape ? portraitWidth : portraitHeight;
    test(`historical phone rule ${width}×${height} ${landscape ? 'landscape' : 'portrait'}`, async ({ page, context }, info) => {
      test.setTimeout(90_000);
      await page.setViewportSize({ width, height });
      const policy = await installHomePolicy(context);
      const samples = [];
      for (const enabled of [false, true]) for (const menuOpen of [false, true]) {
        policy.enabled = enabled;
        await openHomeProbeDataset(page, menuOpen);
        const parts = page.locator('#app_service_catalog_tab_parts_container');
        await expect.poll(async () => {
          const sample = await measure(page);
          return sample.heroVisible && sample.actualBar === sample.expectedBar
            && sample.barHidden === !sample.expectedBar && (!sample.expectedBar || sample.opacity >= 0.999);
        }).toBe(true);
        for (const scrolled of [false, true]) {
          if (scrolled) await parts.locator('.filterbar-inline-hero').evaluate(hero => {
            const scroller = hero.closest('.scrollable_content')!;
            const spacer = document.createElement('div');
            spacer.dataset.wo37Spacer = 'true'; spacer.style.height = '2000px';
            scroller.append(spacer); scroller.scrollTop = scroller.scrollHeight;
            scroller.dispatchEvent(new Event('scroll'));
          });
          try {
            await expect.poll(async () => {
              const sample = await measure(page);
              return sample.heroVisible === !scrolled && sample.actualBar === sample.expectedBar
                && sample.barHidden === !sample.expectedBar && (!sample.expectedBar || sample.opacity >= 0.999);
            }).toBe(true);
            const sample = await measure(page);
            expect(sample.width).toBe(width); expect(sample.height).toBe(height);
            expect(sample.actualBar).toBe(sample.expectedBar);
            expect(sample.ariaHidden).toBe(String(!sample.expectedBar));
            samples.push({ enabled, scrolled, ...sample });
            await captureHomeProbe(page, info, `${width}x${height}-${enabled ? 'home' : 'off'}-${menuOpen ? 'open' : 'closed'}-${scrolled ? 'scrolled' : 'hero'}`);
          } finally {
            if (scrolled) await parts.evaluate(element => {
              const spacer = element.querySelector('[data-wo37-spacer]');
              const scroller = spacer?.closest('.scrollable_content');
              spacer?.remove(); if (scroller) scroller.scrollTop = 0;
              scroller?.dispatchEvent(new Event('scroll'));
            });
          }
        }
      }
      const output = info.outputPath(`${probePhase}-${width}x${height}-measurements.json`);
      await writeFile(output, JSON.stringify(samples, null, 2));
      await info.attach('phone measurements', { path: output, contentType: 'application/json' });
    });
  }
}
