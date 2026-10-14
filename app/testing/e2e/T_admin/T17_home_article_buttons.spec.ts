// T17_home_article_buttons.spec.ts
// Proves administrator selection, both Home placements and ungranted reader omission.
// Connects a disposable dataset row, real revision-protected saves and ordinary article navigation.
// Restores captured settings (absence as an equivalent empty list) before deleting the owned dataset.
// Run natively, serially; invalid settings or unavailable original targets are refused.
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { login, loadUserCredentials, readSessionInfo } from '../helpers/auth';
import { waitForAppReady } from '../helpers/navigation';
import { buildTempDatasetName, createTempDataset, dropTempDataset, fetchCsrfTokenForRequest } from '../helpers/temp-dataset';
import { loadDatasetCardVisibility, saveCardVisibilityWithFreshRevisions } from '../helpers/appearance-revisions';

test.describe.configure({ mode: 'serial' });
const SETTINGS_URL = '/api/admin/front-page/article-buttons';
const LABEL = 'Temporary Home contact';
type ArticleConfiguration = { schema_version: number; placement: 'below_text' | 'top_row';
  items: Array<{ table_uid: number; row_id: string; enabled: boolean }> };
type ArticleSettings = { article_buttons: ArticleConfiguration; version: string;
  unavailable_items: unknown[]; configuration_error: string };
type ThemePreference = { theme_mode: 'system' | 'light' | 'dark'; configured: boolean; revision: number };

// Playwright's line reporter omits AggregateError.errors, including nested
// dataset-create/compensation failures. Print the original stacks at their step.
function printStepError(step: string, error: unknown): void {
  console.error(`[T17] ${step}: ${error instanceof Error ? error.message : String(error)}\n`
    + (error instanceof Error ? error.stack ?? '(no stack supplied)' : '(no stack supplied)'));
  if (error instanceof AggregateError) {
    error.errors.forEach((inner, index) => printStepError(`${step} / inner error ${index + 1}`, inner));
  }
}

async function readJSON<T>(request: APIRequestContext, url: string): Promise<T> {
  const response = await request.get(url);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}
async function pinTheme(page: Page, theme: 'light' | 'dark'): Promise<ThemePreference> {
  const headers = { 'X-CSRF-Token': await fetchCsrfTokenForRequest(page.request) };
  const response = await page.request.patch('/api/user-visual-preference', { headers, data: { theme_mode: theme } });
  expect(response.ok(), await response.text()).toBe(true);
  await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
  return response.json() as Promise<ThemePreference>;
}
async function home(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
}
async function editor(page: Page) {
  await page.getByTestId('front-page-settings-hero-button').click();
  const modal = page.getByTestId('front-page-settings-modal');
  await expect(modal.getByTestId('front-page-article-editor')).toHaveAttribute('aria-busy', 'false');
  await expect(modal.getByTestId('front-page-article-dataset')).toBeEnabled();
  return modal;
}
async function saveEditor(page: Page, recordSaved: (version: string) => void): Promise<void> {
  // A disabled save cannot send a POST. Fail at the draft instead of spending
  // the test budget waiting for a response. Observe rejection immediately, but
  // finish the click before throwing a response error or beginning cleanup.
  await expect(page.getByTestId('front-page-article-save')).toBeEnabled();
  const response = page.waitForResponse(res => new URL(res.url()).pathname === SETTINGS_URL && res.request().method() === 'POST')
    .then(saved => ({ saved }), error => ({ error }));
  await page.getByTestId('front-page-article-save').click();
  const outcome = await response;
  if ('error' in outcome) throw outcome.error;
  const saved = outcome.saved;
  expect(saved.ok(), await saved.text()).toBe(true);
  const version = (await saved.json()).version as string; recordSaved(version);
  await expect(page.getByTestId('front-page-article-editor')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByTestId('front-page-article-save')).toBeDisabled();
  await page.getByTestId('front-page-settings-modal').getByTestId('modal-close-button').click();
  await expect(page.getByTestId('front-page-settings-modal')).toBeHidden();
}

