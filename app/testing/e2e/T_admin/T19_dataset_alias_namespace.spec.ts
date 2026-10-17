/**
 * T19_dataset_alias_namespace.spec.ts
 * Proves real-name refusal, accepted alias/clear and translated notices in both themes.
 * Uses real temporary datasets and the administrator API; theme preferences are stubbed.
 * Complements the PostgreSQL collision audit/races with browser rendering evidence.
 */
import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, dropTempDataset } from '../helpers/temp-dataset';
import { sanitizeTestIdPart } from '../../../frontend/reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js';

let realName: string;
let ownerName: string;
let safeAlias: string;
const isAccountTheme = (url: URL) => url.pathname === '/api/user-visual-preference';
const runsHere = (project: TestInfo['project']) => project.metadata?.screenWidth === 'desktop' && project.metadata?.cardView === 'normal';
const copy = {
  en: { refusal: 'This name already belongs to another dataset or a reserved route. Choose another name.', saved: 'Dataset alias saved', cleared: 'Dataset alias cleared', audit: 'This alias was disabled because a real dataset owns the name. The alias record was preserved.' },
  fi: { refusal: 'Nimi kuuluu jo toiselle aineistolle tai varatulle osoitteelle. Valitse toinen nimi.', saved: 'Aineiston alias tallennettu.', cleared: 'Aineiston alias poistettu.', audit: 'Alias on poistettu käytöstä, koska nimi kuuluu varsinaiselle aineistolle. Aliastiedot on säilytetty.' },
  ch: { refusal: '此名称已属于其他数据集或保留网址。请选择其他名称。', saved: '数据集别名已保存。', cleared: '数据集别名已清除。', audit: '此别名因名称属于真实数据集而被停用。别名记录已保留。' },
  yue: { refusal: '呢個名稱已屬於另一個資料集或保留網址。請揀另一個名稱。', saved: '資料集別名已儲存。', cleared: '資料集別名已清除。', audit: '呢個別名因名稱屬於真實資料集而停用。別名記錄已保留。' },
};

