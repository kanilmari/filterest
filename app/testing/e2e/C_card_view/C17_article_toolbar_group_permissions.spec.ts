// C17_article_toolbar_group_permissions.spec.ts
// Compares shared article toolbars for administrators, ordinary readers and anonymous visitors.
// Connects disposable datasets and real route grants to card-project browser rendering.
// Keeps article copy and its main image visible in both explicit themes and translated copy.

import { test, expect, type Page } from '@playwright/test';
import { login, loadCredentials, loadUserCredentials, readSessionInfo } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, dropTempDataset, fetchCsrfTokenForRequest, openTempDatasetRowArticle } from '../helpers/temp-dataset';
import { loadDatasetCardVisibility, saveCardVisibilityWithFreshRevisions } from '../helpers/appearance-revisions';
import { postJsonWithCsrf } from '../helpers/image-first-article';
import { confirmTestArtifact, registerTestArtifact } from '../helpers/test-artifact-run-registry';
import { readDatasetTableUIDFromPage } from '../helpers/test-artifact-dataset-identity-reader';
import { waitForActiveFilterbarLayout } from '../helpers/filterbar';

const ARTICLE = '.active_row_article';
const BODY_TEXT = 'Article text stays visible';
const PHOTO = '/frontend/icons/general/table-tools-icon.svg';
const READER_VIEW_ROUTES = [
  { name: 'ui.view.card', endpoint: '/ui/view/card' },
  { name: 'ui.view.article_view', endpoint: '/ui/view/article_view' },
] as const;

type AccessRow = { id: number } & Record<string, unknown>;
type ReaderAccess = {
  groupName: string;
  groupId: number | null;
  groupCreated: boolean;
  viewGrants: Array<{ functionId: number; grantId: number | null }>;
  userId: number | null;
  membershipId: number | null;
};

type GuestGrant = { functionId: number; before: AccessRow[]; ownedId: number | null; marker: string };
type ThemePreference = { theme_mode: string; configured: boolean; revision: number };

/** Pins the account through its supported API, restoring both the value and absence. */
async function withPinnedAccountTheme(page: Page, theme: 'light' | 'dark', prove: () => Promise<void>): Promise<void> {
  const identity = await readSessionInfo(page);
  const response = await page.request.get('/api/user-visual-preference');
  expect(response.ok(), await response.text()).toBe(true);
  const original = await response.json() as ThemePreference;
  const token = await fetchCsrfTokenForRequest(page.request);
  const pinned = await page.request.patch('/api/user-visual-preference', {
    headers: { 'X-CSRF-Token': token }, data: { theme_mode: theme },
  });
  expect(pinned.ok(), await pinned.text()).toBe(true);
  const saved = await pinned.json() as ThemePreference;
  try {
    await prove();
  } finally {
    expect((await readSessionInfo(page)).user_id, 'Refusing to restore a different account theme.').toBe(identity.user_id);
    const current = await page.request.get('/api/user-visual-preference');
    expect(current.ok(), await current.text()).toBe(true);
    expect(await current.json(), 'Refusing to overwrite a concurrently changed account theme.').toEqual(saved);
    const headers = { 'X-CSRF-Token': await fetchCsrfTokenForRequest(page.request) };
    const restored = original.configured
      ? await page.request.patch('/api/user-visual-preference', { headers, data: { theme_mode: original.theme_mode } })
      : await page.request.delete('/api/user-visual-preference', { headers });
    expect(restored.ok(), await restored.text()).toBe(true);
    expect(await restored.json()).toMatchObject({ theme_mode: original.theme_mode, configured: original.configured });
  }
}

/** Captures every scope for this function, then owns only a missing global grant. */
async function addGuestUIGrant(admin: Page, groupId: number, name: string, marker: string, grants: GuestGrant[]): Promise<void> {
  const fn = await readAccessRow(admin, 'system_functions', { name });
  expect(fn).toMatchObject({ disabled: false, specific_table_related: false });
  const before = await readAccessRows(admin, 'system_group_table_func_rights', { user_group_id: groupId, function_id: fn!.id });
  const grant: GuestGrant = { functionId: fn!.id, before, ownedId: null, marker };
  grants.push(grant);
  if (before.some(row => row.target_schema_name === 'public' && row.target_table_uid === null)) return;
  // creation_spec is server-managed and not insertable (add_row_db.go:145), so ownership is the one new row id.
  await addAccessRow(admin, 'system_group_table_func_rights', {
    user_group_id: groupId, function_id: fn!.id, target_schema_name: 'public', target_table_uid: null,
  });
  const added = (await readAccessRows(admin, 'system_group_table_func_rights', { user_group_id: groupId, function_id: fn!.id }))
    .filter(row => !before.some(original => original.id === row.id));
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({ target_schema_name: 'public', target_table_uid: null });
  grant.ownedId = added[0].id;
}

