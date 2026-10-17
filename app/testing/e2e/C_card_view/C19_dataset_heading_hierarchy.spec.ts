// C19_dataset_heading_hierarchy.spec.ts
// Proves the audited dataset outline and preserves the original computed heading appearance.
// Connects native page navigation, disposable API fixtures and frozen pre-J17 heading rules.
// Runs both application themes over the opposite OS theme at every matrix viewport.
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import * as path from 'node:path';
import { login, loadCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest,
  fetchCsrfTokenForRequest, openTempDatasetRowArticle } from '../helpers/temp-dataset';
import { closeActiveFilterbarIfOpen, openColumnFilterAccordion,
  waitForActiveFilterbarLayout } from '../helpers/filterbar';
import { compareHeadingAppearance } from '../helpers/heading-appearance-baseline';
import { cleanupDatasetLanguageKeys } from '../helpers/dataset-language-key-cleanup';
import { readLangKeyInventory } from '../helpers/test-artifact-cleanup';
import { getCurrentArtifactRun, listRegisteredTestArtifacts, resolveArtifactRegistryRoot } from '../helpers/test-artifact-run-registry';
import { readCompletedDatasetNames } from '../helpers/test-artifact-dataset-history';
import { readRecordedDatasetColumns } from '../helpers/test-artifact-dataset-columns';

type HeadingDatasets = { populated: string; empty: string; flat: string };

async function cleanupHeadingDatasets(page: Page, ownedNames: ReadonlySet<string>, baseline: ReadonlySet<string>) {
  const errors: unknown[] = [];
  const run = getCurrentArtifactRun();
  if (!run) throw new Error('J17 fixture lost its artifact ownership registry.');
  for (const name of ownedNames) {
    const artifact = listRegisteredTestArtifacts().find(entry => entry.kind === 'dataset' && entry.name === name);
    if (!artifact) continue;
    if (artifact.status !== 'confirmed') {
      errors.push(new Error(`J17 fixture cannot clean unconfirmed dataset "${name}".`));
      continue;
    }
    try { await cleanupDatasetViaRequest(page.request, name); }
    catch (error) { errors.push(error); }
  }
  try {
    const runDirectory = path.join(resolveArtifactRegistryRoot(), run.runId);
    const completedNames = readCompletedDatasetNames(runDirectory, run.runId);
    const allNames = [...completedNames,
      ...listRegisteredTestArtifacts().filter(entry => entry.kind === 'dataset').map(entry => entry.name)];
    const columns = readRecordedDatasetColumns(runDirectory, run.runId, allNames);
    const ownedColumns = new Map([...columns].filter(([name]) => ownedNames.has(name) && completedNames.includes(name)));
    await cleanupDatasetLanguageKeys(page.request, baseline, ownedColumns);
  } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, 'J17 fixture cleanup failed');
}

const test = base.extend<{ headingDatasets: HeadingDatasets }>({
  headingDatasets: [async ({ page }, use) => {
    await login(page, loadCredentials());
    const datasets = { populated: buildTempDatasetName('e2e_j17_headings'),
      empty: buildTempDatasetName('e2e_j17_empty'), flat: buildTempDatasetName('e2e_j17_flat') };
    const ownedNames = new Set(Object.values(datasets).flatMap(name => [name, `${name}_assets`]));
    const baseline = new Set((await readLangKeyInventory(page.request)).allLangKeys);
    try {
      await use(datasets);
    } finally {
      // Fixture teardown has its own timeout and a live request context even
      // when the test body times out or creation fails after committing.
      await cleanupHeadingDatasets(page, ownedNames, baseline);
    }
  }, { timeout: 120_000 }],
});

async function setPageTheme(page: Page, theme: 'light' | 'dark') {
  await waitForActiveFilterbarLayout(page);
  await page.evaluate(theme => {
    document.body.classList.remove('light-mode', 'dark-mode', 'system-mode');
    document.body.classList.add(`${theme}-mode`);
  }, theme);
  await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
  await page.evaluate(() => document.fonts.ready);
}

async function expectOutline(root: Locator, expected: number[]) {
  const levels = await root.locator('h1,h2,h3,h4,h5,h6,[role="heading"]').evaluateAll(headings =>
    headings.map(heading => Number(heading.getAttribute('aria-level') || heading.tagName.slice(1))));
  expect(levels).toEqual(expected);
  // Include the real dataset h1 as the view's preceding heading.
  [1, ...levels].forEach((level, index, all) => {
    if (index) expect(level).toBeLessThanOrEqual(all[index - 1] + 1);
  });
}

