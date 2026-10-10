// C13_related_dataset_appearance.spec.ts
// Proves first-visit and lazy related panels use current authorized appearance.
// Connects synthetic FK datasets, revision-checked API saves and real article panels.
// Keeps light/dark overrides independent of the OS and leaves no persistent fixtures.
import { expect, test, type Page } from '@playwright/test';
import type { DatasetAppearanceResponse, RelatedTableResult } from '../../../frontend/generated/go_contract_types';
import { login, loadCredentials } from '../helpers/auth';
import { loadDatasetCardVisibility } from '../helpers/appearance-revisions';
import { buildTempDatasetName, createTempDataset, dropTempDataset, fetchCsrfTokenForRequest,
  openTempDatasetRowArticle } from '../helpers/temp-dataset';

const ARTICLE = '.content_div:not(.hidden) .row_article_container.active_row_article > .row_article_content';

async function saveRelatedAppearance(page: Page, dataset: string, width: number): Promise<DatasetAppearanceResponse> {
  const csrf = await fetchCsrfTokenForRequest(page.request);
  const previous = (await loadDatasetCardVisibility(page.request, dataset)).dataset_appearance;
  const response = await page.request.post('/api/admin/dataset-appearance', {
    headers: { 'X-CSRF-Token': csrf },
    data: { schema_version: 2, dataset_uid: previous.dataset_uid, tab_set: {},
      set: { 'shared.card_image_width': width, 'shared.label_value_layout': 'inline' }, unset: [],
      version: previous.version, shared_version: previous.shared_version },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

test('related panels revalidate first visits, lazy loads and article reloads in both themes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-card', 'One desktop browser proves the owning projection.');
  test.setTimeout(120_000);
  const parent = buildTempDatasetName('e2e_appearance_parent');
  const children = [buildTempDatasetName('e2e_appearance_child_a'), buildTempDatasetName('e2e_appearance_child_b')];
  const created: string[] = [];
  const snapshots = new Map<string, DatasetAppearanceResponse>();
  await login(page, loadCredentials());
  try {
    await createTempDataset(page, { datasetName: parent, columns: { id: 'SERIAL', title: 'TEXT' },
      seedRows: [{ title: 'Ulkoasun tarkistus' }] });
    created.push(parent);
    for (const [index, child] of children.entries()) {
      await createTempDataset(page, { datasetName: child, columns: { id: 'SERIAL', name: 'TEXT', parent_ref: 'INTEGER' },
        foreignKeys: [{ referencing_column: 'parent_ref', referenced_dataset: parent, referenced_column: 'id' }],
        seedRows: [{ name: 'Liittyvä rivi', parent_ref: 1 }] });
      created.push(child);
      snapshots.set(child, await saveRelatedAppearance(page, child, 420 + index * 20));
    }
    // Setup uses APIs only: neither related dataset has been visited in the browser.
    const initialResponse = page.waitForResponse(response => response.url().includes('/api/fetch-dynamic-children')
      && response.request().postDataJSON()?.parent_dataset === parent
      && !response.request().postDataJSON()?.child_table);
    await page.emulateMedia({ colorScheme: 'dark' });
    await openTempDatasetRowArticle(page, parent, 1);
    const initial = await (await initialResponse).json() as { child_tables: RelatedTableResult[] };
    for (const child of children) {
      const result = initial.child_tables.find(entry => entry.dataset === child);
      expect(result?.dataset_uid).toBe(snapshots.get(child)!.dataset_uid);
      expect(result?.dataset_appearance?.version).toBe(snapshots.get(child)!.version);
      const panel = page.locator(`${ARTICLE} .related_tab_panel[data-dataset-appearance-scope="${child}"]`);
      await expect(panel).toHaveAttribute('data-dataset-appearance-resolved', 'true');
      await expect(panel).toHaveAttribute('data-label-value-layout', 'inline');
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => {
          document.body.classList.remove('light-mode', 'dark-mode');
          document.body.classList.add(`${theme}-mode`);
        }, theme);
        await expect.poll(() => panel.evaluate(element => getComputedStyle(element)
          .getPropertyValue('--card_image_large_width').trim())).toBe(`${420 + children.indexOf(child) * 20}px`);
      }
    }
    const inactivePanel = page.locator(`${ARTICLE} .related_tab_panel:not(.active)[data-dataset-appearance-scope]`).first();
    const child = await inactivePanel.getAttribute('data-dataset-appearance-scope');
    expect(children).toContain(child);
    const lazyPanel = page.locator(`${ARTICLE} .related_tab_panel[data-dataset-appearance-scope="${child}"]`);
    const current = await saveRelatedAppearance(page, child!, 480);
    const lazyResponse = page.waitForResponse(response => response.url().includes('/api/fetch-dynamic-children')
      && response.request().postDataJSON()?.child_table === child);
    await page.locator(`${ARTICLE} .related_tab_button[data-tab-key^="${child}__"]`).click();
    const lazy = await (await lazyResponse).json() as { child_tables: RelatedTableResult[] };
    expect(lazy.child_tables.find(entry => entry.dataset === child)?.dataset_appearance?.version).toBe(current.version);
    await expect(lazyPanel.locator('.related_record_list_item')).toHaveCount(1);
    await expect.poll(() => lazyPanel.evaluate(element => getComputedStyle(element)
      .getPropertyValue('--card_image_large_width').trim())).toBe('480px');
    await page.reload({ waitUntil: 'domcontentloaded' });
    const reloaded = page.locator(`${ARTICLE} .related_tab_panel[data-dataset-appearance-scope="${child}"]`);
    await expect(reloaded).toHaveAttribute('data-dataset-appearance-resolved', 'true');
    await expect.poll(() => reloaded.evaluate(element => getComputedStyle(element)
      .getPropertyValue('--card_image_large_width').trim())).toBe('480px');
  } finally {
    for (const dataset of [...created].reverse()) await dropTempDataset(page, dataset);
  }
});
