// E20_filterbar_order_and_memory.spec.ts
// Proves shared and personal ordering, visibility memory and first-visit defaults.
// Connects real role sessions, translated settings and cached dataset navigation.
// Restores site/account settings and registered temporary datasets even after failures; runs only with one worker.
import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { login, loadCredentials, loadUserCredentials } from '../helpers/auth';
import { waitForAppReady } from '../helpers/navigation';
import { openActiveFilterbarIfCollapsed, closeActiveFilterbarIfOpen, revealActiveFilterbarSection } from '../helpers/filterbar';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest, fetchCsrfTokenForRequest } from '../helpers/temp-dataset';
import { listRegisteredTestArtifacts } from '../helpers/test-artifact-run-registry';

type Layout = { section_order: string[]; section_collapsed: Record<string, boolean>; allow_own_order: boolean };
type Preference = { user_id: number; order_mode: 'shared' | 'own'; section_order?: string[]; visibility_memory: 'shared' | 'dataset' };
type Account = { request: APIRequestContext; preference: Preference; theme: { configured: boolean; theme_mode: string } };
type Cleanup = { accounts: Account[]; contexts: BrowserContext[]; datasets: string[]; layout?: Layout; browsing?: { id: number; boolean_value: boolean } };
let cleanup: Cleanup | undefined;

async function read<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}
async function write(request: APIRequestContext, path: string, data: unknown, method = 'PATCH') {
  const response = await request.fetch(path, { method, data,
    headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(request) } });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function navigate(page: Page, dataset: string) {
  await page.evaluate(async name => {
    const { handle_all_navigation } = await import('/frontend/core_components/navigation/nav_engine/navigation_handler.js');
    const result = await handle_all_navigation(name, [], { replacementParams: { view: 'table' } });
    if (result?.abort) throw new Error(`Navigation refused: ${result.reason}`);
  }, dataset);
  await expect(page.locator(`#${dataset}_filterBar_panel`)).toBeAttached();
}
async function rememberAccount(page: Page, playwright: { request: typeof import('@playwright/test').request }) {
  const request = await playwright.request.newContext({ baseURL: new URL(page.url()).origin,
    storageState: await page.context().storageState(), ignoreHTTPSErrors: true });
  const account = { request, preference: await read<Preference>(request, '/api/user-filterbar-preference'),
    theme: await read<Account['theme']>(request, '/api/user-visual-preference') };
  cleanup!.accounts.push(account);
  return account;
}
async function firstSection(page: Page, dataset: string) {
  return page.locator(`#${dataset}_filterBar_panelBody > [data-filterbar-section-key]`).first().getAttribute('data-filterbar-section-key');
}
async function chooseVisibility(page: Page, mode: 'shared' | 'dataset') {
  const section = await revealActiveFilterbarSection(page, 'style');
  await section.getByTestId('filterbar_visibility_title').selectOption(mode);
  await expect(section.getByTestId('filterbar_visibility_title')).toBeEnabled();
}

test.describe.configure({ mode: 'serial' });
test.afterEach(async () => {
  const state = cleanup; cleanup = undefined;
  if (!state) return;
  const failures: unknown[] = [];
  const attempt = async (action: () => Promise<unknown>) => { try { await action(); } catch (error) { failures.push(error); } };
  const administrator = state.accounts[0]?.request;
  // Restore own orders while the temporary site policy still permits them.
  for (const account of state.accounts) {
    await attempt(async () => {
      await write(account.request, '/api/user-visual-preference', account.theme.configured ? { theme_mode: account.theme.theme_mode } : undefined,
        account.theme.configured ? 'PATCH' : 'DELETE');
      if (account.preference.section_order?.length) {
        await write(account.request, '/api/user-filterbar-preference', { order_mode: 'own', section_order: account.preference.section_order });
        await write(account.request, '/api/user-filterbar-preference', { order_mode: account.preference.order_mode,
          visibility_memory: account.preference.visibility_memory });
      } else {
        await write(account.request, '/api/user-filterbar-preference', undefined, 'DELETE');
        if (account.preference.visibility_memory !== 'shared') await write(account.request, '/api/user-filterbar-preference', { visibility_memory: account.preference.visibility_memory });
      }
    });
  }
  if (administrator && state.layout) await attempt(() => write(administrator, '/api/filterbar-section-layout/save', {
    ...state.layout, section_collapsed: Object.fromEntries(state.layout!.section_order.map(key => [key, state.layout!.section_collapsed?.[key] ?? null])),
  }, 'POST'));
  if (administrator && state.browsing) await attempt(() => write(administrator, '/api/update-row?dataset=system_config', {
    id: state.browsing!.id, column: 'boolean_value', value: state.browsing!.boolean_value,
  }, 'POST'));
  for (const dataset of state.datasets.reverse()) {
    const owned = listRegisteredTestArtifacts().some(item => item.kind === 'dataset' && item.name === dataset);
    if (administrator && owned) await attempt(() => cleanupDatasetViaRequest(administrator, dataset));
  }
  for (const context of state.contexts) await attempt(() => context.close());
  for (const account of state.accounts) await attempt(() => account.request.dispose());
  if (failures.length) throw new AggregateError(failures, 'Filter bar proof cleanup failed');
});

