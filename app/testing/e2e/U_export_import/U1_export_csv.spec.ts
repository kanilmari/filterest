/**
 * U1_export_csv.spec.ts
 * Verifies that the devtools CSV export endpoint writes the reported table dump.
 * Bridges authenticated export replies with the shared owned-file lifecycle.
 * Exists to check the real artifact and clean only this spec's newly exported file.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { withTableCSVArtifact } from '../helpers/table-csv-artifact';
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
      // The helper's finally removes the identified CSV before dataset teardown.
      await withTableCSVArtifact(datasetName, async (resolveExportPath, readExportCSV) => {
        const response = await callTextEndpoint(
          page,
          `/api/export-table-csv?dataset=${encodeURIComponent(datasetName)}`,
        );

        expect(response.status, response.body).toBe(200);
        resolveExportPath(response.body);
        expect(readExportCSV().toString('utf8')).toContain('Export me');
      });
    } finally {
      await dropTempDataset(page, datasetName);
    }
  });
});
