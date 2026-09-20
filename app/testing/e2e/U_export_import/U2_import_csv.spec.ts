/**
 * U2_import_csv.spec.ts
 *
 * Verifies that the devtools CSV import endpoint replays an exported dataset dump.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
} from '../helpers/temp-dataset';

async function callTextEndpoint(
  page: import('@playwright/test').Page,
  url: string,
  method: 'GET' | 'POST' = 'GET',
) {
  return page.evaluate(async ({ targetUrl, requestMethod }) => {
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
      headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
    });
    return {
      status: response.status,
      ok: response.ok,
      body: await response.text(),
    };
  }, { targetUrl: url, requestMethod: method });
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
    const expectedCsvPath = `tables_data/${datasetName}.csv`;

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        title: 'TEXT',
      },
      seedRows: [
        { title: 'Import me again' },
      ],
    });

    try {
      const exportResponse = await callTextEndpoint(
        page,
        `/api/export-table-csv?dataset=${encodeURIComponent(datasetName)}`,
      );
      expect(exportResponse.status, exportResponse.body).toBe(200);
      expect(fs.existsSync(expectedCsvPath)).toBe(true);

      const importResponse = await callTextEndpoint(
        page,
        `/api/import-table-csv?dataset=${encodeURIComponent(datasetName)}`,
        'POST',
      );

      expect(importResponse.status, importResponse.body).toBe(200);
      expect(importResponse.body).toContain(`imported ${datasetName}`);
      expect(importResponse.body).toContain(expectedCsvPath);
    } finally {
      await dropTempDataset(page, datasetName);
      if (fs.existsSync(expectedCsvPath)) {
        fs.unlinkSync(expectedCsvPath);
      }
    }
  });
});
