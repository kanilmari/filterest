// D6_table_cell_line_limit.spec.ts
// Proves the site-wide three-line table clamp and live administrator saves.
// Connects real temporary rows, table CSS and the revision-protected settings UI.
// Restores the site setting and theme and drops its dataset even after failure.
import { expect, test, type Page } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, dropTempDataset, fetchCsrfTokenForRequest, openTempDataset } from '../helpers/temp-dataset';
import { expandAdminTreeFolder, openAdminTreeButton } from '../helpers/admin-navigation';
import { navigateToDataset } from '../helpers/navigation';
import { revealActiveFilterbarSection } from '../helpers/filterbar';

const settingsURL = '/api/admin/site-presentation-settings';
async function readSettings(page: Page) {
  const response = await page.request.get(settingsURL);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function saveLines(page: Page, lines: number) {
  const headers = { 'X-CSRF-Token': await fetchCsrfTokenForRequest(page.request) };
  const current = await readSettings(page);
  const response = await page.request.post(settingsURL, { headers,
    data: { schema_version: 2, version: current.version, set: {}, table_cell_max_lines: lines } });
  expect(response.ok(), await response.text()).toBe(true);
  expect((await response.json()).table_cell_max_lines).toBe(lines);
}

// Run projects with --workers=1: the setting is shared across all datasets.
test.describe.configure({ mode: 'serial' });
for (const theme of ['light', 'dark'] as const) {
  test(`table cell limit: ${theme}, startup three and live save`, async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, loadCredentials());
    const original = await readSettings(page);
    const preferenceResponse = await page.request.get('/api/user-visual-preference');
    expect(preferenceResponse.ok()).toBe(true);
    const preference = await preferenceResponse.json();
    const datasetName = buildTempDatasetName('table_cell_lines');
    let created = false;
    try {
      await saveLines(page, 3);
      await createTempDataset(page, { datasetName, columns: { id: 'SERIAL', description: 'TEXT' },
        seedRows: [{ description: Array.from({ length: 15 }, (_, i) => `Long cell line ${i + 1}`).join('\n') }] });
      created = true;
      await openTempDataset(page, datasetName, 'table');
      const style = await revealActiveFilterbarSection(page, 'style');
      const toggle = style.getByTestId('filterbar-theme-toggle');
      for (let attempt = 0; attempt < 3; attempt++) {
        if (await toggle.getAttribute('data-aria-label-lang-key') === `theme_toggle_${theme}`) break;
        await toggle.focus(); await toggle.press('Space'); await expect(toggle).toBeEnabled();
      }
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
      const cell = page.locator(`#${datasetName}_table_view_container td[data-column="description"] .table_cell_content`);
      await expect(cell).toBeVisible();
      const measure = () => cell.evaluate(element => {
        const css = getComputedStyle(element);
        return { lines: Number(css.getPropertyValue('--table-cell-max-lines')), maxHeight: parseFloat(css.maxHeight),
          lineHeight: parseFloat(css.lineHeight), height: element.clientHeight, scrollHeight: element.scrollHeight, overflow: css.overflowY };
      });
      const initial = await measure();
      expect(initial.lines).toBe(3);
      expect(Math.abs(initial.maxHeight - initial.lineHeight * 3)).toBeLessThan(1);
      expect(Math.abs(initial.height - initial.maxHeight)).toBeLessThan(1);
      expect(initial.scrollHeight).toBeGreaterThan(initial.height);
      expect(initial.overflow).toBe('auto');
      await cell.evaluate(element => { element.scrollTop = 30; });
      expect(await cell.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      await page.evaluate(() => { (window as Window & { wo30Document?: string }).wo30Document = 'same document'; });
      await expandAdminTreeFolder(page, 'site_settings');
      await openAdminTreeButton(page, 'table_view_settings');
      const container = page.locator('#table_view_settings_container');
      const input = container.getByTestId('table-cell-max-lines-input');
      await expect(input).toHaveValue('3');
      await expect(container.locator('[data-lang-key="table_cell_max_lines_help"]')).toHaveText(/Longer cells scroll inside the cell\.|Pidemmät solut vierivät solun sisällä\./);
      await input.fill('5');
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === settingsURL && response.request().method() === 'POST');
      await container.getByTestId('table-cell-max-lines-save').click();
      const response = await saved; expect(response.ok(), await response.text()).toBe(true);
      await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--table-cell-max-lines'))).toBe('5');
      await navigateToDataset(page, datasetName);
      await expect(cell).toBeVisible();
      const changed = await measure();
      expect(changed.lines).toBe(5);
      expect(Math.abs(changed.maxHeight - changed.lineHeight * 5)).toBeLessThan(1);
      expect(changed.scrollHeight).toBeGreaterThan(changed.height);
      expect(await page.evaluate(() => (window as Window & { wo30Document?: string }).wo30Document)).toBe('same document');
      expect((await readSettings(page)).table_cell_max_lines).toBe(5);
    } finally {
      const results = await Promise.allSettled([
        saveLines(page, original.table_cell_max_lines),
        (async () => {
          const headers = { 'X-CSRF-Token': await fetchCsrfTokenForRequest(page.request) };
          const response = preference.configured
            ? await page.request.patch('/api/user-visual-preference', { headers, data: { theme_mode: preference.theme_mode } })
            : await page.request.delete('/api/user-visual-preference', { headers });
          expect(response.ok(), await response.text()).toBe(true);
        })(),
        ...(created ? [dropTempDataset(page, datasetName)] : []),
      ]);
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'WO30 cleanup failed');
    }
  });
}