for (const width of [1280, 375]) for (const theme of ['light', 'dark'] as const) {
  test(`article buttons: both placements at ${width}px in ${theme}, with ungranted reader`, async ({ page, browser }, testInfo) => {
    // Native planning estimate (the named steps below log actual elapsed ms):
    // capture/baseline/context 5 s + reader sign-in 10 + create/seed/cache 15 + appearance 5 +
    // Home/theme 5 + editor 10 + two placements 2x5 + navigation 2x5 + reader
    // checks 2x5 + exact restoration/context close 30 = 110 s; 40 s margin
    // gives 150 s shared by body and finally. No assertion/request limits change.
    // The previous native log measured only the 30 s timeout, not its steps.
    test.setTimeout(150_000);
    const failures: unknown[] = [];
    const step = async <T>(name: string, action: () => Promise<T>): Promise<T> => {
      const started = performance.now();
      console.log(`[T17] start: ${name}`);
      try { return await test.step(name, action); }
      catch (error) { failures.push(error); printStepError(name, error); throw error; }
      finally { console.log(`[T17] elapsed: ${name}: ${Math.round(performance.now() - started)} ms`); }
    };
    const { original, originallyAbsent, baseline, originalHome, originalTheme, identity } = await step('capture original settings', async () => {
      await page.goto('/', { waitUntil: 'domcontentloaded' }); await waitForAppReady(page);
      const original = await readJSON<ArticleSettings>(page.request, SETTINGS_URL);
      expect(original.configuration_error, 'T17 refuses to mutate invalid article settings: the API cannot restore them exactly.').toBe('');
      expect(original.unavailable_items, 'T17 refuses to mutate article settings with unavailable targets: the API cannot restore them exactly.').toEqual([]);
      const originallyAbsent = original.version === 'none';
      // No API restores absence: generic deletion is protected by
      // app/backend/core_components/system_config_checks/front_page_article_buttons.go.
      // An empty list is equivalent: readFrontPageArticleButtons in
      // app/backend/core_components/system_table_tools/front_page_article_buttons_store.go
      // returns it for absence, and resolveFrontPageArticleButtons in
      // app/backend/core_components/system_table_tools/front_page_article_buttons_read.go
      // emits no buttons for either state. Preserve existing settings exactly.
      const baseline: ArticleConfiguration = originallyAbsent
        ? { schema_version: 1, placement: 'below_text', items: [] } : original.article_buttons;
      if (originallyAbsent) {
        expect(original.article_buttons).toEqual(baseline);
        testInfo.annotations.push({ type: 'home-article-buttons-original-state',
          description: 'Setting was absent; baseline and restoration use the behaviourally equivalent empty list.' });
      }
      const originalHome = await readJSON<{ settings: Record<string, boolean> }>(page.request, '/api/admin/front-page');
      const originalTheme = await readJSON<ThemePreference>(page.request, '/api/user-visual-preference');
      const identity = await readSessionInfo(page);
      return { original, originallyAbsent, baseline, originalHome, originalTheme, identity };
    });
    const name = buildTempDatasetName('e2e_home_article_button');
    const readerContext = await step('create reader context', () => browser.newContext({ ignoreHTTPSErrors: true, storageState: { cookies: [], origins: [] } }));
    let created = false, settingsChanged = false, themeAttempted = false, themeSaved: ThemePreference | null = null;
    let lastVersion = original.version, buttonsChanged = false, buttonSaveAttempted = false;
    let expectedConfiguration = baseline;
    let pendingConfiguration = baseline;
    let reader: Page | null = null;
    try {
      await step('reader sign-in and grant boundary', async () => {
        reader = await readerContext.newPage(); await login(reader, loadUserCredentials());
        // Prove the reserved ordinary reader's real grant boundary, before any
        // settings are touched. No shared grants are removed for this test.
        expect(await reader.evaluate(() => JSON.parse(sessionStorage.getItem('user_permissions') || '[]')))
          .not.toContain('/ui/view/article_view');
      });
      await step('establish absent-setting baseline', async () => {
        if (originallyAbsent) {
          buttonSaveAttempted = true;
          const saved = await page.request.post(SETTINGS_URL, {
            headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(page.request) },
            data: { article_buttons: baseline, version: original.version },
          });
          expect(saved.ok(), await saved.text()).toBe(true);
          lastVersion = (await saved.json()).version; buttonsChanged = true;
          expect(lastVersion).not.toBe('none');
          const capturedBaseline = await readJSON<ArticleSettings>(page.request, SETTINGS_URL);
          expect(capturedBaseline).toEqual({ article_buttons: baseline, version: lastVersion,
            unavailable_items: [], configuration_error: '' });
        }
      });
      await step('create dataset, seed row and hydrate caches', async () => {
        await createTempDataset(page, { datasetName: name, grantUsersRead: true,
          columns: { id: 'SERIAL', title: 'TEXT' }, seedRows: [{ title: LABEL }] });
        created = true;
      });
      const uid = await step('configure dataset article title', async () => {
        await saveCardVisibilityWithFreshRevisions(page.request, name, current => ({
          card_details_layout: current.card_details_layout, card_style_variant: current.card_style_variant,
          columns: current.columns.map(column => ({ ...column, card_element: column.column_name === 'title' ? 'header' : column.card_element,
            show_value_on_card: true, hide_on_big_card: false })),
        }));
        const visibility = await loadDatasetCardVisibility(page.request, name);
        const uid = visibility.dataset_appearance.dataset_uid;
        return uid;
      });
      await step('configure Home, pin account theme and load viewport', async () => {
        const headers = { 'X-CSRF-Token': await fetchCsrfTokenForRequest(page.request) };
        settingsChanged = true;
        const enabled = await page.request.post('/api/admin/front-page', { headers,
          data: { settings: { ...originalHome.settings, separate_front_page: true, front_page_show_blocks: false } } });
        expect(enabled.ok(), await enabled.text()).toBe(true);
        themeAttempted = true; themeSaved = await pinTheme(page, theme);
        await page.setViewportSize({ width, height: 900 }); await home(page);
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
      });
      await step('configure article editor and select row', async () => {
        const modal = await editor(page);
        const oldRows = modal.getByTestId('front-page-article-list');
        while (await oldRows.locator('li').count()) await modal.getByTestId('front-page-article-0-remove').click();
        await modal.getByTestId('front-page-article-dataset').selectOption(String(uid));
        await modal.getByTestId('front-page-article-row').click();
        await modal.getByTestId('front-page-article-search').fill(LABEL);
        const option = modal.locator('.msd-option').filter({ hasText: LABEL });
        await expect(option).toHaveCount(1); await option.click();
        await expect(modal.getByTestId('front-page-article-preview')).toContainText(LABEL);
        await modal.getByTestId('front-page-article-add').click();
      });
      for (const placement of ['below_text', 'top_row'] as const) {
        await step(`${placement}: save and verify placement, touch size and focus`, async () => {
          if (placement === 'top_row') await editor(page);
          await page.getByTestId('front-page-article-placement').selectOption(placement);
          pendingConfiguration = { schema_version: 1, placement, items: [{ table_uid: uid, row_id: '1', enabled: true }] };
          buttonSaveAttempted = true;
          await saveEditor(page, version => {
            lastVersion = version; buttonsChanged = true; expectedConfiguration = pendingConfiguration;
          });
          const link = page.locator('#front_page_container .front-page-article-button');
          await expect(link).toHaveCount(1); await expect(link).toHaveAccessibleName(LABEL);
          const href = await link.getAttribute('href'); expect(href).toMatch(/\/1\?view=article_view$/);
          const bounds = (await link.boundingBox())!; expect(bounds.height).toBeGreaterThanOrEqual(44);
          await page.keyboard.press('Tab'); await link.focus(); await expect(link).toBeFocused();
          expect(await link.evaluate(el => parseFloat(getComputedStyle(el).outlineWidth))).toBeGreaterThan(0);
          if (placement === 'below_text') {
            await expect(page.locator('.front-page-hero > .front-page-article-buttons > a')).toHaveCount(1);
            if (width === 375) {
              const heroBounds = (await page.locator('.front-page-hero').boundingBox())!;
              expect(bounds.width).toBeCloseTo(heroBounds.width, 0);
            }
          } else {
            await expect(page.locator('.front-page-top-row > .hero-dataset-tabs + .front-page-article-buttons > a')).toHaveCount(1);
            const pill = await link.evaluate(el => {
              const style = getComputedStyle(el);
              const luminance = (colour: string) => {
                const rgb = colour.match(/[\d.]+/g)?.slice(0, 3).map(Number);
                if (!rgb || rgb.length !== 3) throw new Error(`Unrecognised computed colour: ${colour}`);
                const [r, g, b] = rgb.map(value => {
                  const channel = value / 255;
                  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
                });
                return 0.2126 * r + 0.7152 * g + 0.0722 * b;
              };
              const contrast = (foreground: string, halo: string) => {
                const a = luminance(foreground), b = luminance(halo);
                return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
              };
              const textHalo = style.textShadow.match(/rgb\([^)]+\)/)?.[0];
              const borderHalo = style.boxShadow.match(/rgb\([^)]+\)/)?.[0];
              if (!textHalo || !borderHalo) throw new Error('Transparent Home pills require opaque theme contrast halos.');
              return { background: style.backgroundColor, border: parseFloat(style.borderTopWidth),
                radius: parseFloat(style.borderTopLeftRadius), weight: Number(style.fontWeight),
                padding: parseFloat(style.paddingInlineStart), textContrast: contrast(style.color, textHalo),
                borderContrast: contrast(style.borderTopColor, borderHalo) };
            });
            expect(pill.background).toBe('rgba(0, 0, 0, 0)'); expect(pill.border).toBe(2);
            expect(pill.radius).toBeGreaterThanOrEqual(bounds.height / 2); expect(pill.weight).toBeGreaterThanOrEqual(700);
            expect(pill.padding).toBeGreaterThanOrEqual(24);
            expect(pill.textContrast).toBeGreaterThanOrEqual(4.5); expect(pill.borderContrast).toBeGreaterThanOrEqual(3);
            if (width === 375) {
              const tabs = (await page.locator('.front-page-top-row > .hero-dataset-tabs').boundingBox())!;
              expect(bounds.y).toBeGreaterThanOrEqual(tabs.y + tabs.height);
              const row = (await page.locator('.front-page-top-row').boundingBox())!;
              const inset = await page.locator('.front-page-top-row').evaluate(el => {
                const style = getComputedStyle(el);
                return parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
                  + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
              });
              expect(bounds.width).toBeCloseTo(row.width - inset, 0);
            } else {
              const lastTab = page.locator('.front-page-top-row .hero-dataset-tabs__button:visible').last();
              await expect(lastTab).toBeVisible();
              const tab = (await lastTab.boundingBox())!;
              expect(bounds.x).toBeGreaterThanOrEqual(tab.x + tab.width);
              expect(bounds.y + bounds.height / 2).toBeCloseTo(tab.y + tab.height / 2, 0);
              const edge = await page.locator('.front-page-top-row').evaluate(el => {
                const style = getComputedStyle(el), row = el.getBoundingClientRect();
                const actions = el.querySelector('.filterbar-inline-hero__actions');
                const actionBounds = actions?.getClientRects().length ? actions.getBoundingClientRect() : null;
                return { right: row.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth),
                  gap: parseFloat(style.columnGap), actions: actionBounds && { left: actionBounds.left, right: actionBounds.right } };
              });
              // Administrators reserve the trailing actions; visitors' pills
              // reach the same content edge directly, without an empty slot.
              if (edge.actions) {
                expect(edge.actions.right).toBeCloseTo(edge.right, 0);
                expect(bounds.x + bounds.width).toBeCloseTo(edge.actions.left - edge.gap, 0);
              } else expect(bounds.x + bounds.width).toBeCloseTo(edge.right, 0);
            }
          }
          expect(await page.locator('#front_page_container').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        });
        const link = page.locator('#front_page_container .front-page-article-button');
        await step(`${placement}: article navigation and return Home`, async () => {
          await link.click(); await expect(page).toHaveURL(new RegExp('/1(?:-[^?]*)?\\?view=article_view'));
          await expect(page.locator('.active_row_article .big_card_header')).toContainText(LABEL);
          await home(page); await expect(link).toBeVisible();
        });
        await step(`${placement}: reader row access and Home omission`, async () => {
          const readable = await reader.request.get(`/api/get-results?dataset=${encodeURIComponent(name)}&id=1`);
          expect(readable.ok(), await readable.text()).toBe(true);
          expect((await readable.json()).data).toContainEqual(expect.objectContaining({ id: 1, title: LABEL }));
          const privateHome = await readJSON<{ article_buttons: unknown[] }>(reader.request, '/api/front-page');
          expect(privateHome.article_buttons).toEqual([]);
          await home(reader); await expect(reader.locator('#front_page_container .front-page-article-button')).toHaveCount(0);
          await expect(reader.locator('#front_page_container')).not.toContainText(LABEL);
        });
      }
    } catch (error) {
      // Named steps retain the original error. Also report any failure between
      // steps, so future body edits cannot accidentally bypass the aggregate.
      if (!failures.includes(error)) { failures.push(error); printStepError('body between named steps', error); }
    } finally {
      // Run every cleanup even if an earlier restore fails. A failed body and
      // cleanup are both reported; neither becomes a silent leftover.
      const attempt = async (name: string, action: () => Promise<void>) => {
        try { await step(name, action); } catch { /* Recorded above; continue every exact cleanup. */ }
      };
      await attempt('restore exact article configuration and absence equivalence', async () => {
        if (!buttonSaveAttempted) return;
        const latest = await readJSON<ArticleSettings>(page.request, SETTINGS_URL);
        if (!buttonsChanged && latest.version === original.version) return;
        if (latest.version === lastVersion) {
          expect(latest.article_buttons, 'Refusing to overwrite another editor during cleanup.').toEqual(expectedConfiguration);
        } else {
          // A POST may commit before its response or subsequent UI assertions
          // fail. Only our exact attempted list authorizes that compensation.
          expect(latest.article_buttons, 'Refusing to overwrite another editor during cleanup.').toEqual(pendingConfiguration);
        }
        const restored = await page.request.post(SETTINGS_URL, { headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(page.request) },
          data: { article_buttons: baseline, version: latest.version } });
        expect(restored.ok(), await restored.text()).toBe(true);
        const restoredState = await readJSON<ArticleSettings>(page.request, SETTINGS_URL);
        expect(restoredState.article_buttons).toEqual(baseline);
        if (originallyAbsent) {
          expect(restoredState.version).not.toBe('none');
          expect(restoredState.configuration_error).toBe(''); expect(restoredState.unavailable_items).toEqual([]);
          expect(reader).not.toBeNull();
          // Prove absence-equivalent behaviour while Home is still enabled,
          // before restoring its switches and removing the owned dataset.
          for (const viewer of [page, reader!]) {
            expect((await readJSON<{ article_buttons: unknown[] }>(viewer.request, '/api/front-page')).article_buttons).toEqual([]);
            await home(viewer);
            await expect(viewer.locator('#front_page_container .front-page-article-button')).toHaveCount(0);
          }
        }
      });
      await attempt('restore exact Home switches', async () => {
        if (!settingsChanged) return;
        const restored = await page.request.post('/api/admin/front-page', {
          headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(page.request) }, data: { settings: originalHome.settings },
        });
        expect(restored.ok(), await restored.text()).toBe(true);
        expect((await readJSON<{ settings: Record<string, boolean> }>(page.request, '/api/admin/front-page')).settings).toEqual(originalHome.settings);
      });
      await attempt('restore exact account theme preference', async () => {
        if (!themeAttempted) return;
        expect((await readSessionInfo(page)).user_id).toBe(identity.user_id);
        const current = await readJSON<ThemePreference>(page.request, '/api/user-visual-preference');
        if (!themeSaved && JSON.stringify(current) === JSON.stringify(originalTheme)) return;
        if (themeSaved) expect(current).toEqual(themeSaved);
        else expect(current).toMatchObject({ theme_mode: theme, configured: true });
        const headers = { 'X-CSRF-Token': await fetchCsrfTokenForRequest(page.request) };
        const restored = originalTheme.configured
          ? await page.request.patch('/api/user-visual-preference', { headers, data: { theme_mode: originalTheme.theme_mode } })
          : await page.request.delete('/api/user-visual-preference', { headers });
        expect(restored.ok(), await restored.text()).toBe(true);
        expect(await restored.json()).toMatchObject({ theme_mode: originalTheme.theme_mode, configured: originalTheme.configured });
      });
      await attempt('delete owned dataset', async () => { if (created) await dropTempDataset(page, name); });
      await attempt('close reader context', () => readerContext.close());
    }
    if (failures.length) throw new AggregateError(failures, 'T17 body or exact cleanup failed');
  });
}
