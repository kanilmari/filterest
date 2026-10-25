// T23_permissions_rights_fingerprint.spec.ts
// Pins the two legacy Permissions matrices through payloads and server-side rights fingerprints.
// Matrix-only UI functions and supported grant APIs keep fixture policy review intact.
// Full replacements are fulfilled locally; only owned e2e_ dataset changes reach the server.
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, dropTempDataset, fetchCsrfTokenForRequest } from '../helpers/temp-dataset';
import { openPermissionsTree, PERMISSIONS_TREE_SELECTOR } from '../helpers/permissions-tree';
import { buildRightsFingerprints } from '../helpers/permissions-rights-fingerprint';

type Row = { id: number } & Record<string, any>;
type Right = { user_group_id: number; function_id: number; target_schema_name: string | null; target_table_uid: number | null };
type Fixture = { names: string[]; groups: string[]; functions: string[]; groupIDs: number[]; functionIDs: number[] };
let fixture: Fixture;

async function readRows(page: Page, dataset: string, fields: Record<string, string | number> = {}): Promise<Row[]> {
  const rows: Row[] = [];
  for (let offset = 0; ; ) {
    const query = new URLSearchParams({ dataset, view_key: 'table', offset: String(offset) });
    for (const [key, value] of Object.entries(fields)) {
      query.set(`${key}_from`, String(value)); query.set(`${key}_to`, String(value));
    }
    const response = await page.request.get(`/api/get-results?${query}`);
    expect(response.ok(), await response.text()).toBe(true);
    const body = await response.json();
    expect(Array.isArray(body.data)).toBe(true);
    rows.push(...body.data);
    if (body.data.length < (body.resultsPerLoad || 20)) break;
    offset += body.data.length;
  }
  for (const row of rows) expect(row).toMatchObject(fields);
  return rows;
}
async function readRightsSnapshot(page: Page) {
  const [rows, datasets] = await Promise.all([
    readRows(page, 'system_group_table_func_rights'), readRows(page, 'system_db_tables'),
  ]);
  return { rows, datasetUIDs: new Set(datasets.map(row => Number(row.table_uid))) };
}
async function addRow(page: Page, dataset: string, fields: Record<string, unknown>) {
  const response = await page.request.post(`/api/add-row-multipart?dataset=${dataset}`, {
    headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(page.request) }, multipart: { jsonPayload: JSON.stringify(fields) },
  });
  expect(response.status(), await response.text()).toBe(201);
}
async function deleteRows(page: Page, dataset: string, ids: number[]) {
  if (!ids.length) return;
  const response = await page.request.post(`/api/delete-rows?dataset=${dataset}`, {
    headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(page.request) }, data: { ids },
  });
  expect(response.ok(), await response.text()).toBe(true);
}
async function expectUnchangedRights(
  page: Page, before: Row[], after: Row[], snapshotDatasetUIDs: ReadonlySet<number>, message: string,
) {
  // Read after the rights listing; a paged catalog miss needs an exact-UID check before exclusion.
  const scannedDatasetUIDs = new Set((await readRows(page, 'system_db_tables')).map(row => Number(row.table_uid)));
  const fingerprints = await buildRightsFingerprints(before, after, snapshotDatasetUIDs, scannedDatasetUIDs,
    async datasetUID => (await readRows(page, 'system_db_tables', { table_uid: datasetUID })).length === 0);
  expect(fingerprints.after, message).toEqual(fingerprints.before);
}
const sortRights = (rights: Right[]) => [...rights].sort((a, b) =>
  a.user_group_id - b.user_group_id || a.function_id - b.function_id ||
  String(a.target_schema_name).localeCompare(String(b.target_schema_name)) ||
  (a.target_table_uid ?? 0) - (b.target_table_uid ?? 0));

