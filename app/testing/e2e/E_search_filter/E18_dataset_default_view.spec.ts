// E18_dataset_default_view.spec.ts
// Proves a saved Calendar default opens for an administrator and ordinary reader; clearing inherits Cards.
// Connects the filterbar checkbox, reload precedence and the registered temporary-dataset lifecycle.
// Independent request contexts restore both themes and the dataset after timeouts or page crashes.
// Uses the reserved administrator and ordinary test user, with distinct account IDs.
import { expect, test, type Page, type BrowserContext, type APIRequestContext } from '@playwright/test';
import { login, loadCredentials, loadUserCredentials, readSessionInfo } from '../helpers/auth';
import { waitForAppReady } from '../helpers/navigation';
import { revealActiveFilterbarSection } from '../helpers/filterbar';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest, openTempDataset, fetchCsrfTokenForRequest } from '../helpers/temp-dataset';
import { listRegisteredTestArtifacts } from '../helpers/test-artifact-run-registry';

const endpoint = '/api/admin/dataset-default-view';
type DefaultState = { dataset: string; default_view_id: number | null; default_view_name: string | null; offered_views: string[] };
type ThemePreference = { theme_mode: 'light' | 'dark' | 'system'; configured: boolean };
type AccountCleanup = { request: APIRequestContext; original?: ThemePreference };
type ProofCleanup = { dataset: string; accounts: AccountCleanup[]; original?: DefaultState; secondContext?: BrowserContext };
let cleanup: ProofCleanup | undefined;

