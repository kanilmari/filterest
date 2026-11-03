/**
 * I7_edit_during_rebuild.spec.ts
 * Proves live updates preserve inline drafts and the selected cell after confirmation.
 * Bridges two dataset pages and a deliberately held listing response with the real SSE path.
 * Uses response/DOM barriers so a delayed rebuild cannot masquerade as a successful edit.
 */
import { expect, test, type Page, type Response } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName, cleanupDatasetViaRequest, createTempDataset, openTempDataset,
} from '../helpers/temp-dataset';

declare global {
  interface Window { __i7RowChanges: number; }
}

function listingFor(response: Response, dataset: string) {
  const url = new URL(response.url());
  return url.pathname === '/api/get-results' && url.searchParams.get('dataset') === dataset;
}

function quantityCell(page: Page, dataset: string) {
  return page.locator(`#${dataset}_table_view_container tr`).filter({ hasText: 'second-row' })
    .locator('[data-column="quantity"]');
}

async function createFixture(page: Page, datasetName: string) {
  await createTempDataset(page, {
    datasetName, columns: { id: 'SERIAL', quantity: 'INTEGER', label: 'TEXT' },
    seedRows: [{ quantity: 7, label: 'probe-row' }, { quantity: 8, label: 'second-row' }],
  });
  await openTempDataset(page, datasetName, 'table');
  await expect(quantityCell(page, datasetName)).toHaveText('8');
}

test.describe('I7 — Inline editor during rebuild', () => {
  let credentials: TestCredentials;
  test.beforeAll(() => { credentials = loadCredentials(); });

  test('an open editor outlives a rebuild and saves nothing unconfirmed', async ({ page, context, request }) => {
    // Proves cases A/B: a listing already in flight and another page's save preserve the draft.
    // The released response is the clock; a reloaded second page proves no unconfirmed write persisted.
    test.setTimeout(90_000);
    await page.addInitScript(() => {
      window.__i7RowChanges = 0;
      window.EventSource = new Proxy(window.EventSource, {
        construct(Source, args) {
          const source = Reflect.construct(Source, args) as EventSource;
          source.addEventListener('row_change', () => { window.__i7RowChanges += 1; });
          return source;
        },
      });
    });
    await login(page, credentials);
    const dataset = buildTempDatasetName('e2e_i7_draft');
    let listingRequests = 0;
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname === '/api/get-results' && url.searchParams.get('dataset') === dataset) listingRequests += 1;
    });
    const other = await context.newPage();
    await other.setViewportSize(page.viewportSize()!);
    let release = () => {};
    let captured = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    const requested = new Promise<void>(resolve => { captured = resolve; });
    const pattern = '**/api/get-results*';
    let intercepted = false;
    try {
      await createFixture(page, dataset);
      await openTempDataset(other, dataset, 'table');
      await page.route(pattern, async route => {
        const url = new URL(route.request().url());
        if (intercepted || url.searchParams.get('dataset') !== dataset) return route.continue();
        intercepted = true;
        const response = await route.fetch();
        captured();
        await held;
        await route.fulfill({ response });
      });
      const cell = quantityCell(page, dataset);
      await cell.dblclick();
      const editor = page.locator('[data-testid="table-editor"][type="number"]');
      await editor.fill('42');
      const saved = page.waitForResponse(response => response.url().includes('/api/update-row')
        && new URL(response.url()).searchParams.get('dataset') === dataset);
      await editor.press('Enter'); await saved;
      await expect(cell).toHaveText('42');
      await requested; // This get-results began before the second edit.
      await cell.dblclick(); await editor.fill('55');
      const rebuilt = page.waitForResponse(response => listingFor(response, dataset));
      release(); await (await rebuilt).finished();
      await expect(editor).toBeVisible(); await expect(editor).toHaveValue('55');

      await other.reload();
      await expect(quantityCell(other, dataset)).toHaveText('42');
      const otherCell = other.locator(`#${dataset}_table_view_container [data-column="label"]`)
        .filter({ hasText: /^probe-row$/ });
      await otherCell.dblclick();
      const otherEditor = other.locator('[data-testid="table-editor"]');
      await otherEditor.fill('changed-in-other-tab');
      const otherSaved = other.waitForResponse(response => response.url().includes('/api/update-row')
        && new URL(response.url()).searchParams.get('dataset') === dataset);
      const otherRebuilt = other.waitForResponse(response => listingFor(response, dataset));
      const before = await page.evaluate(() => window.__i7RowChanges);
      const listingsBefore = listingRequests;
      await otherEditor.press('Enter'); await otherSaved;
      await expect.poll(() => page.evaluate(() => window.__i7RowChanges)).toBeGreaterThan(before);
      await (await otherRebuilt).finished();
      await test.step('Settle after the editing page receives the row change', async () => {
        await page.waitForTimeout(500); // REFRESH_DEBOUNCE_MS is 180: a rebuild that wasn't held would have started by now
        expect(listingRequests).toBe(listingsBefore);
      });
      await expect(editor).toHaveValue('55');
      await editor.press('Escape');
      await expect(page.locator(`#${dataset}_table_view_container [data-column="label"]`)
        .filter({ hasText: /^changed-in-other-tab$/ })).toBeVisible();
      await expect(cell).toHaveText('42');
      await other.reload(); await expect(quantityCell(other, dataset)).toHaveText('42');
    } finally {
      release();
      try { await page.unroute(pattern); } finally {
        try { await other.close(); } finally { await cleanupDatasetViaRequest(request, dataset); }
      }
    }
  });

  test('the same cell stays selected after a save and the arrows still move', async ({ page, request }) => {
    // Proves case C: selection belongs to the same row/column after the SSE swap, and real keys use it.
    // Waiting for the listing response and the old node's removal proves the assertion sees the rebuilt row.
    test.setTimeout(90_000);
    await login(page, credentials);
    const dataset = buildTempDatasetName('e2e_i7_selection');
    try {
      await createFixture(page, dataset);
      const cell = quantityCell(page, dataset);
      const oldCell = await cell.elementHandle();
      const rowId = await cell.evaluate(element => (element.closest('tr') as HTMLElement).dataset.rowId);
      await cell.dblclick();
      const editor = page.locator('[data-testid="table-editor"][type="number"]');
      await editor.fill('42');
      const rebuild = page.waitForResponse(response => listingFor(response, dataset));
      await editor.press('Enter'); await (await rebuild).finished();
      await expect.poll(() => oldCell!.evaluate(element => element.isConnected)).toBe(false);
      const selected = page.locator(`#${dataset}_table_view_container .selected_for_editing`);
      await expect(selected).toHaveAttribute('data-column', 'quantity');
      await expect(selected.locator('..')).toHaveAttribute('data-row-id', rowId!);
      await expect(selected).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(selected).toHaveAttribute('data-column', 'label');
      await expect(selected.locator('..')).toHaveAttribute('data-row-id', rowId!);
      await expect(selected).toBeFocused();
    } finally { await cleanupDatasetViaRequest(request, dataset); }
  });
});