async function enableAttachments(page: Page, dataset: string) {
  const response = await page.request.post('/api/asset-linking/attachments/enable', {
    headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(page.request) },
    data: { parent_table: dataset, max_file_size_mb: 1 },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

test('dataset headings keep their old computed look and follow the real hierarchy', async ({ page, headingDatasets }, testInfo) => {
  test.setTimeout(300_000);
  const { populated, empty, flat } = headingDatasets;
  const evidence: Record<string, unknown> = {};
  const columns = { id: 'SERIAL', name: 'TEXT', event_date: 'DATE', price: 'NUMERIC(12,2)',
    latitude: 'NUMERIC(10,6)', longitude: 'NUMERIC(10,6)' };
  // The map's external tiles are irrelevant to headings; keep this proof local.
  await page.route('https://tile.openstreetmap.org/**', route => route.abort());
  try {
    await createTempDataset(page, { datasetName: populated, columns,
      seedRows: [{ name: 'Heading / Otsikko 中文', event_date: '2026-04-15', price: 10,
        latitude: 60.1699, longitude: 24.9384 }] });
    await createTempDataset(page, { datasetName: empty, columns });
    await createTempDataset(page, { datasetName: flat, columns: { id: 'SERIAL', name: 'TEXT' } });
    await enableAttachments(page, populated);

    for (const language of ['en', 'fi']) {
      for (const theme of ['light', 'dark'] as const) {
        const prefix = `${language}-${theme}`;
        await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
        await page.evaluate(language => localStorage.setItem('chosen_language', language), language);
        const open = async (dataset: string, view: string) => {
          await page.goto(`/${dataset}?view=${view}`, { waitUntil: 'domcontentloaded' });
          await setPageTheme(page, theme);
          await expect(page.locator('html')).toHaveAttribute('lang', language);
          const title = page.locator(`#${dataset}_tab_parts_container h1.morphing-title`);
          await expect(title).toHaveCount(1);
          await closeActiveFilterbarIfOpen(page);
        };

        await open(populated, 'product_card');
        const products = page.locator(`#${populated}_product_card_view_container [data-testid="product-card-view"]`);
        await expect(products.getByTestId('product-card-title')).toBeVisible();
        await expectOutline(products, [2]);
        evidence[`${prefix}-product`] = await compareHeadingAppearance(products.getByTestId('product-card-title'));
        await openColumnFilterAccordion(page, populated, 'name');
        const filterHeadings = page.locator(`#${populated}_tab_parts_container .filter-header h2, #${populated}_tab_parts_container .filter-header h3`);
        expect(await filterHeadings.count()).toBeGreaterThan(0);
        expect(await filterHeadings.evaluateAll(headings => headings.every(heading => heading.tagName === 'H2'))).toBe(true);
        evidence[`${prefix}-filters`] = await compareHeadingAppearance(filterHeadings);
        await closeActiveFilterbarIfOpen(page);

        for (const [dataset, state] of [[populated, 'points'], [empty, 'empty']] as const) {
          await open(dataset, 'map');
          const map = page.locator(`#${dataset}_map_view_container .map-view`);
          const headings = map.locator('.map-view-list-shell h2, .map-view-empty h2');
          await expect(headings).toBeVisible();
          await expectOutline(map, [2]);
          evidence[`${prefix}-map-${state}`] = await compareHeadingAppearance(headings);
        }

        for (const [dataset, state] of [[populated, 'points'], [empty, 'empty']] as const) {
          await open(dataset, 'price_chart');
          const chart = page.locator(`#${dataset}_price_chart_view_container [data-testid="price-chart-view"]`);
          await expect(chart.locator('.price-chart-view__title')).toBeVisible();
          await expectOutline(chart, state === 'empty' ? [2, 3] : [2]);
          evidence[`${prefix}-chart-${state}`] = await compareHeadingAppearance(chart.locator('.price-chart-view__title'));
          if (state === 'empty') {
            evidence[`${prefix}-chart-nested-notice`] = await compareHeadingAppearance(chart.locator('.price-chart-view__notice h3'));
          }
        }
        await open(flat, 'price_chart');
        const fallback = page.getByTestId('chart-unavailable');
        await expect(fallback).toBeVisible();
        await expectOutline(fallback, [2]);
        evidence[`${prefix}-chart-fallback`] = await compareHeadingAppearance(fallback.locator('.chart-unavailable-title'));

        await open(populated, 'calendar');
        const calendar = page.locator(`#${populated}_calendar_view_container [data-testid="calendar-view"]`);
        await expect(calendar).toBeVisible();
        for (const mode of ['week', 'day', 'agenda', 'month']) {
          await calendar.locator(`[data-lang-key="calendar_${mode}"]`).click();
          const headings = calendar.locator('.calendar-view__week-day-heading, .calendar-view__day-heading');
          const count = await headings.count();
          if (mode === 'month') expect(count).toBe(0);
          else expect(count).toBeGreaterThan(0);
          await expectOutline(calendar, Array(count).fill(2));
          await expect(calendar.locator('.calendar-view__title')).toHaveJSProperty('tagName', 'DIV');
          evidence[`${prefix}-calendar-${mode}`] = count ? await compareHeadingAppearance(headings) : [];
        }

        await openTempDatasetRowArticle(page, populated, 1);
        await setPageTheme(page, theme);
        const attachments = page.getByTestId('big-card-attachments').first();
        await expect(attachments).toBeAttached();
        // Expand the existing article disclosure for this page only.
        await attachments.evaluate(async element => {
          const disclosure = element.closest('.animated-disclosure-section') as HTMLElement & {
            expand?: (options: { animate: boolean }) => Promise<unknown>;
          };
          await disclosure?.expand?.({ animate: false });
        });
        if (await attachments.getByTestId('big-card-attachments-count').textContent() === '0') {
          await attachments.getByTestId('big-card-attachments-input').setInputFiles({ name: 'heading-proof.pdf',
            mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nJ17 heading proof\n') });
        }
        await expect(attachments.getByTestId('big-card-attachment-preview-0')).toBeAttached();
        // Use the native control event even when the article scroll pane is outside this viewport.
        await attachments.getByTestId('big-card-attachment-preview-0').evaluate((button: HTMLElement) => button.click());
        await expect(attachments.getByTestId('big-card-pdf-preview')).not.toHaveAttribute('hidden');
        await expectOutline(attachments, [2, 3]);
        evidence[`${prefix}-attachments`] = await compareHeadingAppearance(attachments.locator('.big_card_attachment_title'));
        evidence[`${prefix}-attachment-preview`] = await compareHeadingAppearance(attachments.locator('.big_card_attachment_preview_title'), 'h4');
      }
    }
  } finally {
    await testInfo.attach('J17-heading-computed-styles', { body: JSON.stringify({
      viewport: page.viewportSize(), baseline: 'Original tags and frozen pre-J17 rules in the same DOM position', evidence,
    }, null, 2), contentType: 'application/json' });
  }
});
