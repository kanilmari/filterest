// G13_phone_topbar_measurements.spec.ts
// Measures the exact pre-218 phone rule on a9b4520c^ and WO37-FIX without changing it.
// Run WO37_PROBE_PHASE=before/after on the respective native checkout, --workers=1.
// Records CSS pixels, hero/search/bar geometry and screenshots under test-results.
import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
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
