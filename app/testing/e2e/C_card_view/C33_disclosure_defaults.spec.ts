// C33_disclosure_defaults.spec.ts
// Proves all article presentations retain content while optional blocks start closed.
// Exercises native clicks, same-tab reload, separate tabs and absent setting writes.
// Creates only owned temporary datasets/media; the caller grants the browser window.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest,
  openTempDatasetRowArticle, fetchCsrfTokenForRequest } from '../helpers/temp-dataset';
import { loadDatasetCardVisibility } from '../helpers/appearance-revisions';
import { configureArticleFieldRoles, postJsonWithCsrf } from '../helpers/image-first-article';
import { openArticleDisclosure } from '../helpers/article-disclosures';
import { listRegisteredTestArtifacts } from '../helpers/test-artifact-run-registry';
import { solidPng } from '../helpers/solid-png';

const VIEWS = ['article_view', 'image_first_view', 'image_first_page_view'];
const TITLE = 'Disclosure main heading';
const BODY = 'This main article text remains visible.';
const DETAIL = 'This optional detail starts closed.';

async function readyPresentation(page: Page, view: string) {
  const root = page.locator(`[data-disclosure-surface="${view}"]:visible`).first();
  await expect(root).toHaveAttribute('data-dataset-appearance-uid', /^[1-9][0-9]*$/);
  await root.evaluate(async element => {
    await (element as HTMLElement & { __disclosureStateReady?: Promise<void> }).__disclosureStateReady;
  });
  return root;
}

async function openPresentation(page: Page, dataset: string, view: string) {
  await page.goto(`/${dataset}/1?view=${view}`, { waitUntil: 'domcontentloaded' });
  return readyPresentation(page, view);
}

async function waitForDetailsChoice(root: Locator, expanded: boolean) {
  await expect.poll(() => root.evaluate(element => {
    const { datasetAppearanceUid: uid, disclosureSurface: surface } = (element as HTMLElement).dataset;
    const state = JSON.parse(sessionStorage.getItem('filterest.disclosure-choices.v1') || 'null');
    return state?.choices?.[`${state.viewerID}:${uid}:${surface}:details`];
  })).toBe(expanded);
}

