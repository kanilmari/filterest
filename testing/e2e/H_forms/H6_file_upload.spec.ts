/**
 * H6_file_upload.spec.ts
 *
 * Verifies file input interaction in add-row form.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { goToAddRowSection, openAddRowForm } from '../helpers/navigation';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

type JsonResponse = {
  status: number;
  ok: boolean;
  body: string;
};

async function fetchCsrfToken(page: import('@playwright/test').Page): Promise<string> {
  const csrfResponse = await page.evaluate(async () => {
    const response = await fetch('/api/csrf-token', {
      credentials: 'include',
    });
    return {
      status: response.status,
      ok: response.ok,
      body: await response.text(),
    };
  });

  expect(csrfResponse.ok, `Failed to fetch CSRF token for H6 file-upload test: ${csrfResponse.body}`).toBe(true);

  const csrfData = JSON.parse(csrfResponse.body);
  const csrfToken = csrfData?.csrf_token;
  if (typeof csrfToken !== 'string' || csrfToken.trim() === '') {
    throw new Error('Missing csrf_token in /api/csrf-token response for H6 file-upload test.');
  }

  return csrfToken;
}

async function postJsonWithCsrf(
  page: import('@playwright/test').Page,
  url: string,
  payload: Record<string, unknown>,
): Promise<JsonResponse> {
  const csrfToken = await fetchCsrfToken(page);
  return page.evaluate(
    async ({ csrfToken, payload, url }) => {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(payload),
      });
      return {
        status: response.status,
        ok: response.ok,
        body: await response.text(),
      };
    },
    { csrfToken, payload, url },
  );
}

async function fetchDatasetRows(
  page: import('@playwright/test').Page,
  datasetName: string,
): Promise<Array<Record<string, unknown>>> {
  const response = await page.evaluate(async (targetDataset) => {
    const result = await fetch(`/api/get-results?dataset=${encodeURIComponent(targetDataset)}`, {
      credentials: 'include',
    });
    return {
      status: result.status,
      ok: result.ok,
      body: await result.text(),
    };
  }, datasetName);

  expect(response.ok, `Failed to fetch dataset rows for "${datasetName}": ${response.body}`).toBe(true);
  const parsed = JSON.parse(response.body);
  return Array.isArray(parsed?.data) ? parsed.data : [];
}

async function fetchDynamicChildren(
  page: import('@playwright/test').Page,
  datasetName: string,
  rowId: number | string,
): Promise<Array<Record<string, unknown>>> {
  const csrfToken = await fetchCsrfToken(page);
  const response = await page.evaluate(
    async ({ csrfToken, datasetName, rowId }) => {
      const result = await fetch(`/api/fetch-dynamic-children?dataset=${encodeURIComponent(datasetName)}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify({
          parent_dataset: datasetName,
          parent_pk_value: String(rowId),
        }),
      });
      return {
        status: result.status,
        ok: result.ok,
        body: await result.text(),
      };
    },
    { csrfToken, datasetName, rowId },
  );

  expect(response.ok, `Failed to fetch dynamic children for "${datasetName}" row ${rowId}: ${response.body}`).toBe(true);
  const parsed = JSON.parse(response.body);
  return Array.isArray(parsed?.child_tables) ? parsed.child_tables : [];
}

test.describe('H6 — File Upload', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('add-row form accepts shared image + attachment uploads on the canonical asset path', async ({ page }) => {
    test.setTimeout(90_000);
    const datasetName = buildTempDatasetName('e2e_file_upload');

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        title: 'TEXT',
        description: 'TEXT',
      },
    });

    try {
      const enableImageResponse = await postJsonWithCsrf(page, '/api/asset-linking/images/enable', {
        parent_table: datasetName,
        max_file_size_mb: 10,
      });
      expect(enableImageResponse.status, `Failed to enable image linking for "${datasetName}": ${enableImageResponse.body}`).toBe(201);

      const enableAttachmentResponse = await postJsonWithCsrf(page, '/api/asset-linking/attachments/enable', {
        parent_table: datasetName,
        max_file_size_mb: 25,
      });
      expect(enableAttachmentResponse.status, `Failed to enable attachment linking for "${datasetName}": ${enableAttachmentResponse.body}`).toBe(201);

      await openTempDataset(page, datasetName, 'table');

      await openAddRowForm(page);

      const form = page.locator('[data-testid="add-row-form"]');
      await expect(form.first()).toBeVisible({ timeout: 10000 });

      await form.locator('[data-testid="form-input-title"]').first().fill('Shared asset upload row');
      await form.locator('[data-testid="form-input-description"]').first().fill('Created through the add-row shared asset test.');

      await goToAddRowSection(page, 'row_article_section_images');
      const imageInput = form.locator('[data-testid="child-file-upload-image"]').first();
      await expect(imageInput).toBeVisible({ timeout: 10000 });

      await imageInput.setInputFiles({
        name: 'cover.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
      });

      await goToAddRowSection(page, 'row_article_section_attachments');
      const attachmentInput = form.locator('[data-testid="child-file-upload-attachment"]').first();
      await expect(attachmentInput).toBeVisible({ timeout: 10000 });
      await attachmentInput.setInputFiles([
        {
          name: 'test-file.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('test content'),
        },
        {
          name: 'offer.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\nShared attachment test\n'),
        },
      ]);

      await expect(form.locator('[data-testid="child-file-selected-attachment-0"]')).toContainText('test-file.txt');
      await expect(form.locator('[data-testid="child-file-selected-attachment-1"]')).toContainText('offer.pdf');

      await form.locator('[data-testid="btn-add-row-submit"]').first().click();
      await expect.poll(async () => {
        const rows = await fetchDatasetRows(page, datasetName);
        return rows.some((row) => row.title === 'Shared asset upload row');
      }, { timeout: 30000 }).toBe(true);

      const rows = await fetchDatasetRows(page, datasetName);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const createdRow = rows.find((row) => row.title === 'Shared asset upload row');
      expect(createdRow).toBeTruthy();

      const childTables = await fetchDynamicChildren(page, datasetName, createdRow?.id as number | string);
      const assetChild = childTables.find((child) => child.relation_kind === 'shared_asset');
      expect(assetChild).toBeTruthy();

      const assetRows = Array.isArray(assetChild?.rows) ? assetChild.rows : [];
      expect(assetRows.some((row) => row.asset_kind === 'image' && typeof row.filename === 'string')).toBe(true);
      expect(assetRows.some((row) => row.asset_kind === 'document' && row.original_name === 'test-file.txt')).toBe(true);
      expect(assetRows.some((row) => row.asset_kind === 'pdf' && row.original_name === 'offer.pdf')).toBe(true);
    } finally {
      if (!page.isClosed()) {
        await page.keyboard.press('Escape').catch(() => {});
        await postJsonWithCsrf(page, '/api/asset-linking/attachments/remove', {
          parent_table: datasetName,
          confirm: true,
        }).catch(() => {});
        await postJsonWithCsrf(page, '/api/asset-linking/images/remove', {
          parent_table: datasetName,
          confirm: true,
        }).catch(() => {});
        await dropTempDataset(page, datasetName);
      }
    }
  });
});
