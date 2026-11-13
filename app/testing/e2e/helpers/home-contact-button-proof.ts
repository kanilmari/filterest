// home-contact-button-proof.ts
// Proves the phone Home Contact button's alignment, sizing and long-label handling.
// Shared by G11's existing response-fixture cases through its supplied Home opener.
// Keeps the proof read-only and its assertions independent of the spec module.
import { expect, type Page } from '@playwright/test';

export type ArticleFixture = { placement: 'top_row' | 'below_text'; alignment: string; phoneAlignment: string; label: string };

type OpenHome = (page: Page, theme: 'light' | 'dark', language: string,
  fixture: { name: string; width: number; datasetLabels?: string[]; article: ArticleFixture }) => Promise<{ writes: string[] }>;

// WO82b: the phone Contact button. Runs inside one existing case per theme; Vitest holds the alignment mappings.
export async function proveContactButton(page: Page, theme: 'light' | 'dark', openHome: OpenHome) {
  for (const [placement, alignment, phoneAlignment] of [
    ['top_row', 'center', 'inherit'], ['below_text', 'end', 'start'],
  ] as const) {
    const state = await openHome(page, theme, 'fi', { name: 'Fintravel', width: 390,
      datasetLabels: ['Matkainfo', 'Matkatarjoukset', 'Blogit', 'Tietoa meistä'],
      article: { placement, alignment, phoneAlignment, label: 'Yhteystiedot' } });
    const group = page.locator('.front-page-article-buttons'), link = group.locator('a');
    const hero = page.locator('.front-page-hero'), nav = page.locator('.front-page-top-row > .hero-dataset-tabs');
    await expect(group).toHaveAttribute('data-alignment', alignment);
    await expect(group).toHaveAttribute('data-phone-alignment', phoneAlignment);
    const tabs = nav.locator(':scope > button');
    await expect(tabs).toHaveCount(4);
    for (const direction of ['ltr', 'rtl']) {
      await page.setViewportSize({ width: placement === 'top_row' && direction === 'ltr' ? 320 : 390, height: 800 });
      await page.locator('.front-page').evaluate((element, dir) => { element.setAttribute('dir', dir); }, direction);
      const box = (await link.boundingBox())!, text = (await hero.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      if (placement === 'top_row') {
        const items = page.locator('.front-page-top-row :is(.hero-dataset-tabs__button, .front-page-article-button)');
        // A resized viewport may be between animation frames while the row is refitting.
        await expect(async () => {
          const metrics = await items.evaluateAll(buttons => buttons.map(button => {
            const label = button.lastElementChild!;
            const range = document.createRange(); range.selectNodeContents(label);
            const rect = button.getBoundingClientRect(), style = getComputedStyle(button);
            const icon = button.querySelector('.hero-dataset-tabs__icon');
            const iconWidth = icon?.getBoundingClientRect().width ?? parseFloat(getComputedStyle(button, '::before').flexBasis);
            const insets = [style.columnGap, style.paddingLeft, style.paddingRight, style.borderLeftWidth, style.borderRightWidth]
              .reduce((sum, value) => sum + parseFloat(value), 0);
            const textWidth = range.getBoundingClientRect().width;
            return { x: rect.x, y: rect.y, height: rect.height, space: rect.width - textWidth,
              minimum: Math.max(parseFloat(style.minWidth), textWidth + iconWidth + insets),
              centered: style.justifyContent === 'center',
              singleLine: range.getClientRects().length === 1 && label.scrollWidth <= label.clientWidth + 1 };
          }));
          expect(metrics).toHaveLength(5);
          expect(metrics.every(item => item.centered && item.singleLine && item.height === 48)).toBe(true);
          const tops = [...new Set(metrics.map(item => item.y))];
          const [previous, last] = metrics.slice(-2);
          if (previous.y < last.y) {
            const { gap, available } = await nav.evaluate(element => {
              const row = element.parentElement!, style = getComputedStyle(row);
              return { gap: parseFloat(style.columnGap),
                available: row.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) };
            });
            expect(previous.minimum + gap + last.minimum).toBeGreaterThan(available - 1);
          }
          for (const y of tops) {
            const members = metrics.filter(item => item.y === y);
            // All five controls use the same icon width and gap.
            const space = members.map(item => item.space);
            expect(Math.max(...space) - Math.min(...space)).toBeLessThanOrEqual(1);
            const xs = members.map(item => item.x);
            expect(xs).toEqual([...xs].sort((a, b) => direction === 'ltr' ? a - b : b - a));
          }
          expect(metrics.map(item => item.y)).toEqual([...metrics.map(item => item.y)].sort((a, b) => a - b));
        }).toPass();
      } else {
        expect(box.height).toBeGreaterThanOrEqual(54);
        expect(box.width).toBeLessThan(text.width);
        if (direction === 'ltr') expect(box.x).toBeCloseTo(text.x, 0);
        else expect(box.x + box.width).toBeCloseTo(text.x + text.width, 0);
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
  const name = `Ota yhteyttä ja suunnitellaan yhdessä lomamatkasi ${'pitkäyhdyssana'.repeat(10)}`;
  const state = await openHome(page, theme, 'fi', { name: 'Fintravel', width: 390, datasetLabels: [name],
    article: { placement: 'top_row', alignment: 'start', phoneAlignment: 'inherit', label: name } });
  const row = page.locator('.front-page-scroller > .front-page-top-row');
  for (const role of ['button', 'link'] as const) {
    const control = row.getByRole(role, { name, exact: true });
    await expect(control).toBeVisible();
    const label = control.locator(':scope > span').last();
    const text = await label.evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const box = element.getBoundingClientRect(), lines = Array.from(range.getClientRects());
      return { count: lines.length, contained: lines.every(line => line.left >= box.left - 1
        && line.right <= box.right + 1 && line.top >= box.top - 1 && line.bottom <= box.bottom + 1) };
    });
    expect(text.count).toBeGreaterThan(1); expect(text.contained).toBe(true);
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(4); expect(box.x + box.width).toBeLessThanOrEqual(386);
  }
  expect(state.writes).toEqual([]);
}