test('closed blocks keep article content visible; personal clicks belong to one presentation and tab', async ({ page, context }, info) => {
  test.skip(!['desktop-card', 'mobile-card'].includes(info.project.name), 'Desktop and phone ownership proof');
  test.setTimeout(180_000);
  await login(page, loadCredentials());
  const dataset = buildTempDatasetName('e2e_disclosures');
  const child = buildTempDatasetName('e2e_disclosure_child');
  const created: string[] = [];
  const tabs: Page[] = [];
  try {
    await createTempDataset(page, { datasetName: dataset,
      columns: { id: 'SERIAL', title: 'TEXT', description: 'TEXT', detail_note: 'TEXT' },
      seedRows: [{ title: TITLE, description: BODY, detail_note: DETAIL }] });
    created.push(dataset);
    await createTempDataset(page, { datasetName: child,
      columns: { id: 'SERIAL', title: 'TEXT', parent_ref: 'INTEGER' },
      foreignKeys: [{ referencing_column: 'parent_ref', referenced_dataset: dataset, referenced_column: 'id' }],
      seedRows: [{ title: 'Optional related row', parent_ref: 1 }] });
    created.push(child);
    await configureArticleFieldRoles(page, dataset);
    const enabled = await postJsonWithCsrf(page, '/api/asset-linking/images/enable', { parent_table: dataset, max_file_size_mb: 10 });
    expect(enabled.status, enabled.body).toBe(201);
    await openTempDatasetRowArticle(page, dataset, 1);
    await openArticleDisclosure(page, 'images');
    await page.locator('.big_card_image_gallery input[type="file"]').first().setInputFiles({
      name: 'disclosure.png', mimeType: 'image/png', buffer: solidPng(480, 320),
    });
    await expect(page.locator('[data-testid^="big-card-image-thumb-"]').first()).toBeVisible();
    // Setup opened the upload tool; discard only this test tab's deliberate setup choices.
    await page.evaluate(() => sessionStorage.removeItem('filterest.disclosure-choices.v1'));
    const writes: string[] = [];
    page.on('request', request => {
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(request.method())
        && /dataset-appearance|filterbar-section-layout|article-section-defaults|article-presentations/.test(request.url())) {
        writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });
    for (const view of VIEWS) {
      const root = await openPresentation(page, dataset, view);
      const details = root.locator('[data-article-disclosure-key="details"]');
      await expect(details).toHaveAttribute('data-disclosure-state', 'collapsed');
      if (view === 'article_view') {
        await expect(root.locator('[data-article-disclosure-key="images"]')).toBeAttached();
        const related = root.locator('[data-article-disclosure-key="related_rows"]');
        await expect(related).toBeAttached();
        await expect(related.locator('.related_tab_button').first()).toBeHidden();
      }
      const states = await root.locator('[data-article-disclosure-key]').evaluateAll(elements =>
        elements.map(element => [element.getAttribute('data-article-disclosure-key'), element.getAttribute('data-disclosure-state')]));
      expect(states.length).toBeGreaterThan(0);
      expect(states.filter(([, state]) => state !== 'collapsed')).toEqual([]);
      await expect(root.getByText(TITLE, { exact: true }).first()).toBeVisible();
      await expect(root.getByText(BODY, { exact: true }).first()).toBeVisible();
      await expect(details.getByText(DETAIL, { exact: true })).toBeHidden();
      const mediaTestID = view === 'article_view' ? 'row-article-inline-media'
        : view === 'image_first_view' ? 'row-article-image-first-media' : 'row-article-page-image';
      const media = page.getByTestId(mediaTestID).first();
      await expect(media).toBeVisible();
      expect(await media.evaluate(element => element.closest('[data-article-disclosure-key]') !== null)).toBe(false);
      await info.attach(`${view}-closed-blocks`, { body: JSON.stringify(states), contentType: 'application/json' });
      await page.screenshot({ path: info.outputPath(`${view}-closed.png`) });
      await openArticleDisclosure(page, 'details');
      await expect(details.getByText(DETAIL, { exact: true })).toBeVisible();
      await waitForDetailsChoice(root, true);
      await page.reload({ waitUntil: 'domcontentloaded' });
      const reloaded = await readyPresentation(page, view);
      await expect(reloaded.locator('[data-article-disclosure-key="details"]')).toHaveAttribute('data-disclosure-state', 'expanded');
      // A new tab shares the account cookie but not this tab's opening choices.
      const other = await context.newPage(); tabs.push(other);
      const untouched = await openPresentation(other, dataset, view);
      await expect(untouched.locator('[data-article-disclosure-key="details"]')).toHaveAttribute('data-disclosure-state', 'collapsed');
      await other.close(); tabs.pop();
    }
    // Only this owned fixture receives open defaults; site-wide settings are untouched.
    const csrf = await fetchCsrfTokenForRequest(page.request);
    const previous = (await loadDatasetCardVisibility(page.request, dataset)).dataset_appearance;
    const openDefaults = Object.fromEntries(VIEWS.map(view => [`shared.${view}_details_initial_open`, true]));
    const saved = await page.request.post('/api/admin/dataset-appearance', {
      headers: { 'X-CSRF-Token': csrf },
      data: { schema_version: 2, dataset_uid: previous.dataset_uid, tab_set: {},
        set: openDefaults, unset: [], version: previous.version, shared_version: previous.shared_version },
    });
    expect(saved.ok(), await saved.text()).toBe(true);
    expect((await saved.json()).overrides).toMatchObject(openDefaults);
    for (const view of VIEWS) {
      const root = await openPresentation(page, dataset, view);
      const details = root.locator('[data-article-disclosure-key="details"]');
      await expect(details).toHaveAttribute('data-disclosure-state', 'expanded');
      await details.locator(':scope > .row_article_disclosure_header').click();
      await expect(details).toHaveAttribute('data-disclosure-state', 'collapsed');
      await waitForDetailsChoice(root, false);
      await page.reload({ waitUntil: 'domcontentloaded' });
      const reloaded = await readyPresentation(page, view);
      await expect(reloaded.locator('[data-article-disclosure-key="details"]')).toHaveAttribute('data-disclosure-state', 'collapsed');
      // A separate tab proves that the same fixture still has an open default.
      const other = await context.newPage(); tabs.push(other);
      const untouched = await openPresentation(other, dataset, view);
      await expect(untouched.locator('[data-article-disclosure-key="details"]')).toHaveAttribute('data-disclosure-state', 'expanded');
      await other.close(); tabs.pop();
    }
    expect(writes, 'Ordinary disclosure clicks must never save shared/dataset settings').toEqual([]);
  } finally {
    for (const tab of tabs) await tab.close();
    const failures: unknown[] = [];
    for (const name of [...created].reverse().concat(dataset + '_assets')) {
      if (listRegisteredTestArtifacts().some(item => item.kind === 'dataset' && item.name === name && item.status === 'confirmed')) {
        try { await cleanupDatasetViaRequest(page.request, name); } catch (error) { failures.push(error); }
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Disclosure proof cleanup failed');
  }
});