/** Restores captured ids/scopes exactly, including when setup stopped before readback. */
async function restoreGuestUIGrants(admin: Page, groupId: number, grants: GuestGrant[]): Promise<void> {
  for (const grant of [...grants].reverse()) {
    const fields = { user_group_id: groupId, function_id: grant.functionId };
    const current = await readAccessRows(admin, 'system_group_table_func_rights', fields);
    const added = current.filter(row => !grant.before.some(original => original.id === row.id));
    expect(added.length).toBeLessThanOrEqual(1);
    if (added.length) {
      expect(added[0]).toMatchObject({ ...fields, target_schema_name: 'public', target_table_uid: null });
      if (grant.ownedId !== null) expect(added[0].id, 'Refusing to delete a replacement guest grant.').toBe(grant.ownedId);
      const deletion = await postJsonWithCsrf(admin, '/api/delete-rows?dataset=system_group_table_func_rights', { ids: [added[0].id] });
      expect(deletion.ok, deletion.body).toBe(true);
    } else expect(grant.ownedId).toBeNull();
    expect(await readAccessRows(admin, 'system_group_table_func_rights', fields)).toEqual(grant.before);
    grants.splice(grants.indexOf(grant), 1);
  }
  grants.length = 0;
}

async function readGuestUIEndpoints(visitor: Page): Promise<string[]> {
  const response = await visitor.request.get('/api/auth-modes');
  expect(response.ok(), await response.text()).toBe(true);
  const modes = await response.json() as { needs_button: string; guest_ui_endpoints: string[]; login_required_for_browse: boolean };
  expect(modes.needs_button).toBe('login');
  expect(modes.login_required_for_browse).toBe(false);
  expect(Array.isArray(modes.guest_ui_endpoints)).toBe(true);
  return [...modes.guest_ui_endpoints].sort();
}

async function proveGuestToolbar(visitor: Page, dataset: string, theme: 'light' | 'dark', images = false): Promise<void> {
  await visitor.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
  if (visitor.url() !== 'about:blank') await visitor.evaluate(theme => localStorage.setItem('theme', theme), theme);
  await openTempDatasetRowArticle(visitor, dataset, 1);
  await expect(visitor.locator('body')).toHaveClass(new RegExp(`${theme}-mode`));
  const article = visitor.locator(`#${dataset}_article_view_container`).locator(ARTICLE);
  await expect(article.locator('.row_article_details_section')).toBeVisible();
  await expect(article.locator('.big_card_description_container')).toContainText(BODY_TEXT);
  await expect(article.locator('.big_card_image img').first()).toBeVisible();
  await expect(article.locator('.row_article_image_gallery_section')).toHaveCount(images ? 1 : 0);
  for (const selector of ['.row_article_attachment_list_section', '.row_article_related_items_section',
    '.row_article_task_progress_section', '[data-testid="big-card-edit-button"]',
    '.article-language-editor-open', '[data-testid="big-card-delete"]']) {
    await expect(article.locator(selector)).toHaveCount(0);
  }
  expect(await visitor.evaluate(() => localStorage.getItem('button_state'))).toBe('login');
  // Verify the actual cache written by bootstrap; the spec never supplies permissions.
  expect(await visitor.evaluate(() => JSON.parse(sessionStorage.getItem('user_permissions') || 'null')))
    .toEqual(await readGuestUIEndpoints(visitor));
}

