/**
 * U1_export_csv.spec.ts
 *
 * Verifies that the devtools CSV export endpoint writes a table dump file.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
} from '../helpers/temp-dataset';

async function callTextEndpoint(page: import('@playwright/test').Page, url: string) {
  return page.evaluate(async (targetUrl) => {
    const response = await fetch(targetUrl, {
      credentials: 'include',
    });
    return {
      status: response.status,
      ok: response.ok,
      body: await response.text(),
    };
  }, url);
}

test.describe('U1 — Export CSV', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('CSV export endpoint writes a dataset dump file', async ({ page }) => {
    const datasetName = buildTempDatasetName('e2e_export_csv');
    const expectedCsvPath = `tables_data/${datasetName}.csv`;

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        title: 'TEXT',
      },
      seedRows: [
        { title: 'Export me' },
      ],
    });

    try {
      const response = await callTextEndpoint(
        page,
        `/api/export-table-csv?dataset=${encodeURIComponent(datasetName)}`,
      );

      expect(response.status, response.body).toBe(200);
      expect(response.body).toContain(`exported ${datasetName}`);
      expect(response.body).toContain(expectedCsvPath);
      expect(fs.existsSync(expectedCsvPath)).toBe(true);
    } finally {
      await dropTempDataset(page, datasetName);
      if (fs.existsSync(expectedCsvPath)) {
        fs.unlinkSync(expectedCsvPath);
      }
    }
  });
});
