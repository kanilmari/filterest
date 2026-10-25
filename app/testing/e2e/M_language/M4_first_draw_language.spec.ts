// M4_first_draw_language.spec.ts
// Proves a Finnish visitor never sees the English fallback labels while a dataset list first loads (K522 A).
// Connects the shell-boot reveal with the client's translation pass on an anonymous first load.
// Before K522 A the page was revealed before its controls were drawn, and English labels then showed for ~3 s.

import { test, expect } from '@playwright/test';

test.use({ storageState: { cookies: [], origins: [] }, locale: 'fi-FI' });

// UI labels whose English fallbacks were visible after the reveal before K522 A (25.10., anonymous fi-FI on /travel_deals).
const ENGLISH_UI = ['Front page', 'Search for', 'Sort by', 'Filter results', 'Reset search', 'Row group categories'];
const FINNISH_UI = /Etsi|Lajittele|Suodata tuloksia|Tyhjennä haku/;
// How long after the reveal the visible text is sampled; the English labels lasted about three seconds.
const WATCH_MS = 4000;
const EVERY_MS = 100;

test('a Finnish visitor sees no English fallback labels at or after the reveal of a dataset list', async ({ page }, testInfo) => {
  // Records the text actually visible in the viewport at the reveal, then every 100 ms for four seconds.
  await page.addInitScript(({ watch, every }) => {
    type Frames = { first?: string[]; frames: { at: number; text: string[] }[]; done?: boolean };
    const w = window as unknown as { __m4: Frames };
    w.__m4 = { frames: [] };
    const collect = () => {
      const seen: string[] = [];
      const inView = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0
        && r.top < innerHeight && r.left < innerWidth;
      const shown = (element: Element | null) => {
        for (let e = element; e; e = e.parentElement) {
          const style = getComputedStyle(e);
          if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
        }
        return true;
      };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        if ([...range.getClientRects()].some(inView) && shown(node.parentElement)) seen.push(text);
      }
      document.querySelectorAll('input[placeholder], textarea[placeholder]').forEach((field) => {
        if (inView(field.getBoundingClientRect()) && shown(field)) seen.push((field as HTMLInputElement).placeholder);
      });
      return seen;
    };
    const observer = new MutationObserver(() => {
      const root = document.documentElement;
      if (!root || root.hasAttribute('data-shell-boot-pending')) return;
      observer.disconnect();
      const start = performance.now();
      w.__m4.first = collect();
      const timer = setInterval(() => {
        const at = Math.round(performance.now() - start);
        w.__m4.frames.push({ at, text: collect() });
        if (at >= watch) { clearInterval(timer); w.__m4.done = true; }
      }, every);
    });
    observer.observe(document, { attributes: true, subtree: true, attributeFilter: ['data-shell-boot-pending'] });
  }, { watch: WATCH_MS, every: EVERY_MS });

  await page.goto('/travel_deals?view=card', { waitUntil: 'commit' });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __m4: { done?: boolean } }).__m4.done === true),
    { timeout: 40_000 }).toBe(true);
  const { first, frames } = await page.evaluate(() =>
    (window as unknown as { __m4: { first: string[]; frames: { at: number; text: string[] }[] } }).__m4);
  await page.screenshot({ path: testInfo.outputPath('after-watch-frame.png') });
  // Each English label with the first time it was visible after the reveal, so a failure names when it showed.
  const firstSeen = new Map<string, number>();
  for (const { at, text } of frames) {
    for (const label of ENGLISH_UI) {
      if (!firstSeen.has(label) && text.some((visible) => visible.includes(label))) firstSeen.set(label, at);
    }
  }
  const englishSeen = [...firstSeen].map(([label, at]) => `${label} @${at} ms`);
  await testInfo.attach('first-visible-text', { body: first.join('\n'), contentType: 'text/plain' });
  await testInfo.attach('english-seen', { body: englishSeen.join('\n') || '(none)', contentType: 'text/plain' });

  expect(await page.locator('html').getAttribute('lang')).toBe('fi');
  expect(ENGLISH_UI.filter((label) => first.some((text) => text.includes(label)))).toEqual([]);
  expect(englishSeen).toEqual([]);
  // Not vacuous: the revealed page already holds the list's Finnish controls, the watch really sampled, and the
  // controls are still Finnish at its end.
  expect(first.some((text) => FINNISH_UI.test(text))).toBe(true);
  expect(frames.length).toBeGreaterThanOrEqual(WATCH_MS / EVERY_MS / 2);
  expect(frames[frames.length - 1].text.some((visible) => FINNISH_UI.test(visible))).toBe(true);
});