for (const theme of ['light', 'dark'] as const) for (const language of ['fi', 'en'] as const) {
  test(`${theme}/${language}: shared role order, live edits, personal order and visibility memory`, async ({ page, browser, playwright }, testInfo) => {
    test.setTimeout(180000);
    test.skip(testInfo.project.metadata?.cardView !== 'normal' || testInfo.project.metadata?.screenWidth === 'tablet',
      'This proof covers normal desktop and phone layouts.');
    // It rewrites the site-wide section order, login_to_browse and the shared administrator's theme. Parallel specs
    // would read those mid-test (the 19.10. nightly's E3/E18/F1 failures), so it runs only in a one-worker pass.
    test.skip(testInfo.config.workers > 1, 'Writes site-wide settings: run it in a one-worker pass.');
    cleanup = { accounts: [], contexts: [], datasets: [] };
    await login(page, loadCredentials());
    const admin = await rememberAccount(page, playwright);
    cleanup.layout = await read<Layout>(admin.request, '/api/filterbar-section-layout');
    const browsing = await read<{ data: Array<{ id: number; key: string; boolean_value: boolean }> }>(admin.request,
      '/api/get-results?dataset=system_config&search=login_to_browse&limit=100');
    cleanup.browsing = browsing.data.find(row => row.key === 'login_to_browse');
    expect(cleanup.browsing).toBeTruthy();
    if (cleanup.browsing!.boolean_value) await write(admin.request, '/api/update-row?dataset=system_config', {
      id: cleanup.browsing!.id, column: 'boolean_value', value: false,
    }, 'POST');
    await write(admin.request, '/api/filterbar-section-layout/save', { allow_own_order: true }, 'POST');
    await write(admin.request, '/api/user-filterbar-preference', { order_mode: 'shared', visibility_memory: 'shared' });
    await write(admin.request, '/api/user-visual-preference', { theme_mode: theme });
    const dataset = buildTempDatasetName('e2e_wo77_a');
    const second = buildTempDatasetName('e2e_wo77_b');
    for (const name of [dataset, second]) {
      cleanup.datasets.push(name);
      await createTempDataset(page, { datasetName: name, columns: { id: 'SERIAL', title: 'TEXT' },
        seedRows: [{ title: 'Suodatinpalkki / Filter bar' }], grantUsersRead: true, grantGuestsRead: true });
    }
    // Supported registry API: make the newly created dataset explicitly closed by default.
    const registry = await read<{ data: Array<{ id: number; table_name: string }> }>(admin.request,
      `/api/get-results?dataset=system_db_tables&search=${encodeURIComponent(dataset)}&limit=100`);
    const row = registry.data.find(item => item.table_name === dataset);
    expect(row, 'Owned dataset registry row').toBeTruthy();
    await write(admin.request, '/api/update-row?dataset=system_db_tables', { id: row!.id, column: 'filterbar_visible_by_default', value: false }, 'POST');
    await page.evaluate(({ language }) => localStorage.setItem('chosen_language', language), { language });
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    await page.goto(`/${dataset}?view=table`); await waitForAppReady(page);
    await openActiveFilterbarIfCollapsed(page);
    await navigate(page, second); await navigate(page, dataset);
    await page.evaluate(async () => {
      const controller = await import('/frontend/core_components/filterbar/filterbar_preferences_controller.js');
      await controller.saveSharedFilterbarLayout({ section_order: ['style', 'filters', 'views', 'tools', 'field_sets', 'search_overview', 'search_controls', 'chat'] });
    });
    for (const name of [dataset, second]) await expect.poll(() => firstSection(page, name)).toBe('style');
    const controls = await revealActiveFilterbarSection(page, 'style');
    await expect(controls.locator('textarea')).toHaveCount(0);
    await expect(controls.getByTestId('filterbar_visibility_title')).toContainText(language === 'fi' ? 'Yhteinen kaikille aineistoille' : 'Shared for all datasets');
    await expect(page.locator('body')).toHaveClass(new RegExp(`${theme}-mode`));
    const box = await controls.getByTestId('filterbar-preferences').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await controls.getByTestId('filterbar-preferences').screenshot({ path: testInfo.outputPath(`filterbar-${theme}-${language}.png`) });

    // browser.newContext() in a test inherits the project's admin storageState; start these contexts signed out.
    const ordinaryContext = await browser.newContext({ baseURL: new URL(page.url()).origin, storageState: { cookies: [], origins: [] },
      ignoreHTTPSErrors: true, viewport: page.viewportSize(), colorScheme: theme === 'light' ? 'dark' : 'light' });
    cleanup.contexts.push(ordinaryContext);
    const ordinary = await ordinaryContext.newPage(); await login(ordinary, loadUserCredentials());
    const user = await rememberAccount(ordinary, playwright);
    await write(user.request, '/api/user-filterbar-preference', { order_mode: 'shared', visibility_memory: 'shared' });
    await write(user.request, '/api/user-visual-preference', { theme_mode: theme });
    await ordinary.evaluate(lang => localStorage.setItem('chosen_language', lang), language);
    await ordinary.evaluate(({ userID, dataset }) => {
      localStorage.removeItem(`filterbar_shared_visible:${userID}`);
      for (const suffix of ['', '_wide', '_narrow']) localStorage.removeItem(`${dataset}_filterbar_visible${suffix}`);
    }, { userID: user.preference.user_id, dataset });
    await ordinary.goto(`/${dataset}?view=table`); await waitForAppReady(ordinary);
    // A new browser session has no visibility memory; results carry the closed default.
    await expect(ordinary.locator(`#${dataset}_filterBar_panel`)).toHaveClass(/filterbar-panel--hidden/);
    await expect.poll(() => firstSection(ordinary, dataset)).toBe('style');
    const denied = await user.request.post('/api/filterbar-section-layout/save', { data: { section_order: ['filters'] },
      headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(user.request) } });
    expect(denied.status()).toBe(403);
    await openActiveFilterbarIfCollapsed(ordinary);
    const personal = await revealActiveFilterbarSection(ordinary, 'style');
    await personal.getByTestId('filterbar_order_title').selectOption('own');
    await expect(personal.getByTestId('filterbar_order_title')).toBeEnabled();
    await personal.getByTestId('filterbar-order-list').locator('li').first().locator('button').nth(1).click();
    await expect.poll(() => firstSection(ordinary, dataset)).toBe('filters');
    await navigate(ordinary, second);
    await expect.poll(() => firstSection(ordinary, second)).toBe('filters');
    expect((await read<Layout>(admin.request, '/api/filterbar-section-layout')).section_order[0]).toBe('style');

    await chooseVisibility(ordinary, 'dataset');
    await closeActiveFilterbarIfOpen(ordinary); // second remembers closed
    await navigate(ordinary, dataset); await openActiveFilterbarIfCollapsed(ordinary); // first remembers open
    await navigate(ordinary, second);
    await expect(ordinary.locator(`#${second}_filterBar_panel`)).toHaveClass(/filterbar-panel--hidden/);
    await navigate(ordinary, dataset);
    await expect(ordinary.locator(`#${dataset}_filterBar_panel`)).not.toHaveClass(/filterbar-panel--hidden/);
    await ordinary.emulateMedia({ reducedMotion: 'reduce' });
    await navigate(ordinary, second);
    await expect(ordinary.locator(`#${second}_filterBar_panel`)).toHaveClass(/filterbar-panel--hidden/);
    expect(await ordinary.locator(`#${second}_filterBar_panel`).evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
    await openActiveFilterbarIfCollapsed(ordinary); await chooseVisibility(ordinary, 'shared');
    await closeActiveFilterbarIfOpen(ordinary);
    await navigate(ordinary, dataset); // shared closed outranks this dataset's earlier open memory
    await expect(ordinary.locator(`#${dataset}_filterBar_panel`)).toHaveClass(/filterbar-panel--hidden/);

    const guestContext = await browser.newContext({ baseURL: new URL(page.url()).origin, ignoreHTTPSErrors: true, storageState: { cookies: [], origins: [] },
      viewport: page.viewportSize(), colorScheme: theme === 'light' ? 'dark' : 'light' });
    cleanup.contexts.push(guestContext);
    const guest = await guestContext.newPage();
    await guest.addInitScript(({ language, theme }) => { localStorage.setItem('chosen_language', language); localStorage.setItem('theme', theme); }, { language, theme });
    await guest.goto(`/${dataset}?view=table`); await waitForAppReady(guest);
    await expect(guest.locator(`#${dataset}_filterBar_panel`)).toHaveClass(/filterbar-panel--hidden/);
    await expect.poll(() => firstSection(guest, dataset)).toBe('style');
    const publicLayout = await read<Record<string, unknown>>(guest.request, '/api/filterbar-section-layout');
    expect(Object.keys(publicLayout).sort()).toEqual(['allow_own_order', 'section_collapsed', 'section_order']);
  });
}
