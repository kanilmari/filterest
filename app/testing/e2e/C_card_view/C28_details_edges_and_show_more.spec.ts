// C28_details_edges_and_show_more.spec.ts
// Proves card list edges and category-token rounding in both card image sizes.
// Uses the existing owned dataset fixture; appearance writes affect only that dataset.
// Exercises explicit application themes over opposite OS themes and cleans up on failure.
import { expect, test, type Locator } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest, openTempDataset, openTempDatasetRowArticle } from '../helpers/temp-dataset';
import { saveCardVisibilityWithFreshRevisions } from '../helpers/appearance-revisions';
import { closeActiveFilterbarIfOpen } from '../helpers/filterbar';

async function expectListEdges(list: Locator) {
  await expect(list).toBeVisible();
  const edges = await list.evaluate(element => {
    const css = getComputedStyle(element), probe = document.createElement('span');
    probe.style.borderTop = '1px solid var(--border_color)'; element.append(probe);
    const color = getComputedStyle(probe).borderTopColor; probe.remove();
    return { radii: [css.borderTopLeftRadius, css.borderTopRightRadius, css.borderBottomLeftRadius, css.borderBottomRightRadius],
      left: css.borderLeftWidth, right: css.borderRightWidth, top: css.borderTopWidth, bottom: css.borderBottomWidth,
      topColor: css.borderTopColor, bottomColor: css.borderBottomColor, color };
  });
  expect(edges.radii).toEqual(['0px', '0px', '0px', '0px']);
  expect(edges.left).toBe('0px'); expect(edges.right).toBe('0px');
  expect(parseFloat(edges.top)).toBeGreaterThan(0); expect(parseFloat(edges.bottom)).toBeGreaterThan(0);
  expect(edges.topColor).toBe(edges.color); expect(edges.bottomColor).toBe(edges.color);
}

for (const width of [390, 1440]) for (const theme of ['light', 'dark'] as const) for (const size of ['small', 'large']) {
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
      // `created`/`updated` are system columns that row inserts refuse (add_row_db.go), so the dated details field is `published`.
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
        await expectListEdges(list);
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
      await expectListEdges(page.locator('.big_card_details_container:visible'));
      await expect(page.locator('.big_card_details_container > div').first()).toHaveCSS('border-bottom-width', '2px');
    } finally { if (created) await cleanupDatasetViaRequest(page.request, dataset); }
  });
}
