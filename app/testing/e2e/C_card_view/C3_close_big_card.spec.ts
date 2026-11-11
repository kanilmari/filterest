/**
 * C3_close_big_card.spec.ts
 *
 * Verifies article dismissal through the article record bar at every width.
 * Connects card-to-article navigation with the canonical dataset list address.
 * Keeps hidden legacy chrome and internal dataset names out of the browser proof.
 */

import { test, expect, type Locator } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset } from '../helpers/navigation';
import { switchToView, openBigCard } from '../helpers/view-switch';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest, openTempDataset } from '../helpers/temp-dataset';
import { saveCardVisibilityWithFreshRevisions } from '../helpers/appearance-revisions';
import { closeActiveFilterbarIfOpen } from '../helpers/filterbar';

test.describe('C3 — Close Big Card', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('big card can be closed', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await switchToView(page, 'card');
    await page.waitForSelector('[data-testid="card-item"]', { timeout: 10000 });
    const listUrl = page.url();
    const opened = await openBigCard(page);
    expect(opened, 'The article must open before its controls can be checked').toBe(true);
    const bigCard = page.locator('[data-testid="big-card-container"]');
    await expect(bigCard).toBeVisible({ timeout: 5000 });
    const bar = bigCard.getByTestId('row-article-record-bar');
    await expect(bar).toBeVisible();
    await expect(bar.getByTestId('row-article-previous-row')).toBeVisible();
    await expect(bar.getByTestId('row-article-next-row')).toBeVisible();
    await expect(page.getByTestId('shared-topbar-article-close')).toBeHidden();
    await expect(page.getByTestId('big-card-close')).toBeHidden();
    expect(page.url()).not.toBe(listUrl);
    await bar.getByTestId('row-article-record-bar-close').click();
    await expect(page.getByTestId('card-item').first()).toBeVisible();
    // dataset_aliases.js maps the internal app_ name to this public address.
    await expect(page).toHaveURL(/\/service_catalog(?:\?.*)?$/, { timeout: 5000 });
    await expect.poll(() => new URL(page.url()).searchParams.get('view'))
      .not.toBe('article_view');
    await expect(page.locator('[data-testid="big-card-container"]:visible')).toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('.card_view_wrapper.big-card-open')).toHaveCount(0, { timeout: 5000 });
  });
});

// #996: article summaries are not full cards. Closing a changed record must
// render the actual return view, instead of stepping back to another article.
async function cardStyle(card: Locator, style: 'standard' | 'modern') {
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-card-presentation-view', 'card');
  if (style === 'modern') await expect(card).toHaveClass(/\bcard--modern\b/);
  else await expect(card).not.toHaveClass(/\bcard--modern\b/);
  const frame = card.locator(style === 'modern' ? '.card_modern_info_panel' : '.card_details_kv');
  // Both widths below use stacked details, with visible upper and lower edges.
  await expect(frame).toHaveCSS('border-top-width', '1px');
  await expect(frame).toHaveCSS('border-bottom-width', '1px');
  if (style === 'modern') {
    await expect(card.locator('.card_details_modern_tiles')).toHaveCSS('display', 'grid');
    await expect(card.locator('.card_detail_tile_icon').first()).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  }
  return frame.evaluate(element => {
    const css = getComputedStyle(element);
    return { top: css.borderTop, bottom: css.borderBottom, left: css.borderLeft,
      right: css.borderRight, radius: css.borderRadius, background: css.backgroundColor };
  });
}

