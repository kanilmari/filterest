// C28_details_edges_and_show_more.spec.ts
// Proves stacked list edges, pre-563 wide frames and category rounding in both image sizes.
// Uses the existing owned dataset fixture; appearance writes affect only that dataset.
// Exercises explicit application themes over opposite OS themes and cleans up on failure.
import { expect, test, type Locator } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest, openTempDataset, openTempDatasetRowArticle } from '../helpers/temp-dataset';
import { saveCardVisibilityWithFreshRevisions } from '../helpers/appearance-revisions';
import { closeActiveFilterbarIfOpen } from '../helpers/filterbar';

// Expected frames read from 96478826: cards.css:297-310, 343-346, 436-437;
// standard card_details_kv and cards_big.css have no outer border/radius declarations.
// Keep these values in the spec: no Git or historical stylesheet is needed at runtime.
const PRE_563 = {
  standard: { border: '0 none currentColor', borderRadius: '0px' },
  modern: { border: '1px solid var(--card-modern-surface-border)', borderRadius: 'var(--border_radius)' },
  modernDetails: { border: '0 none currentColor', borderRadius: '0px', borderTop: '1px solid var(--card-modern-separator-color)' },
  big: { border: '0 none currentColor', borderRadius: '0px' },
};
const STACKED = { border: '0 none currentColor', borderRadius: '0px',
  borderBlock: '1px solid var(--border_color)' };

async function expectEdges(list: Locator, expected: Record<string, string>) {
  await expect(list).toBeVisible();
  const edges = await list.evaluate((element, frame) => {
    const properties = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
      ...['top', 'right', 'bottom', 'left'].flatMap(side => ['width', 'style', 'color'].map(part => `border-${side}-${part}`))];
    const read = (node: Element) => {
      const css = getComputedStyle(node);
      return Object.fromEntries(properties.map(property => [property, css.getPropertyValue(property)]));
    };
    const actual = read(element), probe = document.createElement('span');
    probe.style.cssText = 'all: initial; color: var(--text_color);';
    Object.assign(probe.style, frame); element.append(probe);
    const resolved = read(probe); probe.remove();
    return { actual, resolved };
  }, expected);
  expect(edges.actual).toEqual(edges.resolved);
}

for (const width of [390, 1200, 1201, 1440, 1600, 1920]) for (const theme of ['light', 'dark'] as const) for (const size of ['small', 'large']) {
  test(`WO96 ${size} card edges and Show more at ${width}px/${theme}`, async ({ page, context }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    // Response-only account preference survives every helper navigation and reload.
    await context.route(url => url.pathname === '/api/user-visual-preference', async route => {
      expect(route.request().method()).toBe('GET');
      await route.fulfill({ json: { configured: true, revision: 1, theme_mode: theme } });
    });
    await context.addInitScript(theme => {
      localStorage.setItem('theme', theme); localStorage.setItem('chosen_language', 'fi');
    }, theme);
    await login(page, loadCredentials());
    const dataset = buildTempDatasetName('e2e_wo96_card'); let created = false;
    try {
      // Seed rows carry only application columns: row inserts refuse system fields (id/created/updated);
      // the `id` column definition stays, as in batch 563's natively passing C28 and in C29.
      await createTempDataset(page, { datasetName: dataset,
        columns: { id: 'SERIAL', name: 'TEXT', description: 'TEXT', published: 'TEXT', link: 'TEXT', ...(size === 'large' ? { thumbnail: 'TEXT' } : {}) },
        seedRows: [{ name: 'Matka / Travel', description: 'Kuvaus / Description', published: '22.10.2026', link: 'https://example.test/',
          ...(size === 'large' ? { thumbnail: '/frontend/favicon4E.png' } : {}) }] });
      created = true;
      const roles: Record<string, string> = { name: 'header', description: 'description', published: 'details', link: 'details', thumbnail: 'image' };
      for (const style of ['standard', 'modern']) {
        await saveCardVisibilityWithFreshRevisions(page.request, dataset, visibility => ({ card_style_variant: style,
          columns: visibility.columns.map(column => roles[column.column_name] ? {
            ...column, card_element: roles[column.column_name], show_value_on_card: true,
          } : column) }));
        await openTempDataset(page, dataset, 'card');
        await closeActiveFilterbarIfOpen(page);
        await expect(page.locator('body')).toHaveClass(new RegExp(`(^| )${theme}-mode( |$)`));
        await expect(page.locator('html')).toHaveAttribute('lang', 'fi');
        const card = page.locator(`#${dataset}_card_view_container [data-testid="card-item"]`).first();
        await expect(card.locator(`.card_content_${size}`)).toBeVisible();
        const list = card.locator(style === 'modern' ? '.card_modern_info_panel' : '.card_details_kv');
        if (width <= 1550) {
          await expectEdges(list, STACKED);
        } else {
          // Prove the wide layout is active, rather than accidentally testing a narrow container.
          await expect(card.locator('.card_body')).toHaveCSS('flex-direction', 'row');
          const listWidth = await card.evaluate(element => element.closest('.card_container')!.getBoundingClientRect().width);
          expect(listWidth).toBeGreaterThan(1060);
          await expectEdges(list, PRE_563[style as 'standard' | 'modern']);
        }
        if (style === 'modern') await expectEdges(card.locator('.card_details_kv'), PRE_563.modernDetails);
        const more = card.locator('button[data-lang-key="show_more"]');
        await expect(more).toBeVisible();
        const radii = await more.evaluate(element => {
          const probe = document.createElement('span'); probe.style.borderRadius = 'var(--search_tools_radius)'; element.append(probe);
          const expected = getComputedStyle(probe).borderTopLeftRadius; probe.remove();
          return [getComputedStyle(element).borderTopLeftRadius, expected];
        });
        expect(radii[0]).toBe(radii[1]); expect(parseFloat(radii[1])).toBeGreaterThan(0);
        await page.screenshot({ path: info.outputPath(`${style}-card.png`) });
      }
      await openTempDatasetRowArticle(page, dataset, 1);
      await expect(page.locator('body')).toHaveClass(new RegExp(`(^| )${theme}-mode( |$)`));
      await expectEdges(page.locator('.big_card_details_container:visible'), width <= 1200 ? STACKED : PRE_563.big);
      await expect(page.locator('.big_card_details_container > div').first()).toHaveCSS('border-bottom-width', '2px');
    } finally { if (created) await cleanupDatasetViaRequest(page.request, dataset); }
  });
}
