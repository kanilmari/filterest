// home-contact-button-proof.ts
// Proves the phone Home Contact button's alignment, sizing and long-label wrapping.
// Shared by G11's existing response-fixture cases through its supplied Home opener.
// Keeps the proof read-only and its assertions independent of the spec module.
import { expect, type Page } from '@playwright/test';

export type ArticleFixture = { placement: 'top_row' | 'below_text'; alignment: string; phoneAlignment: string; label: string };

type OpenHome = (page: Page, theme: 'light' | 'dark', language: string,
  fixture: { name: string; width: number; article: ArticleFixture }) => Promise<{ writes: string[] }>;

// WO82b: the phone Contact button. Runs inside one existing case per theme; Vitest holds the alignment mappings.
export async function proveContactButton(page: Page, theme: 'light' | 'dark', openHome: OpenHome) {
  for (const [placement, alignment, phoneAlignment, effective] of [
    ['top_row', 'center', 'inherit', 'center'], ['below_text', 'end', 'start', 'start'],
  ] as const) {
    const state = await openHome(page, theme, 'fi', { name: 'Fintravel', width: 390,
      article: { placement, alignment, phoneAlignment, label: 'Ota yhteyttä' } });
    const group = page.locator('.front-page-article-buttons'), link = group.locator('a');
    const hero = page.locator('.front-page-hero'), nav = page.locator('.front-page-top-row > .hero-dataset-tabs');
    await expect(group).toHaveAttribute('data-alignment', alignment);
    await expect(group).toHaveAttribute('data-phone-alignment', phoneAlignment);
    for (const direction of ['ltr', 'rtl']) {
      await page.locator('.front-page').evaluate((element, dir) => { element.setAttribute('dir', dir); }, direction);
      const box = (await link.boundingBox())!, text = (await hero.boundingBox())!, column = (await nav.boundingBox())!;
      expect(box.width).toBeLessThan(column.width); expect(box.height).toBeGreaterThanOrEqual(54);
      expect(box.width).toBeGreaterThanOrEqual(44);
      if (effective === 'center') expect(box.x + box.width / 2).toBeCloseTo(text.x + text.width / 2, 0);
      else if (direction === 'ltr') expect(box.x).toBeCloseTo(text.x, 0);
      else expect(box.x + box.width).toBeCloseTo(text.x + text.width, 0);
      for (const item of await nav.locator(':scope > a, :scope > button').all()) {
        expect((await item.boundingBox())!.width).toBeCloseTo(column.width, 0);
      }
    }
    await page.locator('.front-page').evaluate(element => { element.setAttribute('dir', 'ltr'); });
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('.front-page-phone-topbar')).toHaveCount(0);
    await expect(link).toHaveCSS('min-height', '44px');
    await expect(link).toHaveCSS('padding', placement === 'top_row' ? '10px 28px' : '10px 16px');
    const desktop = await link.boundingBox();
    // The phone choice has no effect on desktop geometry or placement.
    await group.evaluate(element => { element.setAttribute('data-phone-alignment', 'center'); });
    expect(await link.boundingBox()).toEqual(desktop);
    expect(state.writes).toEqual([]);
  }
  const state = await openHome(page, theme, 'fi', { name: 'Fintravel', width: 390,
    article: { placement: 'top_row', alignment: 'start', phoneAlignment: 'inherit',
      label: `Ota yhteyttä ja suunnitellaan yhdessä lomamatkasi ${'pitkäyhdyssana'.repeat(10)}` } });
  const link = page.locator('.front-page-article-button');
  const geometry = await link.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    return { lines: range.getClientRects().length, width: element.clientWidth, scroll: element.scrollWidth,
      height: element.getBoundingClientRect().height };
  });
  expect(geometry.lines).toBeGreaterThan(1); expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
  expect(geometry.height).toBeGreaterThanOrEqual(54);
  const box = (await link.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(16); expect(box.x + box.width).toBeLessThanOrEqual(374);
  expect(state.writes).toEqual([]);
}