// afterEach runs for assertion/setup failures too. Each cleanup is attempted even if another fails.
test.afterEach(async ({ page }) => {
  if (!fixture) return;
  const errors: unknown[] = [];
  for (const name of [...fixture.groups].reverse()) {
    try {
      const groups = await readRows(page, 'system_user_groups', { name });
      expect(groups.length).toBeLessThanOrEqual(1);
      if (!groups.length) continue;
      const known = fixture.groupIDs[fixture.groups.indexOf(name)];
      if (known) expect(groups[0].id).toBe(known);
      const rights = await readRows(page, 'system_group_table_func_rights', { user_group_id: groups[0].id });
      await deleteRows(page, 'system_group_table_func_rights', rights.map(row => row.id));
      await deleteRows(page, 'system_user_groups', [groups[0].id]);
      expect(await readRows(page, 'system_user_groups', { name })).toEqual([]);
    } catch (error) { errors.push(error); }
  }
  for (const name of [...fixture.functions].reverse()) {
    try {
      const functions = await readRows(page, 'system_functions', { name });
      expect(functions.length).toBeLessThanOrEqual(1);
      const known = fixture.functionIDs[fixture.functions.indexOf(name)];
      if (known && functions.length) expect(functions[0].id).toBe(known);
      await deleteRows(page, 'system_functions', functions.map(row => row.id));
    } catch (error) { errors.push(error); }
  }
  for (const name of [...fixture.names].reverse()) {
    try { await dropTempDataset(page, name); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'Fingerprint fixture teardown failed');
});

test('K390PermissionsRightsFingerprint', async ({ page }, testInfo: TestInfo) => {
  // Phones: the Permissions editor's group matrix overlaps its own layout there (cells outside the viewport, the
  // column select-all covered by the management layout), so this flow cannot be driven by pointer. The rights it
  // fingerprints are the same on every viewport; tablet and desktop prove them through the real editor.
  test.skip(testInfo.project.name === 'mobile-card', 'Tablet and desktop prove the rights; the phone layout of the Permissions matrix is reviewed separately.');
  // ~6 min natively on a quiet machine, ~20 min under load (19.10.: 20.3 min with three Codex runs alongside): each
  // checkpoint pages the whole rights listing (~5,300 rows on dev) 20 rows at a time.
  test.setTimeout(2_400_000);
  fixture = { names: [], groups: [], functions: [], groupIDs: [], functionIDs: [] };
  await login(page, loadCredentials());
  // These are isolated browser-context preferences, never server/site settings.
  await page.evaluate(() => {
    localStorage.removeItem('permissions_tableless');
    localStorage.removeItem('permissions_search_term');
    localStorage.setItem('permissions_filter_endpoint', 'ui');
  });
  const prefix = buildTempDatasetName('e2e_k390');
  const datasetUIDs: number[] = [];
  for (const suffix of ['x', 'y', 'unselected']) {
    const name = buildTempDatasetName(`e2e_k390_${suffix}`);
    await createTempDataset(page, { datasetName: name, columns: { id: 'SERIAL', title: 'TEXT' } });
    fixture.names.push(name);
    const [dataset] = await readRows(page, 'system_db_tables', { table_name: name });
    datasetUIDs.push(Number(dataset.table_uid));
  }
  for (const suffix of ['a', 'b']) {
    const name = `${prefix}_${suffix}`;
    expect(await readRows(page, 'system_user_groups', { name })).toEqual([]);
    fixture.groups.push(name);
    await addRow(page, 'system_user_groups', { name });
    const [group] = await readRows(page, 'system_user_groups', { name }); fixture.groupIDs.push(group.id);
  }
  // F/T appear under the same search. G is filtered out; disabled H is absent from the editor.
  // These functions exercise matrix state, not server data routes. Inventing an active
  // table-related server route creates an unclassified-route blocker at registration
  // (runtime_grants/route_classifier.go); UI-only functions have no runtime data grant.
  for (const [suffix, scoped] of [['matrix_scoped', true], ['matrix_global', false], ['sentinel_global', false], ['hidden', true]] as const) {
    const name = `${prefix}_${suffix}`;
    expect(await readRows(page, 'system_functions', { name })).toEqual([]);
    fixture.functions.push(name);
    await addRow(page, 'system_functions', { name, url_route_endpoint: `/ui/${name}`, disabled: suffix === 'hidden', ui_only: true, specific_table_related: scoped });
    const [fn] = await readRows(page, 'system_functions', { name }); fixture.functionIDs.push(fn.id);
  }
  const [A, B] = fixture.groupIDs, [F, T, G, H] = fixture.functionIDs;
  const [X, Y, Z] = datasetUIDs;
  function expectOwnedDatasetRights(rights: Array<Right & { target_dataset_name: string }>) {
    expect(rights.every(right => fixture.groupIDs.includes(right.user_group_id) &&
      fixture.functionIDs.includes(right.function_id) && right.target_schema_name === 'public' &&
      datasetUIDs.includes(right.target_table_uid!) &&
      right.target_dataset_name === fixture.names[datasetUIDs.indexOf(right.target_table_uid!)])).toBe(true);
  }
  // Match permission_granter.js: dataset-scoped additions use PATCH, retaining all
  // unrelated rights. Request-context writes do not pass through page.route, so
  // apply the same ownership assertion here as on the later editor PATCHes.
  const scopedSeed = [[A, F, X], [B, F, Y], [A, H, X], [B, F, Z]].map(([user_group_id, function_id, target_table_uid]) => ({
    user_group_id, function_id, target_schema_name: 'public', target_table_uid,
    target_dataset_name: fixture.names[datasetUIDs.indexOf(target_table_uid)],
  }));
  expectOwnedDatasetRights(scopedSeed);
  const seeded = await page.request.patch('/api/dataset_permissions', {
    headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(page.request) }, data: { add: scopedSeed, remove: [] },
  });
  expect(seeded.status(), await seeded.text()).toBe(200);
  // C17:giveReaderArticleAccess seeds globals by adding one rights row on its own
  // group. PATCH requires a dataset; a tableless full POST must never be forwarded.
  await addRow(page, 'system_group_table_func_rights', {
    user_group_id: B, function_id: G, target_schema_name: 'public', target_table_uid: null,
  });
  const snapshot = await readRightsSnapshot(page);
  const nonOwned = snapshot.rows.filter(row => !fixture.groupIDs.includes(row.user_group_id));
  const expected = (tuples: Array<[string, string, string | null]>) => tuples.map(([group, fn, dataset]) => ({
    group: fixture.groups[group === 'A' ? 0 : 1], function: fixture.functions[['F', 'T', 'G', 'H'].indexOf(fn)],
    route: `/ui/${fixture.functions[['F', 'T', 'G', 'H'].indexOf(fn)]}`,
    scope: { schema: 'public', dataset: dataset === null ? null : fixture.names[['X', 'Y', 'Z'].indexOf(dataset)],
      datasetUID: dataset === null ? null : datasetUIDs[['X', 'Y', 'Z'].indexOf(dataset)] },
  })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  async function checkpoint(name: string, tuples: Array<[string, string, string | null]>) {
    const all = await readRows(page, 'system_group_table_func_rights');
    const own = all.filter(row => fixture.groupIDs.includes(row.user_group_id));
    // The generic listing includes the disabled sentinel omitted by dataset_permissions.
    const functions = (await Promise.all(fixture.functionIDs.map(id => readRows(page, 'system_functions', { id })))).flat();
    const functionByID = new Map(functions.map(fn => [fn.id, fn]));
    const response = await page.request.get('/api/dataset_permissions');
    expect(response.ok(), await response.text()).toBe(true);
    const permissions: Array<Right & { function_route: string; target_dataset_name: string }> = await response.json();
    const serverEntry = (row: Row) => permissions.find(entry => entry.user_group_id === row.user_group_id &&
      entry.function_id === row.function_id && entry.target_schema_name === row.target_schema_name &&
      (entry.target_table_uid || null) === (row.target_table_uid || null));
    const listing = own.map(row => ({ group: fixture.groups[fixture.groupIDs.indexOf(row.user_group_id)],
      function: functionByID.get(Number(row.function_id))?.name,
      route: functionByID.get(Number(row.function_id))?.url_route_endpoint,
      scope: { schema: row.target_schema_name, dataset: row.target_table_uid === null ? null : (serverEntry(row)?.target_dataset_name ?? fixture.names[datasetUIDs.indexOf(Number(row.target_table_uid))]),
        datasetUID: row.target_table_uid === null ? null : Number(row.target_table_uid) },
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    await testInfo.attach(name, { body: JSON.stringify(listing, null, 2), contentType: 'application/json' });
    expect(listing, name).toEqual(expected(tuples));
    await expectUnchangedRights(page, nonOwned, all.filter(row => !fixture.groupIDs.includes(row.user_group_id)),
      snapshot.datasetUIDs, `${name}: existing groups unchanged`);
  }
  let fullPost: { before: Row[]; datasetUIDs: ReadonlySet<number>; permissions: Right[]; intercepted: boolean } | null = null;
  // A full POST deletes/replaces ALL public/global grants, so NEVER forward one, even
  // if its payload matches a fresh read: another administrator could write after that read.
  // The pending expectation is armed immediately before Save, independently of UI state.
  await page.route(/\/api\/dataset_permissions(?:\?|$)/, async route => {
    const request = route.request();
    if (!['POST', 'PATCH'].includes(request.method())) { await route.continue(); return; }
    try {
      const payload = request.postDataJSON();
      if (request.method() === 'PATCH') {
        expect(payload).toEqual({ add: expect.any(Array), remove: expect.any(Array) });
        expectOwnedDatasetRights([...payload.add, ...payload.remove]);
      } else {
        expect(fullPost, 'Unexpected full replacement must stay intercepted').not.toBeNull();
        expect(fullPost!.intercepted, 'Exactly one full POST per Save').toBe(false);
        expect(payload).toEqual({ permissions: expect.any(Array) });
        // Compare every field and duplicate: the non-owned enabled globals from the fresh
        // raw listing, plus the explicit owned-group expectation.
        expect(sortRights(payload.permissions)).toEqual(sortRights(fullPost!.permissions));
        fullPost!.intercepted = true;
        // createPermissions returns this same 201 body for an unchanged save
        // (permissions_handlers.go). No route.continue/fetch is allowed for POST.
        await route.fulfill({ status: 201, contentType: 'application/json',
          body: JSON.stringify({ message: 'permissions saved successfully' }) });
        return;
      }
    } catch {
      await route.fulfill({ status: 409, contentType: 'application/json',
        body: JSON.stringify({ error: 'Fingerprint blocked a write outside owned fixtures' }) });
      return;
    }
    await route.continue();
  });
  // Every listing is explicit; no expected rights are inferred from actual UI/server state.
  await checkpoint('seed', [['A', 'F', 'X'], ['B', 'F', 'Y'], ['B', 'G', null], ['A', 'H', 'X'], ['B', 'F', 'Z']]);
  // The granter resolves target_table_uid from the table specs loaded at app start;
  // reload so the datasets created above are in them (else the PATCH carries null uids).
  await page.reload();
  await openPermissionsTree(page);
  const matrices = page.locator('#permissions_container .vct-root');
  const scoped = matrices.nth(0), tableless = matrices.nth(1);
  const search = page.locator('.mp-search-input');
  await search.fill(`${prefix}_matrix`);
  await expect(scoped.locator("tbody .vct-row")).toHaveCount(1);
  await expect(tableless.locator("tbody .vct-row")).toHaveCount(1);
  async function select(names: string[]) {
    for (const name of names) await page.locator(`${PERMISSIONS_TREE_SELECTOR} [data-lang-key="${name}"]`).first().waitFor({ state: 'attached' });
    await page.evaluate(({ names, selector }) => {
      const tree = document.querySelector(selector)!;
      const selectedCategories = names.map(name => {
        const label = tree.querySelector(`[data-lang-key="${name}"]`);
        const node = label?.closest('[data-table-uid]');
        if (!node?.id) throw new Error(`Missing owned dataset node ${name}`);
        return node.id;
      });
      document.dispatchEvent(new CustomEvent('checkboxSelectionChanged', { detail: { selectedCategories } }));
    }, { names, selector: PERMISSIONS_TREE_SELECTOR });
    await expect(page.locator('.mp-table-section-description').first()).toContainText(names.join(', '));
  }
  async function cell(matrix: typeof scoped, fn: number, checked: boolean) {
    await matrix.locator('.vct-btn-edit').click();
    const groupIndex = await matrix.locator('thead th').evaluateAll((nodes, name) =>
      nodes.findIndex(node => node.textContent?.replace(/\s/g, '') === name.replace(/\s/g, '')), fixture.groups[0]);
    expect(groupIndex).toBeGreaterThan(0);
    const input = matrix.locator(`tr[data-row-id="${fn}"] td`).nth(groupIndex).locator('input');
    // Phones: the matrix scrolls sideways in its own container, and Playwright's automatic scroll left the column
    // outside the viewport (b245r3 mobile-card, 40 min of retries). Centre it and click it in the page, as T7 does.
    await input.evaluate((el, want) => {
      const box = el as HTMLInputElement;
      box.scrollIntoView({ block: 'center', inline: 'center' });
      if (box.checked !== want) box.click();
    }, checked);
    await expect(input).toBeChecked({ checked });
  }
  // via 'question': the editor's unsaved-changes question is already open (permission_editor.js handleUnsavedChanges);
  // its Confirm runs the same saveChanges() as the toolbar Save.
  async function save(matrix: typeof scoped, method: 'PATCH' | 'POST', ownedGlobals: Array<[number, number]> = [],
    via: 'toolbar' | 'question' = 'toolbar') {
    if (method === 'POST') {
      // Read immediately before the Save click, never reuse the seed/preflight snapshot.
      const { rows: before, datasetUIDs: snapshotDatasetUIDs } = await readRightsSnapshot(page);
      const nonOwnedGlobals = before.filter(row => !fixture.groupIDs.includes(row.user_group_id) &&
        row.target_schema_name === 'public' && row.target_table_uid === null)
        .map(({ user_group_id, function_id, target_schema_name, target_table_uid }) =>
          ({ user_group_id, function_id, target_schema_name, target_table_uid }));
      // The legacy granter rebuilds globals from GET /api/dataset_permissions, which omits
      // disabled functions (getPermissions in permissions_handlers.go). Pin that payload and
      // prove every omitted raw global belongs to a disabled function, nothing else.
      const listed = await page.request.get('/api/dataset_permissions');
      expect(listed.ok(), await listed.text()).toBe(true);
      const visible = new Set((await listed.json() as Right[]).filter(entry => !entry.target_table_uid)
        .map(entry => `${entry.user_group_id}-${entry.function_id}`));
      const isVisible = (right: Right) => visible.has(`${right.user_group_id}-${right.function_id}`);
      for (const right of nonOwnedGlobals.filter(right => !isVisible(right))) {
        const [fn] = await readRows(page, 'system_functions', { id: right.function_id });
        expect(fn?.disabled, `omitted global ${right.user_group_id}-${right.function_id} is a disabled function`).toBe(true);
      }
      fullPost = { before, datasetUIDs: snapshotDatasetUIDs, intercepted: false, permissions: [...nonOwnedGlobals.filter(isVisible),
        ...ownedGlobals.map(([user_group_id, function_id]) =>
          ({ user_group_id, function_id, target_schema_name: 'public', target_table_uid: null }))] };
    }
    const response = page.waitForResponse(response => response.url().includes('/api/dataset_permissions') && response.request().method() === method);
    if (via === 'question') await page.getByTestId('confirm-modal-confirm-button').click();
    else await matrix.locator('.vct-btn-save').click();
    const result = await response;
    expect(result.ok(), `${method} ${result.status()}: ${await result.text()}`).toBe(true);
    await expect(matrix.locator('.vct-btn-edit')).toBeVisible();
    if (method === 'POST') {
      expect(fullPost!.intercepted).toBe(true);
      expect(result.status()).toBe(201);
      expect(await result.json()).toEqual({ message: 'permissions saved successfully' });
      await expectUnchangedRights(page, fullPost!.before, await readRows(page, 'system_group_table_func_rights'),
        fullPost!.datasetUIDs, 'Intercepted full POST leaves global and snapshot-time dataset grants unchanged');
      fullPost = null;
    }
  }
  async function bulk(matrix: typeof scoped) {
    await matrix.locator('.vct-btn-edit').click();
    const index = await matrix.locator('thead th').evaluateAll((nodes, name) => nodes.findIndex(node => node.textContent === name), fixture.groups[0]);
    await matrix.locator('thead th').nth(index).locator('.mp-select-all').click();
  }
  await select([fixture.names[0]]);
  await cell(scoped, F, false); await save(scoped, 'PATCH');
  await checkpoint('single dataset PATCH', [['B', 'F', 'Y'], ['B', 'G', null], ['A', 'H', 'X'], ['B', 'F', 'Z']]);
  await cell(scoped, F, true); await save(scoped, 'PATCH');
  await checkpoint('restore one selected grant', [['A', 'F', 'X'], ['B', 'F', 'Y'], ['B', 'G', null], ['A', 'H', 'X'], ['B', 'F', 'Z']]);
  await select(fixture.names.slice(0, 2));
  await cell(scoped, F, true); await save(scoped, 'PATCH');
  await checkpoint('multiple datasets mixed PATCH', [['A', 'F', 'X'], ['A', 'F', 'Y'], ['B', 'F', 'Y'], ['B', 'G', null], ['A', 'H', 'X'], ['B', 'F', 'Z']]);
  await bulk(scoped); await save(scoped, 'PATCH');
  await checkpoint('filtered scoped header', [['B', 'F', 'Y'], ['B', 'G', null], ['A', 'H', 'X'], ['B', 'F', 'Z']]);

  // Full POST checkpoints pin the real granter's outgoing payload and local success outcome.
  // They never persist A/T: every server listing stays at the preceding scoped checkpoint.
  await bulk(tableless); await save(tableless, 'POST', [[A, T], [B, G]]);
  await checkpoint('filtered tableless header intercepted full POST', [['B', 'F', 'Y'], ['B', 'G', null], ['A', 'H', 'X'], ['B', 'F', 'Z']]);
  // Legacy Save adopts the submitted UI baseline; removing A's last editable grant
  // therefore submits only B's sentinel, although A/T was never written to the server.
  await cell(tableless, T, false); await save(tableless, 'POST', [[B, G]]);
  await checkpoint('remove final editable tableless grant', [['B', 'F', 'Y'], ['B', 'G', null], ['A', 'H', 'X'], ['B', 'F', 'Z']]);
  await cell(scoped, F, true); await scoped.locator('.vct-btn-cancel').click();
  await cell(tableless, T, true); await tableless.locator('.vct-btn-cancel').click();
  // Neither Cancel sends a replacement or changes the unchanged global listing.
  await checkpoint('Cancel', [['B', 'F', 'Y'], ['B', 'G', null], ['A', 'H', 'X'], ['B', 'F', 'Z']]);
  await cell(tableless, T, true);
  await checkpoint('draft staged', [['B', 'F', 'Y'], ['B', 'G', null], ['A', 'H', 'X'], ['B', 'F', 'Z']]);
  // Legacy v1 recovery re-creates both matrices; staging/recovery writes nothing.
  page.on('dialog', dialog => dialog.accept());
  await page.reload(); await openPermissionsTree(page);
  await expect(tableless.locator('.vct-btn-save')).toBeVisible();
  // Opening Permissions with a recovered dirty draft passes the navigation dirty check
  // (window.check_manage_permissions_dirty), which asks the unsaved-changes question before anything else.
  await expect(page.getByTestId('confirm-modal-confirm-button')).toBeVisible();
  await expect(page.locator('#custom_modal_overlay')).toContainText(/Save the changed permissions\?|Tallennetaanko muutetut oikeudet\?/);
  await checkpoint('recovery before Save', [['B', 'F', 'Y'], ['B', 'G', null], ['A', 'H', 'X'], ['B', 'F', 'Z']]);
  await save(tableless, 'POST', [[A, T], [B, G]], 'question');
  await expect(page.getByTestId('confirm-modal-confirm-button')).toBeHidden();
  // Intercepted Save clears the recovered draft locally, leaving server globals unchanged.
  await checkpoint('recovery after intercepted Save', [['B', 'F', 'Y'], ['B', 'G', null], ['A', 'H', 'X'], ['B', 'F', 'Z']]);
  expect(await page.evaluate(() => localStorage.getItem('permissions_tableless'))).toBeNull();
  // Context switching and reload read real server globals, without the intercepted A/T.
  await select(fixture.names.slice(0, 2)); await cell(scoped, F, true);
  const switchResponse = page.waitForResponse(response => response.url().includes('/api/dataset_permissions') && response.request().method() === 'PATCH');
  await page.evaluate(({ name, selector }) => {
    const node = document.querySelector(`${selector} [data-lang-key="${name}"]`)?.closest('[data-table-uid]');
    document.dispatchEvent(new CustomEvent('checkboxSelectionChanged', { detail: { selectedCategories: [node!.id] } }));
  }, { name: fixture.names[1], selector: PERMISSIONS_TREE_SELECTOR });
  await page.getByTestId('confirm-modal-confirm-button').click(); expect((await switchResponse).ok()).toBe(true);
  await expect(page.locator('.mp-table-section-description').first()).toHaveText(`Selected datasets: ${fixture.names[1]}`);
  await checkpoint('Save during context switch', [['A', 'F', 'X'], ['A', 'F', 'Y'], ['B', 'F', 'Y'], ['B', 'G', null], ['A', 'H', 'X'], ['B', 'F', 'Z']]);
  await cell(scoped, F, false); await save(scoped, 'PATCH');
  await checkpoint('Save after context switch only changes Y', [['A', 'F', 'X'], ['B', 'F', 'Y'], ['B', 'G', null], ['A', 'H', 'X'], ['B', 'F', 'Z']]);
  await page.reload(); await openPermissionsTree(page);
  await checkpoint('reload', [['A', 'F', 'X'], ['B', 'F', 'Y'], ['B', 'G', null], ['A', 'H', 'X'], ['B', 'F', 'Z']]);
});