test.describe('T15 — One namespace for dataset names and aliases', () => {
  let credentials: TestCredentials;
  const created: string[] = [];

  test.beforeAll(async ({ browser }, workerInfo) => {
    credentials = loadCredentials();
    if (!runsHere(workerInfo.project)) return;
    // fullyParallel can run this hook again in the same worker after cleanup.
    // Registry history retains each name/UID pair, so every setup needs new names.
    realName = buildTempDatasetName('e2e_ns_real');
    ownerName = buildTempDatasetName('app_e2e_ns_owner');
    safeAlias = ownerName.slice(4) + '_saved';
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      await login(page, credentials);
      for (const datasetName of [realName, ownerName]) {
        await createTempDataset(page, { datasetName, columns: { id: 'SERIAL', title: 'TEXT' }, seedRows: [{ title: datasetName }] });
        created.push(datasetName);
      }
    } finally { await context.close(); }
  });

  test.afterAll(async ({ browser }) => {
    if (!created.length) return;
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      await login(page, credentials);
      // Reverse order also proves deletion of a dataset with its alias metadata.
      while (created.length) {
        await dropTempDataset(page, created[created.length - 1]);
        created.pop();
      }
    } finally { await context.close(); }
  });

  for (const language of ['en', 'fi', 'ch', 'yue'] as const) {
    for (const theme of ['light', 'dark'] as const) {
      test(`${language}/${theme}: refuses another dataset's real name and accepts a free alias`, async ({ page }, testInfo) => {
        test.skip(!runsHere(testInfo.project), 'One desktop project proves this namespace/editor contract.');
        test.setTimeout(90_000);
        await login(page, credentials);
        await openEditor(page, language, theme);
        const editor = page.locator('#dataset_alias_management_container');
        await selectOwner(page);
        const input = editor.getByTestId('dataset-alias-management-input');
        const original = await input.inputValue();
        await input.fill(realName.toUpperCase());
        const refused = page.waitForResponse(response => response.url().includes('/api/dataset-alias-management/save') && response.request().method() === 'POST');
        await editor.getByTestId('dataset-alias-management-save').click();
        const response = await refused;
        expect(response.status()).toBe(409);
        expect(await response.json()).toMatchObject({ error_lang_key: 'dataset_namespace_conflict', code: 409 });
        await expect(page.getByTestId('toast').filter({ hasText: copy[language].refusal })).toBeVisible();
        await expect(input).toHaveValue(realName.toUpperCase());
        await expect(input).toBeEnabled();
        await expect(editor.locator('.dataset-alias-management-preview-value').filter({ hasText: `/${original}` })).not.toHaveCount(0);

        await input.fill(safeAlias);
        await editor.getByTestId('dataset-alias-management-save').click();
        await expect(page.getByTestId('toast').filter({ hasText: copy[language].saved })).toBeVisible();
        await expect(editor.locator('.dataset-alias-management-preview-value').filter({ hasText: `/${safeAlias}` })).not.toHaveCount(0);
        await editor.getByTestId('dataset-alias-management-clear').click();
        await expect(page.getByTestId('toast').filter({ hasText: copy[language].cleared })).toBeVisible();
        await expect(input).toHaveValue(ownerName.slice(4));

        const catalogue = await page.request.get('/api/datasets');
        expect(catalogue.ok()).toBe(true);
        const entries = (await catalogue.json()).datasets;
        const real = entries.find((entry: { dataset_name: string }) => entry.dataset_name === realName);
        const owner = entries.find((entry: { dataset_name: string }) => entry.dataset_name === ownerName);
        expect(real.names).toContain(realName);
        expect(owner.names).not.toContain(realName);
        await editor.screenshot({ path: testInfo.outputPath(`namespace-${language}-${theme}.png`) });
      });
    }
  }

  test('renders preserved collision-audit notices in both explicit themes', async ({ page }, testInfo) => {
    test.skip(!runsHere(testInfo.project), 'One desktop project proves audit notice layout.');
    await login(page, credentials);
    // The real audit is proved by the migration PostgreSQL test. This read-model
    // fixture proves rendering without inserting a forbidden new collision.
    await page.route('**/api/dataset-alias-management', async route => {
      const response = await route.fetch();
      const snapshot = await response.json();
      const entry = snapshot.datasets.find((item: { dataset_name: string }) => item.dataset_name === ownerName);
      expect(entry).toBeTruthy();
      entry.disabled_aliases = [{ alias_slug: realName, reason_key: 'dataset_namespace_real_name_conflict' }];
      await route.fulfill({ response, json: snapshot });
    });
    for (const theme of ['light', 'dark'] as const) {
      await openEditor(page, 'fi', theme);
      await selectOwner(page);
      const audit = page.getByTestId('dataset-alias-management-audit');
      await expect(audit).toBeVisible();
      await expect(audit).toContainText(realName);
      await expect(audit).toContainText(copy.fi.audit);
      await expect(audit).toHaveAttribute('role', 'status');
      await audit.screenshot({ path: testInfo.outputPath(`namespace-audit-fi-${theme}.png`) });
    }
  });
});

async function openEditor(page: Page, language: string, theme: 'light' | 'dark') {
  await page.unroute(isAccountTheme);
  await page.route(isAccountTheme, async route => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    await route.fulfill({ json: { theme_mode: theme, revision: 1, configured: true } });
  });
  await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
  await page.evaluate(({ language, theme }) => {
    localStorage.setItem('chosen_language', language);
    localStorage.setItem('theme', theme);
  }, { language, theme });
  await page.goto('/admin/dataset_alias_management', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
  await expect(page.locator('#dataset_alias_management_container')).toBeVisible();
  await expect(page.getByTestId('dataset-alias-management-dataset-trigger')).toBeVisible();
}

async function selectOwner(page: Page) {
  await page.getByTestId('dataset-alias-management-dataset-trigger').click();
  await page.getByTestId('dataset-alias-management-dataset-search-input').fill(ownerName);
  await page.getByTestId(`dataset-alias-management-dataset-option-${sanitizeTestIdPart(ownerName)}`).click();
}