async function readDefault(request: APIRequestContext, dataset: string): Promise<DefaultState> {
  const response = await request.get(endpoint, { params: { dataset } });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<DefaultState>;
}
async function setDefault(request: APIRequestContext, dataset: string, view: string | null) {
  const response = await request.post(endpoint, { headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(request) },
    data: { dataset, view_key: view } });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<DefaultState>;
}
async function reloadUsingDefault(page: Page, dataset: string, view: 'calendar' | 'card', address: string) {
  // Remove only this owned dataset's tab choice; otherwise it intentionally outranks the default.
  await page.evaluate(name => sessionStorage.removeItem(name + '_view'), dataset);
  const target = new URL(address); target.searchParams.delete('view');
  await page.goto(target.toString(), { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await expect(page.locator(`#${dataset}_${view}_view_container`)).toBeVisible();
  // Main's settled renderer replaces a no-view address with the resolved view.
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe(view);
}

async function clickDefaultCheckbox(page: Page, dataset: string, view: 'calendar' | null) {
  const section = await revealActiveFilterbarSection(page, 'views');
  const row = section.getByTestId('dataset-default-view-row');
  await expect(row).toHaveAttribute('aria-busy', 'false');
  await row.scrollIntoViewIfNeeded();
  await expect(row).toBeInViewport();
  const checkbox = row.getByTestId('dataset-default-view-checkbox');
  await checkbox.scrollIntoViewIfNeeded();
  await expect(checkbox).toBeInViewport({ ratio: 1 });
  await expect(checkbox).toBeEnabled();
  // Record the real input's trusted click, including on the narrow phone panel.
  await checkbox.evaluate(element => {
    element.addEventListener('click', event => {
      element.setAttribute('data-e2e-trusted-click', String(event.isTrusted && event.target === element));
    }, { once: true });
  });
  const isSave = (request: import('@playwright/test').Request) =>
    new URL(request.url()).pathname === endpoint && request.method() === 'POST'
      && request.postDataJSON().dataset === dataset;
  // Keep all three promises observed if actionability or the request fails.
  const [request, response] = await Promise.all([
    page.waitForRequest(isSave),
    page.waitForResponse(response => isSave(response.request())),
    checkbox.click(),
  ]);
  expect(request.postDataJSON()).toEqual({ dataset, view_key: view });
  expect(response.ok(), await response.text()).toBe(true);
  await expect(checkbox).toHaveAttribute('data-e2e-trusted-click', 'true');
  await expect(row).toHaveAttribute('aria-busy', 'false');
  if (view) await expect(checkbox).toBeChecked();
  else await expect(checkbox).not.toBeChecked();
}

test.describe.configure({ mode: 'serial' });
// Playwright gives afterEach a separate teardown budget after a test timeout.
// These contexts own copied session cookies and an explicit base URL, so neither
// a closed page nor chrome-error: can prevent account or dataset restoration.
test.afterEach(async ({ page }) => {
  const state = cleanup; cleanup = undefined;
  if (!state) return;
  const failures: unknown[] = [];
  const attempt = async (action: () => Promise<unknown>) => { try { await action(); } catch (error) { failures.push(error); } };
  if (!page.isClosed()) await attempt(() => page.close());
  if (state.secondContext) await attempt(() => state.secondContext!.close());
  const administrator = state.accounts[0]?.request;
  if (administrator && state.original) await attempt(async () => {
    const restored = await setDefault(administrator, state.dataset, state.original!.default_view_name);
    expect(restored).toMatchObject({ default_view_id: state.original!.default_view_id, default_view_name: state.original!.default_view_name });
  });
  for (const captured of state.accounts) {
    if (!captured.original) continue;
    await attempt(async () => {
      const headers = { 'X-CSRF-Token': await fetchCsrfTokenForRequest(captured.request) };
      const restored = captured.original!.configured
        ? await captured.request.patch('/api/user-visual-preference', { headers, data: { theme_mode: captured.original!.theme_mode } })
        : await captured.request.delete('/api/user-visual-preference', { headers });
      expect(restored.ok(), await restored.text()).toBe(true);
      expect(await restored.json()).toMatchObject({
        theme_mode: captured.original!.theme_mode, configured: captured.original!.configured,
      });
    });
  }
  if (administrator) await attempt(async () => {
    // Creation can time out after ownership was confirmed but before it returns.
    // The shared helper checks the registered UID and removes the dataset's grants.
    const owned = listRegisteredTestArtifacts().find(artifact => artifact.kind === 'dataset' && artifact.name === state.dataset);
    if (owned?.status === 'confirmed') await cleanupDatasetViaRequest(administrator, state.dataset);
  });
  for (const captured of state.accounts) await attempt(() => captured.request.dispose());
  if (failures.length) throw new AggregateError(failures, 'Default-view proof cleanup failed');
});

for (const theme of ['light', 'dark'] as const) {
  test(`dataset default: administrator and ordinary reader, ${theme} override against opposite OS theme`, async ({ page, browser, playwright }, testInfo) => {
    test.setTimeout(180_000);
    const state: ProofCleanup = { dataset: buildTempDatasetName('e2e_default_view'), accounts: [] };
    cleanup = state;
    const dataset = state.dataset;
    const baseURL = testInfo.project.use.baseURL;
    const extraHTTPHeaders = testInfo.project.use.extraHTTPHeaders;
    expect(baseURL).toBeTruthy();
    await login(page, loadCredentials());
    state.accounts.push({ request: await playwright.request.newContext({ ignoreHTTPSErrors: true, baseURL, extraHTTPHeaders,
      storageState: await page.context().storageState() }) });
    state.secondContext = await browser.newContext({ ignoreHTTPSErrors: true, baseURL, extraHTTPHeaders,
      viewport: page.viewportSize() ?? undefined, storageState: { cookies: [], origins: [] } });
    const secondPage = await state.secondContext.newPage();
    await login(secondPage, loadUserCredentials());
    state.accounts.push({ request: await playwright.request.newContext({ ignoreHTTPSErrors: true, baseURL, extraHTTPHeaders,
      storageState: await secondPage.context().storageState() }) });
    expect((await readSessionInfo(secondPage)).user_id).not.toBe((await readSessionInfo(page)).user_id);
    for (const [index, active] of [page, secondPage].entries()) {
      const captured = state.accounts[index];
      const response = await captured.request.get('/api/user-visual-preference');
      expect(response.ok(), await response.text()).toBe(true);
      captured.original = await response.json() as ThemePreference;
      const pinned = await captured.request.patch('/api/user-visual-preference', {
        headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(captured.request) }, data: { theme_mode: theme },
      });
      expect(pinned.ok(), await pinned.text()).toBe(true);
      await active.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    }
    // Only this owned dataset receives the reader grant; its deletion removes it.
    await createTempDataset(page, { datasetName: dataset, grantUsersRead: true,
      columns: { id: 'SERIAL', title: 'TEXT', start_date: 'DATE' },
      seedRows: [{ title: 'Calendar default proof', start_date: '2026-10-15' }] });
    state.original = await readDefault(page.request, dataset);
    await openTempDataset(page, dataset, 'card');
    const datasetAddress = page.url();
    const section = await revealActiveFilterbarSection(page, 'views');
    const row = section.getByTestId('dataset-default-view-row');
    await expect(row).toBeVisible();
    await row.getByTestId('dataset-default-view-trigger').click();
    await page.getByTestId('dataset-default-view-option-calendar').click();
    await expect(row.getByTestId('dataset-default-view-checkbox')).not.toBeChecked();
    expect((await readDefault(page.request, dataset)).default_view_id).toBe(state.original.default_view_id);
    await clickDefaultCheckbox(page, dataset, 'calendar');
    await reloadUsingDefault(page, dataset, 'calendar', datasetAddress);
    await reloadUsingDefault(secondPage, dataset, 'calendar', datasetAddress);
    await expect(page.locator('body')).toHaveClass(new RegExp(theme + '-mode'));
    await expect(secondPage.locator('body')).toHaveClass(new RegExp(theme + '-mode'));
    await expect(secondPage.getByTestId('dataset-default-view-row')).toHaveCount(0);
    const calendarSection = await revealActiveFilterbarSection(page, 'views');
    await expect(calendarSection.getByTestId('dataset-default-view-checkbox')).toBeChecked();
    await clickDefaultCheckbox(page, dataset, null);
    expect(await readDefault(page.request, dataset)).toMatchObject({ default_view_id: null, default_view_name: null });
    await reloadUsingDefault(secondPage, dataset, 'card', datasetAddress);
    await reloadUsingDefault(page, dataset, 'card', datasetAddress);
    const proofSection = await revealActiveFilterbarSection(page, 'views');
    await proofSection.screenshot({ path: testInfo.outputPath(`dataset-default-${theme}.png`) });
  });
}