test.describe('C3 — Record navigation keeps card styles', () => {
  for (const style of ['standard', 'modern'] as const) for (const theme of ['light', 'dark'] as const) {
    test(`first render and article return keep ${style} details in ${theme}`, async ({ page, context }, info) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: info.project.metadata.screenWidth === 'mobile' ? 390 : 1098, height: 900 });
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      // Account appearance is response-only; only the owned dataset is written.
      await context.route(url => url.pathname === '/api/user-visual-preference', async route => {
        expect(route.request().method()).toBe('GET');
        await route.fulfill({ json: { configured: true, revision: 1, theme_mode: theme } });
      });
      await context.addInitScript(theme => {
        localStorage.setItem('theme', theme); localStorage.setItem('chosen_language', 'fi');
      }, theme);
      await login(page, loadCredentials());
      const dataset = buildTempDatasetName('e2e_c3_return'); let created = false;
      try {
        await createTempDataset(page, { datasetName: dataset,
          columns: { id: 'SERIAL', name: 'TEXT', description: 'TEXT', e2e_status: 'TEXT', e2e_audience: 'TEXT', e2e_image: 'TEXT' },
          seedRows: ['Ensimmäinen / First', 'Toinen / Second'].map(name => ({ name,
            description: 'Kortin tiedot / Card details', e2e_status: 'Voimassa / Current',
            e2e_audience: 'Lukijat / Readers', e2e_image: '/frontend/favicon4E.png' })) });
        created = true;
        const roles: Record<string, string> = { name: 'header', description: 'description', e2e_status: 'details', e2e_audience: 'details', e2e_image: 'image' };
        await saveCardVisibilityWithFreshRevisions(page.request, dataset, visibility => ({ card_style_variant: style,
          columns: visibility.columns.map(column => roles[column.column_name] ? {
            ...column, card_element: roles[column.column_name], show_value_on_card: true,
          } : column) }));
        await openTempDataset(page, dataset, 'card');
        await closeActiveFilterbarIfOpen(page);
        await expect(page.locator('body')).toHaveClass(new RegExp(`(^| )${theme}-mode( |$)`));
        await expect(page.locator('html')).toHaveAttribute('lang', 'fi');
        const first = page.locator(`#${dataset}_card_view_container [data-testid="card-item"]`).first();
        const rowId = await first.getAttribute('data-id');
        expect(rowId).toMatch(/^\d+$/);
        const card = page.locator(`#${dataset}_card_view_container .card[data-id="${rowId}"]`);
        const initialStyle = await cardStyle(card, style);
        await info.attach('first-render', { body: await card.screenshot(), contentType: 'image/png' });

        for (const entry of ['card', 'article-collection', 'article-row']) {
          if (entry === 'card') {
            await card.getByTestId('card-item-header').click();
          } else {
            // These are entry navigations, never a reload used to repair styles.
            await page.goto(`/${dataset}${entry === 'article-row' ? `/${rowId}` : ''}?view=article_view`);
          }
          const article = page.locator('[data-testid="big-card-container"]:visible');
          await expect(article).toBeVisible();
          const bar = article.getByTestId('row-article-record-bar');
          const oldPath = new URL(page.url()).pathname;
          const next = bar.getByTestId('row-article-next-row');
          await expect(next).toBeVisible();
          const direction = await next.isEnabled() ? next : bar.getByTestId('row-article-previous-row');
          await expect(direction).toBeEnabled();
          await direction.click();
          await expect.poll(() => new URL(page.url()).pathname).not.toBe(oldPath);
          await bar.getByTestId('row-article-record-bar-close').click();
          await expect.poll(() => new URL(page.url()).pathname).toBe(`/${dataset}`);
          await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('card');
          await expect(article).toHaveCount(0);
          await closeActiveFilterbarIfOpen(page);
          // Same row, style and app theme as the initial-render comparison.
          expect(await cardStyle(card, style)).toEqual(initialStyle);
          await info.attach(`${entry}-returned`, { body: await card.screenshot(), contentType: 'image/png' });
        }
      } finally { if (created) await cleanupDatasetViaRequest(page.request, dataset); }
    });
  }
});

