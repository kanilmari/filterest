/**
 * U2_import_csv.spec.ts
 * Verifies that CSV import restores the data from the same server-side export.
 * Bridges authenticated devtools endpoints and an owned temporary dataset/CSV.
 * Exists to prove a real round trip while cleaning files even after failures.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { withTableCSVArtifact } from '../helpers/table-csv-artifact';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
} from '../helpers/temp-dataset';

async function callTextEndpoint(
  page: import('@playwright/test').Page,
  url: string,
  method: 'GET' | 'POST' = 'GET',
  payload?: Record<string, unknown>,
) {
  return page.evaluate(async ({ targetUrl, requestMethod, payload }) => {
    // Importing writes rows, so it answers only a POST. The token comes from
    // the application's own endpoint rather than a second copy of the rule.
    let csrfToken = '';
    if (requestMethod !== 'GET') {
      const tokenResponse = await fetch('/api/csrf-token', { credentials: 'include' });
      if (tokenResponse.ok) {
        csrfToken = (await tokenResponse.json()).csrf_token || '';
      }
    }
    const response = await fetch(targetUrl, {
      method: requestMethod,
      credentials: 'include',
      headers: {
        ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    return {
      status: response.status,
      ok: response.ok,
      body: await response.text(),
    };
  }, { targetUrl: url, requestMethod: method, payload });
}

async function readDatasetRows(page: import('@playwright/test').Page, datasetName: string) {
  const response = await callTextEndpoint(
    page, `/api/get-results?dataset=${encodeURIComponent(datasetName)}`,
  );
  expect(response.status, response.body).toBe(200);
  const payload = JSON.parse(response.body);
  expect(Array.isArray(payload.data), response.body).toBe(true);
  return (payload.data as Array<{ id: number; title: string }>)
    .map(({ id, title }) => ({ id, title }))
    .sort((first, second) => first.id - second.id);
}

test.describe('U2 — Import CSV', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('CSV import endpoint replays a previously exported dataset file', async ({ page }) => {
    const datasetName = buildTempDatasetName('e2e_import_csv');
    const seedRows = [
      { title: 'Import me again' },
      { title: 'CSV, with "quotes"\nand ää' },
    ];

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        title: 'TEXT',
      },
      seedRows,
    });

    try {
      await withTableCSVArtifact(datasetName, async (resolveExportPath, readExportCSV) => {
        const originalRows = await readDatasetRows(page, datasetName);
        expect(originalRows.map(({ title }) => ({ title }))).toEqual(seedRows);

        const exportResponse = await callTextEndpoint(
          page,
          `/api/export-table-csv?dataset=${encodeURIComponent(datasetName)}`,
        );
        expect(exportResponse.status, exportResponse.body).toBe(200);
        const csvPath = resolveExportPath(exportResponse.body);
        const exportedCSV = readExportCSV();
        expect(exportedCSV.toString('utf8')).toContain(seedRows[0].title);

        // Change the live row so a successful but ineffective import cannot pass.
        const changedTitle = 'Changed after export';
        const updateResponse = await callTextEndpoint(
          page, `/api/update-row?dataset=${encodeURIComponent(datasetName)}`, 'POST',
          { id: originalRows[0].id, column: 'title', value: changedTitle },
        );
        expect(updateResponse.status, updateResponse.body).toBe(200);
        expect(await readDatasetRows(page, datasetName)).toEqual([
          { ...originalRows[0], title: changedTitle }, originalRows[1],
        ]);

        const importResponse = await callTextEndpoint(
          page,
          `/api/import-table-csv?dataset=${encodeURIComponent(datasetName)}`,
          'POST',
        );

        expect(importResponse.status, importResponse.body).toBe(200);
        expect(importResponse.body).toContain(`imported ${datasetName} from ${csvPath};`);
        expect(await readDatasetRows(page, datasetName)).toEqual(originalRows);
        expect(readExportCSV()).toEqual(exportedCSV);
      });
    } finally {
      await dropTempDataset(page, datasetName);
    }
  });
});