/** Equal bounds use the same exact lookup as the language-key cleanup, including FK ids. */
async function readAccessRows(page: Page, dataset: string, fields: Record<string, string | number>): Promise<AccessRow[]> {
  const query = new URLSearchParams({ dataset, view_key: 'table' });
  for (const [column, value] of Object.entries(fields)) {
    query.set(`${column}_from`, String(value));
    query.set(`${column}_to`, String(value));
  }
  const response = await page.request.get(`/api/get-results?${query}`);
  expect(response.ok(), await response.text()).toBe(true);
  const { data } = await response.json() as { data: AccessRow[] };
  expect(Array.isArray(data)).toBe(true);
  for (const row of data) {
    expect(row).toMatchObject(fields);
    expect(Number.isSafeInteger(row.id) && row.id > 0).toBe(true);
  }
  return data;
}

async function readAccessRow(page: Page, dataset: string, fields: Record<string, string | number>): Promise<AccessRow | null> {
  const rows = await readAccessRows(page, dataset, fields);
  expect(rows.length).toBeLessThanOrEqual(1);
  return rows[0] ?? null;
}

/** Same multipart/CSRF contract as temp-dataset.ts:addTempDatasetRow. */
async function addAccessRow(page: Page, dataset: string, fields: Record<string, unknown>): Promise<void> {
  const token = await fetchCsrfTokenForRequest(page.request);
  const response = await page.request.post(`/api/add-row-multipart?dataset=${dataset}`, {
    headers: { 'X-CSRF-Token': token }, multipart: { jsonPayload: JSON.stringify(fields) },
  });
  // add_row_handler.go:177 returns a message, so read back the exact generated id.
  expect(response.status(), await response.text()).toBe(201);
}

async function readReaderEndpoints(reader: Page): Promise<string[]> {
  const response = await reader.request.get('/api/user-permissions');
  expect(response.ok(), await response.text()).toBe(true);
  const { endpoints } = await response.json() as { endpoints: string[] };
  expect(Array.isArray(endpoints)).toBe(true);
  return [...endpoints].sort();
}

/** Adds explicit views to an isolated reader group; toolbar defaults stay under test. */
async function giveReaderArticleAccess(admin: Page, reader: Page, access: ReaderAccess, includeArticle = true): Promise<void> {
  const routes = READER_VIEW_ROUTES.filter(route => includeArticle || route.endpoint !== '/ui/view/article_view');
  const identity = await readSessionInfo(reader);
  expect(Number.isSafeInteger(identity.user_id) && identity.user_id! > 1).toBe(true);
  access.userId = identity.user_id!;
  // Round 6: router/ui_permission_route_saver.go:23 defines no view defaults;
  // ui_permission_default_grant_saver.go:31,38 grants no views to fresh users;
  // public_bootstrap/source/article_view.seed.sql:55 only copies existing card grants.
  // Model the selected views an administrator would grant for reading.
  for (const route of routes) {
    const view = await readAccessRow(admin, 'system_functions', { name: route.name });
    expect(view).toMatchObject({ url_route_endpoint: route.endpoint, disabled: false, specific_table_related: false });
    access.viewGrants.push({ functionId: view!.id, grantId: null });
  }
  expect(await readAccessRow(admin, 'system_user_groups', { name: access.groupName })).toBeNull();
  await addAccessRow(admin, 'system_user_groups', { name: access.groupName });
  access.groupCreated = true;
  const group = await readAccessRow(admin, 'system_user_groups', { name: access.groupName });
  expect(group).not.toBeNull();
  access.groupId = group!.id;
  // auth/user_permissions.go:29 joins group rights through memberships. NULL is
  // the site-wide UI scope (permissions/route_table_checker.go:257), on our group only.
  for (const viewGrant of access.viewGrants) {
    await addAccessRow(admin, 'system_group_table_func_rights', {
      user_group_id: access.groupId, function_id: viewGrant.functionId,
      target_schema_name: 'public', target_table_uid: null,
    });
    const grant = await readAccessRow(admin, 'system_group_table_func_rights', {
      user_group_id: access.groupId, function_id: viewGrant.functionId,
    });
    expect(grant).toMatchObject({ target_schema_name: 'public', target_table_uid: null });
    viewGrant.grantId = grant!.id;
  }
  expect(await readAccessRows(admin, 'system_group_table_func_rights', { user_group_id: access.groupId })).toHaveLength(routes.length);
  await addAccessRow(admin, 'system_user_group_memberships', { user_id: access.userId, group_id: access.groupId });
  const membership = await readAccessRow(admin, 'system_user_group_memberships', { group_id: access.groupId });
  expect(membership).toMatchObject({ user_id: access.userId });
  access.membershipId = membership!.id;
}