test('C3 — paged card selection survives row changes, Close and Back/Forward', async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: info.project.metadata.screenWidth === 'mobile' ? 390 : 1098, height: 900 });
  await login(page, loadCredentials());
  const dataset = buildTempDatasetName('e2e_c3_history'); let created = false;
  try {
    await createTempDataset(page, { datasetName: dataset,
      columns: { id: 'SERIAL', name: 'TEXT', description: 'TEXT' },
      seedRows: Array.from({ length: 100 }, (_, index) => ({
        name: `Return proof ${String(index + 1).padStart(3, '0')}`, description: 'Paged list and selected rows',
      })) });
    created = true;
    await saveCardVisibilityWithFreshRevisions(page.request, dataset, visibility => ({
      columns: visibility.columns.map(column => ({ ...column,
        ...(column.column_name === 'name' ? { card_element: 'header', show_value_on_card: true } : {}),
        ...(column.column_name === 'description' ? { card_element: 'description', show_value_on_card: true } : {}),
      })),
    }));
    await openTempDataset(page, dataset, 'card');
    await closeActiveFilterbarIfOpen(page);
    const host = page.locator(`#${dataset}_card_view_container`);
    const cards = host.locator('.card[data-id]');
    await expect(cards.first()).toBeVisible();
    const initialCount = await cards.count();
    expect(initialCount, 'The fixture must require another page').toBeLessThan(100);
    await expect.poll(async () => {
      await host.evaluate(element => { element.scrollTop = element.scrollHeight; });
      return cards.count();
    }, { timeout: 15_000 }).toBeGreaterThan(initialCount);
    const target = cards.nth(initialCount + 1);
    await target.locator('.card_checkbox').check();
    await target.getByTestId('card-item-header').scrollIntoViewIfNeeded();
    const selectionId = await target.getAttribute('data-id');
    const readList = () => host.evaluate(element => {
      const rows = Array.from(element.querySelectorAll<HTMLElement>('.card[data-id]'));
      return { scrollTop: element.scrollTop, ids: rows.map(row => row.dataset.id),
        selected: rows.filter(row => row.querySelector<HTMLInputElement>('.card_checkbox')?.checked).map(row => row.dataset.id),
        proofs: rows.map(row => (row as HTMLElement & { __c3OriginalNode?: string }).__c3OriginalNode ?? null) };
    });
    await cards.evaluateAll(elements => elements.forEach(element => {
      Object.defineProperty(element, '__c3OriginalNode', { value: element.getAttribute('data-id') });
    }));
    const before = await readList();
    expect(before.scrollTop).toBeGreaterThan(0);
    expect(before.selected).toContain(selectionId);
    const listURL = page.url();
    await target.getByTestId('card-item-header').click();
    const article = page.locator('[data-testid="big-card-container"]:visible');
    await expect(article).toBeVisible();
    const visits = [page.url()];
    for (const direction of ['next', 'next', 'previous']) {
      const button = article.getByTestId(`row-article-${direction}-row`);
      await expect(button).toBeEnabled();
      const oldURL = page.url();
      await button.click();
      await expect.poll(() => page.url()).not.toBe(oldURL);
      await expect(article).toBeVisible();
      visits.push(page.url());
    }
    await article.getByTestId('row-article-record-bar-close').click();
    const assertList = async () => {
      await expect(page).toHaveURL(listURL);
      await expect(host).toBeVisible();
      await expect(article).toHaveCount(0);
      await expect.poll(async () => (await readList()).ids).toEqual(before.ids);
      const after = await readList();
      expect(after.proofs).toEqual(before.proofs); // The original nodes, not a refetch.
      expect(after.selected).toEqual(before.selected);
      expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThanOrEqual(2);
    };
    await assertList();
    for (const url of [...visits].reverse()) {
      await page.goBack();
      await expect(page).toHaveURL(url);
      await expect(article).toBeVisible();
    }
    await page.goBack(); await assertList();
    for (const url of visits) {
      await page.goForward();
      await expect(page).toHaveURL(url);
      await expect(article).toBeVisible();
    }
    await page.goForward(); await assertList();
    await info.attach('restored-paged-list', { body: await host.screenshot(), contentType: 'image/png' });
  } finally { if (created) await cleanupDatasetViaRequest(page.request, dataset); }
});
