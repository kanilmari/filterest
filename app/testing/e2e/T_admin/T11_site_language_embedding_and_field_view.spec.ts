/**
 * T11_site_language_embedding_and_field_view.spec.ts
 *
 * Verifies three administrator-owned configuration surfaces: site language
 * availability, external embedding source selection, and global dataset field
 * order/visibility. The embedding save proof uses an empty temporary table so
 * no row content can be queued or sent to an external provider.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { expandAdminTreeFolder, openAdminTreeButton } from '../helpers/admin-navigation';
import { waitForAppReady } from '../helpers/navigation';
import { revealActiveFilterbarSection } from '../helpers/filterbar';
import {
  openAdminNavigationTree,
  revealFirstNavigationDatasetButton,
} from '../helpers/navigation-tree';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

test.describe('Administrator-owned site and data presentation policies', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
    await waitForAppReady(page);
  });

  test('shows the five canonical site languages and keeps incomplete Chinese variants unpublished', async ({ page }) => {
    await expandAdminTreeFolder(page, 'site_settings');
    await openAdminTreeButton(page, 'site_languages');

    const table = page.locator('[data-testid="site-language-settings-table"]');
    await expect(table).toBeVisible({ timeout: 10000 });
    const languageCodes = await table.locator('tbody tr[data-language-code]').evaluateAll(
      (rows) => rows.map((row) => row.getAttribute('data-language-code')),
    );
    expect(languageCodes).toEqual(['en', 'fi', 'zh-CN', 'zh-TW', 'zh-HK']);
    await expect(table.locator('input[data-setting="is_default"]:checked')).toHaveCount(1);

    for (const languageCode of ['zh-CN', 'zh-TW', 'zh-HK']) {
      const row = table.locator(`tr[data-language-code="${languageCode}"]`);
      await expect(row).toBeVisible();
      await expect(row.locator('input[data-setting="public_selector_ready"]')).toBeDisabled();
    }
  });

  test('shows per-table and per-field external embedding choices without restricted-schema data', async ({ page }) => {
    await expandAdminTreeFolder(page, 'maintenance');
    await openAdminTreeButton(page, 'refresh_embeddings');

    const container = page.locator('#refresh_embeddings_container');
    await expect(container).toBeVisible({ timeout: 10000 });
    await expect(container.getByText(
      /Restricted-schema fields (?:are never available|cannot be selected) here\./,
    )).toBeVisible();
    const datasetRows = container.locator('tbody tr[data-name]');
    await expect(datasetRows.first()).toBeVisible({ timeout: 10000 });
    expect(await datasetRows.evaluateAll(
      (rows) => rows.every((row) => !String(row.getAttribute('data-name')).startsWith('restricted.')),
    )).toBe(true);
    await expect(container.locator('input[data-embedding-dataset-enabled="true"]').first()).toBeVisible();
    await expect(container.locator('input[data-column-uid]').first()).toBeVisible();
  });

  test('saves a new table and field policy before any vector target or row content exists', async ({ page }) => {
    test.setTimeout(60_000);
    const datasetName = buildTempDatasetName('e2e_embedding_policy');
    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        title: 'TEXT',
      },
    });

    try {
      await expandAdminTreeFolder(page, 'maintenance');
      await openAdminTreeButton(page, 'refresh_embeddings');

      const row = page.locator(`#refresh_embeddings_container tbody tr[data-name="${datasetName}"]`);
      await expect(row).toBeVisible({ timeout: 10000 });
      await expect(row).toHaveAttribute('data-embedding-target-ready', 'false');

      const enabled = row.locator('input[data-embedding-dataset-enabled="true"]');
      const titleField = row.locator('label', { hasText: /^title$/ }).locator('input[data-column-uid]');
      await expect(enabled).not.toBeChecked();
      await expect(titleField).toBeChecked();
      await enabled.check();

      const responsePromise = page.waitForResponse((response) => (
        response.url().includes('/api/admin/embedding-source-policy')
        && response.request().method() === 'POST'
      ));
      await row.getByRole('button', { name: 'Save field selection' }).click();
      const response = await responsePromise;
      const responseBody = await response.text();
      expect(response.ok(), `Embedding policy save failed: ${responseBody}`).toBe(true);

      const saved = JSON.parse(responseBody);
      expect(saved.queued_rows).toBe(0);
      expect(saved.policy).toMatchObject({
        dataset: datasetName,
        enabled: true,
        configured: true,
      });
      expect(saved.policy.columns).toEqual(expect.arrayContaining([
        expect.objectContaining({ column_name: 'title', allowed: true }),
      ]));
    } finally {
      if (!page.isClosed()) {
        await dropTempDataset(page, datasetName);
      }
    }
  });

  test('opens the shared field-order and visibility editor from dataset tools', async ({ page }) => {
    // A required input without a default is locked; generated id is exempt.
    const datasetName = buildTempDatasetName('e2e_field_view_lock');
    await createTempDataset(page, {
      datasetName,
      columns: { id: 'SERIAL', title: 'TEXT NOT NULL' },
      seedRows: [{ title: 'required-field-row' }],
    });

    try {
      await openTempDataset(page, datasetName, 'table');
      // Reveal for this page only; a heading click would save the installation-wide section layout.
      const tools = await revealActiveFilterbarSection(page, 'tools');
      const editorButton = tools.locator('[data-testid="btn-edit-fields-view"]');
      await expect(editorButton).toBeVisible({ timeout: 10000 });
      await editorButton.click();

      const editor = page.locator('[data-testid="field-view-editor"]');
      await expect(editor).toBeVisible({ timeout: 10000 });
      const rows = editor.locator('.field-view-editor__row');
      await expect(rows.first()).toBeVisible();
      const primaryKeyRow = rows.filter({
        has: page.locator('.field-view-editor__field-name', { hasText: /^id$/i }),
      });
      await expect(primaryKeyRow).toBeVisible();
      await expect(primaryKeyRow.locator('[data-testid="field-view-hide-everywhere"]')).toBeEnabled();
      await expect(primaryKeyRow.locator('.field-view-editor__lock-reason')).toHaveCount(0);

      const requiredRow = rows.filter({
        has: page.locator('.field-view-editor__field-name', { hasText: /^title$/ }),
      });
      await expect(requiredRow).toBeVisible();
      const requiredVisibility = requiredRow.locator('[data-testid="field-view-hide-everywhere"]');
      await expect(requiredVisibility).toBeDisabled();
      await expect(requiredVisibility).not.toBeChecked();
      await expect(requiredRow.locator('.field-view-editor__lock-reason'))
        .toHaveText('Required when adding content');
    } finally {
      if (!page.isClosed()) {
        await dropTempDataset(page, datasetName);
      }
    }
  });

  test('keeps borderless database-tree dataset buttons visually distinct in the light theme', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('theme', 'light'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);

    const navigationTree = await openAdminNavigationTree(page);
    const datasetButton = await revealFirstNavigationDatasetButton(navigationTree);
    await expect(datasetButton).toBeVisible({ timeout: 10000 });
    const appearance = await datasetButton.evaluate((button) => {
      const style = getComputedStyle(button);
      const parentStyle = button.parentElement ? getComputedStyle(button.parentElement) : null;
      return {
        background: style.backgroundColor,
        parentBackground: parentStyle?.backgroundColor ?? '',
        color: style.color,
        borderTopWidth: style.borderTopWidth,
        borderTopStyle: style.borderTopStyle,
      };
    });

    expect(appearance.background).not.toBe(appearance.parentBackground);
    expect(appearance.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(appearance.color).not.toBe(appearance.background);
    expect(appearance.color).not.toBe('rgba(0, 0, 0, 0)');
    expect(appearance.borderTopWidth).toBe('0px');
    expect(appearance.borderTopStyle).toBe('none');
  });
});