/** Refuses replacements; removes the owned group and verifies both cascade targets. */
async function removeReaderArticleAccess(admin: Page, access: ReaderAccess): Promise<void> {
  // A successful create has no id in its reply; recover only our previously absent exact name if readback failed.
  if (access.groupId === null && access.groupCreated) {
    const group = await readAccessRow(admin, 'system_user_groups', { name: access.groupName });
    if (group) access.groupId = group.id;
  }
  if (access.groupId === null) return;
  expect(await readAccessRow(admin, 'system_user_groups', { name: access.groupName })).toMatchObject({ id: access.groupId });
  const grants = await readAccessRows(admin, 'system_group_table_func_rights', { user_group_id: access.groupId });
  for (const grant of grants) {
    expect(access.viewGrants.some(viewGrant => viewGrant.functionId === grant.function_id), 'Refusing to delete an unexpected group grant.').toBe(true);
  }
  for (const viewGrant of access.viewGrants) {
    const matchingGrants = grants.filter(grant => grant.function_id === viewGrant.functionId);
    expect(matchingGrants.length).toBeLessThanOrEqual(1);
    const grant = matchingGrants[0];
    if (grant) {
      expect(grant).toMatchObject({ target_schema_name: 'public', target_table_uid: null });
      if (viewGrant.grantId !== null) expect(grant.id, 'Refusing to delete a replacement reader view grant.').toBe(viewGrant.grantId);
    } else expect(viewGrant.grantId).toBeNull();
  }
  const membership = await readAccessRow(admin, 'system_user_group_memberships', { group_id: access.groupId });
  if (membership) {
    expect(membership).toMatchObject({ user_id: access.userId });
    if (access.membershipId !== null) expect(membership.id, 'Refusing to delete a replacement reader membership.').toBe(access.membershipId);
  } else expect(access.membershipId).toBeNull();
  // 20260926000001_restore_system_foreign_keys.sql:37,46 declares ON DELETE
  // CASCADE for this group's rights and memberships, also covering partial setup.
  const deletion = await postJsonWithCsrf(admin, '/api/delete-rows?dataset=system_user_groups', { ids: [access.groupId] });
  expect(deletion.ok, deletion.body).toBe(true);
  expect(await readAccessRow(admin, 'system_user_groups', { name: access.groupName })).toBeNull();
  expect(await readAccessRow(admin, 'system_group_table_func_rights', { user_group_id: access.groupId })).toBeNull();
  expect(await readAccessRow(admin, 'system_user_group_memberships', { group_id: access.groupId })).toBeNull();
}

/** Exact-name lookup: equal range bounds avoid wildcard matches and pagination. */
async function readDatasetNameLangKeyId(page: Page, dataset: string): Promise<number | null> {
  const name = encodeURIComponent(dataset);
  const response = await page.request.get(
    `/api/get-results?dataset=system_lang_keys&view_key=table&lang_key_from=${name}&lang_key_to=${name}`,
  );
  expect(response.ok(), await response.text()).toBe(true);
  const { data } = await response.json() as { data: Array<{ id: number; lang_key: string }> };
  expect(Array.isArray(data)).toBe(true);
  expect(data.length).toBeLessThanOrEqual(1);
  if (!data.length) return null;
  expect(data[0].lang_key).toBe(dataset);
  expect(Number.isSafeInteger(data[0].id) && data[0].id > 0).toBe(true);
  return data[0].id;
}

/** Proves the pinned account theme overrides the opposite operating-system preference. */
async function proveToolbar(page: Page, dataset: string, childDataset: string, administrator: boolean, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
  await openTempDatasetRowArticle(page, dataset, 1);
  await expect(page.locator('body')).toHaveClass(new RegExp(`${theme}-mode`));
  const article = page.locator(`#${dataset}_article_view_container`).locator(ARTICLE);
  await expect(article.locator('.big_card_description_container')).toContainText(BODY_TEXT);
  await expect(article.locator('.big_card_image img').first()).toBeVisible();
  await expect.poll(() => article.locator('.big_card_image img').first().evaluate(
    (image: HTMLImageElement) => image.complete && image.naturalWidth > 0,
  ), { message: 'The large article image must finish loading with a nonzero intrinsic width.' }).toBe(true);
  await expect(article.locator('.row_article_details_section')).toBeVisible();
  for (const selector of ['.row_article_image_gallery_section', '.row_article_related_items_section',
    '.row_article_attachment_list_section',
    '[data-testid="big-card-edit-button"]', '.article-language-editor-open', '[data-testid="big-card-delete"]']) {
    await expect(article.locator(selector)).toHaveCount(administrator ? 1 : 0);
  }
  // row_article_child_tabs.js stores the raw dataset name in the label's lang key.
  // System relations and comments can share this bar; prove only our child tab.
  const childTab = article.locator('.related_tab_button').filter({
    has: page.locator(`.related_tab_dataset_label[data-lang-key="${childDataset}"]`),
  });
  await expect(childTab).toHaveCount(administrator ? 1 : 0);
  if (!administrator) {
    await expect(article.locator('.row_article_attachment_list_section, .row_article_task_progress_section')).toHaveCount(0);
  }
}

/** Checks denial in real themed cards, without supplying a browser permission cache. */
async function proveDeniedArticleOpeners(reader: Page, dataset: string, theme: 'light' | 'dark', language: 'fi' | 'en'): Promise<void> {
  await reader.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
  await reader.evaluate(language => localStorage.setItem('chosen_language', language), language);
  await reader.goto(`/${dataset}?view=card`);
  // Startup translates after results mount. Mark the completed view, not an
  // intermediate card that the initial language pass is still allowed to finish.
  await waitForActiveFilterbarLayout(reader);
  await expect(reader.locator('body')).toHaveClass(new RegExp(`${theme}-mode`));
  const card = reader.locator(`#${dataset}_container .card[data-id="1"]`).first();
  const title = card.locator('[data-testid="card-item-header"]');
  const image = card.locator('[data-image-first-src]').first();
  await expect(title).toBeVisible();
  await expect(image).toBeVisible();
  const url = reader.url();
  await title.evaluate(element => { element.dataset.retainedDenialProof = 'yes'; });
  const explanations = reader.locator('[data-lang-key="article_view_permission_missing"]');
  const viewState = () => reader.evaluate(() => ({
    scroll: [window.scrollX, window.scrollY, ...Array.from(document.querySelectorAll('.scrollable_content'))
      .flatMap(element => [element.scrollLeft, element.scrollTop])],
    selection: Array.from(document.querySelectorAll('.card')).map(element => ({
      id: element.getAttribute('data-id'), selected: element.classList.contains('selected'),
      checked: element.querySelector<HTMLInputElement>('.card_checkbox')?.checked ?? null,
    })),
  }));
  const proveActivation = async (activate: () => Promise<unknown>) => {
    // Dismiss earlier notices through their normal control so expiry cannot
    // mask a new explanation, and earlier text cannot satisfy this activation.
    for (const close of await reader.locator('[data-testid="toast"]').filter({ has: explanations })
      .locator('.toast-notification-close').all()) await close.click();
    await expect(explanations).toHaveCount(0);
    const before = await explanations.count(), state = await viewState();
    await activate();
    await expect(explanations).toHaveCount(before + 1);
    await expect(explanations.last()).toContainText(language === 'fi' ? 'sinulta puuttuu' : 'do not have permission');
    expect(reader.url()).toBe(url);
    await expect(reader.locator(ARTICLE)).toHaveCount(0);
    await expect(reader.locator('[data-testid="image-first-view"]')).toHaveCount(0);
    await expect(title).toHaveAttribute('data-retained-denial-proof', 'yes');
    expect(await viewState()).toEqual(state);
  };
  for (const part of [title, image]) {
    expect(await part.getAttribute('role')).toBeNull();
    expect(await part.getAttribute('tabindex')).toBeNull();
    expect(await part.evaluate(element => getComputedStyle(element).cursor)).toBe('default');
    await part.hover();
    expect(await part.evaluate(element => getComputedStyle(element).textDecorationLine)).toBe('none');
    await proveActivation(() => part.click());
    for (const key of ['Enter', ' ']) await proveActivation(() => part.dispatchEvent('keydown', { key }));
  }
  expect(await reader.evaluate(() => JSON.parse(sessionStorage.getItem('user_permissions') || '[]')))
    .not.toContain('/ui/view/article_view');
}

test('C17: administrator, reader and anonymous visitor receive their own article grants', async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  const parent = buildTempDatasetName('e2e_article_toolbar');
  const child = buildTempDatasetName('e2e_article_toolbar_child');
  const created: string[] = [];
  const datasetNameKeyIds = new Map<string, number | null>();
  const readerAccess: ReaderAccess = {
    groupName: buildTempDatasetName('e2e_c17_card_reader'), groupId: null, groupCreated: false,
    viewGrants: [], userId: null, membershipId: null,
  };
  let reader: Page | null = null;
  let originalReaderEndpoints: string[] | null = null;
  let originalGuestEndpoints: string[] | null = null;
  let guestGroupId: number | null = null;
  let originalBrowsePolicy: AccessRow | null = null;
  let browsePolicyChanged = false;
  const guestGrants: GuestGrant[] = [];
  const explicitGuestGrants: GuestGrant[] = [];
  const readerContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL, ignoreHTTPSErrors: true,
    viewport: page.viewportSize(), storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { 'X-Bypass-Ratelimit': 'test-mode' },
  });
  const visitorContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL, ignoreHTTPSErrors: true,
    viewport: page.viewportSize(), storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { 'X-Bypass-Ratelimit': 'test-mode' },
  });
  await visitorContext.addInitScript(() => {
    if (!localStorage.getItem('theme')) localStorage.setItem('theme', 'light');
    if (!localStorage.getItem('chosen_language')) localStorage.setItem('chosen_language', 'fi');
  });
  const visitor = await visitorContext.newPage();
  try {
    await login(page, loadCredentials());
    // Creation seeds each dataset-name key. Never claim a pre-existing key for cleanup.
    for (const dataset of [parent, child]) expect(await readDatasetNameLangKeyId(page, dataset)).toBeNull();
    await createTempDataset(page, {
      // create_table_registration.go:180,207 seeds only read routes on this new
      // dataset; table_metadata_cleanup.go:62 removes those rights with its UID.
      datasetName: parent, grantUsersRead: true, grantGuestsRead: true,
      columns: { id: 'SERIAL', title: 'TEXT', description: 'TEXT', detail_note: 'TEXT', photo: 'TEXT' },
      seedRows: [{ title: 'Toolbar proof', description: JSON.stringify({ fi: BODY_TEXT, en: BODY_TEXT, ch: BODY_TEXT, yue: BODY_TEXT }),
        detail_note: 'Details stay visible', photo: PHOTO }],
    });
    created.push(parent);
    datasetNameKeyIds.set(parent, await readDatasetNameLangKeyId(page, parent));
    const visibility = await loadDatasetCardVisibility(page.request, parent);
    const description = visibility.columns.find(column => column.column_name === 'description');
    expect(description).toBeTruthy();
    const multilingual = await postJsonWithCsrf(page, '/api/admin/column-multilingual', {
      dataset: parent, column_uid: description!.column_uid, is_multilingual: true,
    });
    expect(multilingual.ok, multilingual.body).toBe(true);
    await saveCardVisibilityWithFreshRevisions(page.request, parent, current => ({
      card_details_layout: current.card_details_layout, card_style_variant: current.card_style_variant,
      columns: current.columns.map(column => ({ ...column,
        card_element: ({ title: 'header', description: 'description', detail_note: 'details', photo: 'image' } as Record<string, string>)[column.column_name] || column.card_element,
        show_value_on_card: true, hide_on_big_card: false,
      })),
    }));
    await createTempDataset(page, {
      datasetName: child, grantUsersRead: true,
      columns: { id: 'SERIAL', name: 'TEXT', parent_id: 'INTEGER' },
      foreignKeys: [{ referencing_column: 'parent_id', referenced_dataset: parent, referenced_column: 'id' }],
      seedRows: [{ name: 'Unchanged related tab', parent_id: 1 }],
    });
    created.push(child);
    datasetNameKeyIds.set(child, await readDatasetNameLangKeyId(page, child));
    // Attachment linking can produce a positive administrator section without
    // a physical upload. Register and confirm its exact generated child identity.
    const assets = `${parent}_assets`;
    expect(await readDatasetNameLangKeyId(page, assets)).toBeNull();
    registerTestArtifact('dataset', assets);
    const enabled = await postJsonWithCsrf(page, '/api/asset-linking/attachments/enable', { parent_table: parent, max_file_size_mb: 1 });
    expect(enabled.status, enabled.body).toBe(201);
    expect(JSON.parse(enabled.body)).toMatchObject({ child_table: assets, parent_table: parent });
    created.push(assets);
    const assetsId = await readDatasetTableUIDFromPage(page, assets);
    expect(assetsId).not.toBeNull();
    confirmTestArtifact('dataset', assets, assetsId!);
    datasetNameKeyIds.set(assets, await readDatasetNameLangKeyId(page, assets));
    reader = await readerContext.newPage();
    await login(reader, loadUserCredentials());
    originalReaderEndpoints = await readReaderEndpoints(reader);
    // A temporary reader group holds cards only. The reserved development
    // reader must have no article right in another group; never revoke shared grants.
    expect(originalReaderEndpoints).not.toContain('/ui/view/article_view');
    await giveReaderArticleAccess(page, reader, readerAccess, false);
    for (const [theme, language] of [['light', 'fi'], ['dark', 'en']] as const) {
      await withPinnedAccountTheme(reader, theme, () => proveDeniedArticleOpeners(reader!, parent, theme, language));
    }
    const articleFunction = await readAccessRow(page, 'system_functions', { name: 'ui.view.article_view' });
    expect(articleFunction).toMatchObject({ disabled: false, specific_table_related: false });
    const addedArticleGrant = { functionId: articleFunction!.id, grantId: null as number | null };
    readerAccess.viewGrants.push(addedArticleGrant); // Cleanup owns partial setup as well.
    await addAccessRow(page, 'system_group_table_func_rights', {
      user_group_id: readerAccess.groupId, function_id: addedArticleGrant.functionId,
      target_schema_name: 'public', target_table_uid: null,
    });
    const grantedArticle = await readAccessRow(page, 'system_group_table_func_rights', {
      user_group_id: readerAccess.groupId!, function_id: addedArticleGrant.functionId,
    });
    expect(grantedArticle).toMatchObject({ target_schema_name: 'public', target_table_uid: null });
    addedArticleGrant.grantId = grantedArticle!.id;
    // A fresh server bootstrap sees the added right; classic title and IFAV image paths keep their behavior.
    await withPinnedAccountTheme(reader, 'light', async () => {
      await reader!.emulateMedia({ colorScheme: 'dark' });
      await reader!.goto(`/${parent}?view=card`);
      await reader!.locator(`#${parent}_container [data-testid="card-item-header"]`).first().click();
      await expect(reader!.locator(ARTICLE)).toBeVisible();
      await reader!.goto(`/${parent}?view=card`);
      await reader!.locator(`#${parent}_container [data-image-first-src]`).first().click();
      await expect(reader!.locator('[data-testid="image-first-view"]')).toBeVisible();
    });
    expect(await readReaderEndpoints(reader)).toEqual([...new Set([...originalReaderEndpoints, ...READER_VIEW_ROUTES.map(route => route.endpoint)])].sort());
    const guests = await readAccessRow(page, 'system_user_groups', { name: 'guests' });
    expect(guests).not.toBeNull();
    guestGroupId = guests!.id;
    originalBrowsePolicy = await readAccessRow(page, 'system_config', { key: 'login_to_browse' });
    if (originalBrowsePolicy?.boolean_value === true) {
      browsePolicyChanged = true; // Restoration also runs if the request/readback fails.
      const changed = await postJsonWithCsrf(page, '/api/update-row?dataset=system_config', {
        id: originalBrowsePolicy.id, column: 'boolean_value', value: false,
      });
      expect(changed.ok, changed.body).toBe(true);
      expect(await readAccessRow(page, 'system_config', { key: 'login_to_browse' })).toMatchObject({ id: originalBrowsePolicy.id, boolean_value: false });
    }
    originalGuestEndpoints = await readGuestUIEndpoints(visitor);
    expect(originalGuestEndpoints.filter(route => route.startsWith('/ui/article/'))).toEqual(['/ui/article/section/details']);
    // Match the reader's explicitly granted views. These grant no article tools
    // or dataset reads and are restored by exact function/group/scope/id below.
    for (const route of READER_VIEW_ROUTES) {
      await addGuestUIGrant(page, guestGroupId, route.name, `${parent}_guest_views`, guestGrants);
    }
    for (const [theme, language] of [['light', 'fi'], ['dark', 'en']] as const) {
      for (const target of [page, reader]) await target.evaluate(lang => localStorage.setItem('chosen_language', lang), language);
      await withPinnedAccountTheme(page, theme, () => proveToolbar(page, parent, child, true, theme));
      await withPinnedAccountTheme(reader, theme, () => proveToolbar(reader!, parent, child, false, theme));
      if (visitor.url() !== 'about:blank') await visitor.evaluate(lang => localStorage.setItem('chosen_language', lang), language);
      await proveGuestToolbar(visitor, parent, theme);
    }
    const beforeExplicitGrant = await readGuestUIEndpoints(visitor);
    try {
      await addGuestUIGrant(page, guestGroupId, 'ui.article.section.images', `${parent}_guest_images`, explicitGuestGrants);
      expect(await readGuestUIEndpoints(visitor)).toEqual([...beforeExplicitGrant, '/ui/article/section/images'].sort());
      await proveGuestToolbar(visitor, parent, 'dark', true);
    } finally {
      await restoreGuestUIGrants(page, guestGroupId, explicitGuestGrants);
      expect(await readGuestUIEndpoints(visitor)).toEqual(beforeExplicitGrant);
    }
    await proveGuestToolbar(visitor, parent, 'dark');
  } finally {
    // Restoration runs even after a failed toolbar assertion; dataset/name-key
    // cleanup still runs if reader-access restoration itself reports an error.
    try {
      try {
        if (guestGroupId !== null) {
          try {
            await restoreGuestUIGrants(page, guestGroupId, explicitGuestGrants);
          } finally {
            await restoreGuestUIGrants(page, guestGroupId, guestGrants);
            if (originalGuestEndpoints !== null) expect(await readGuestUIEndpoints(visitor)).toEqual(originalGuestEndpoints);
          }
        }
      } finally {
        try {
          if (browsePolicyChanged && originalBrowsePolicy !== null) {
            const current = await readAccessRow(page, 'system_config', { key: 'login_to_browse' });
            expect(current).toMatchObject({ id: originalBrowsePolicy.id, boolean_value: false, json_value: originalBrowsePolicy.json_value });
            const restored = await postJsonWithCsrf(page, '/api/update-row?dataset=system_config', {
              id: originalBrowsePolicy.id, column: 'boolean_value', value: originalBrowsePolicy.boolean_value,
            });
            expect(restored.ok, restored.body).toBe(true);
            expect(await readAccessRow(page, 'system_config', { key: 'login_to_browse' }))
              .toMatchObject({ id: originalBrowsePolicy.id, boolean_value: originalBrowsePolicy.boolean_value, json_value: originalBrowsePolicy.json_value });
          }
        } finally {
          await visitorContext.close();
        }
      }
    } finally {
      try {
        await removeReaderArticleAccess(page, readerAccess);
        if (reader && originalReaderEndpoints !== null) {
          expect(await readReaderEndpoints(reader), 'Reader route grants must match their exact pre-test state.').toEqual(originalReaderEndpoints);
        }
      } finally {
        try {
          await readerContext.close();
        } finally {
          for (const dataset of [...created].reverse()) {
            await dropTempDataset(page, dataset);
            // Product defect: lang_key_source_population.go:496 can count a key's own
            // normalized translations as foreign_key sources. The bare dataset name
            // survives those sources in cleanup_lang_key_sources.go:218. Native C17
            // observed a surviving name; its actual retained source still needs inspection.
            // Remove only this test's exact name and recorded ID through supported CRUD.
            const leftoverId = await readDatasetNameLangKeyId(page, dataset);
            if (leftoverId !== null) {
              expect(leftoverId, `Refusing to delete a replacement language key for ${dataset}.`).toBe(datasetNameKeyIds.get(dataset));
              const deletion = await postJsonWithCsrf(page, '/api/delete-rows?dataset=system_lang_keys', { ids: [leftoverId] });
              expect(deletion.ok, deletion.body).toBe(true);
            }
            expect(await readDatasetNameLangKeyId(page, dataset)).toBeNull();
          }
        }
      }
    }
  }
});
