/**
 * C7_big_card_field_edit_preserves_assets.spec.ts
 *
 * Verifies that editing ordinary big-card fields does not break shared image
 * and attachment sections backed by the canonical `<parent>_assets` relation.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

type E2EPage = import('@playwright/test').Page;

type JsonResponse = {
  status: number;
  ok: boolean;
  body: string;
};

async function fetchCsrfToken(page: E2EPage): Promise<string> {
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

  expect(csrfResponse.ok, `Failed to fetch CSRF token for big-card field edit test: ${csrfResponse.body}`).toBe(true);

  const csrfData = JSON.parse(csrfResponse.body);
  const csrfToken = csrfData?.csrf_token;
  if (typeof csrfToken !== 'string' || csrfToken.trim() === '') {
    throw new Error('Missing csrf_token in /api/csrf-token response for big-card field edit test.');
  }

  return csrfToken;
}

async function postJsonWithCsrf(
  page: E2EPage,
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

test.describe('C7 — Big Card Field Edit Preserves Assets', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('editing a big-card field keeps shared image and attachment assets intact', async ({ page }) => {
    test.setTimeout(60_000);
    const datasetName = buildTempDatasetName('e2e_bigcard_edit_assets');

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        title: 'TEXT',
        description: 'TEXT',
      },
      seedRows: [
        {
          title: 'Original asset row',
          description: 'Seed row for the big-card field edit + shared assets test.',
        },
      ],
    });

    try {
      const enableImageResponse = await postJsonWithCsrf(page, '/api/asset-linking/images/enable', {
        parent_table: datasetName,
        max_file_size_mb: 10,
      });
      expect(enableImageResponse.status, enableImageResponse.body).toBe(201);

      const enableAttachmentResponse = await postJsonWithCsrf(page, '/api/asset-linking/attachments/enable', {
        parent_table: datasetName,
        max_file_size_mb: 25,
      });
      expect(enableAttachmentResponse.status, enableAttachmentResponse.body).toBe(201);

      await page.evaluate((targetDatasetName) => {
        localStorage.setItem(`${targetDatasetName}_sorting_and_filtering_specs`, JSON.stringify({
          sort: { column: null, direction: null },
          filters: {},
          offset: 0,
          cardView: {
            collapsed: true,
            expandedId: 1,
          },
        }));
      }, datasetName);

      await openTempDataset(page, datasetName, 'card');
      await expect(page.locator('[data-testid="big-card-container"]').first()).toBeVisible({ timeout: 10000 });

      await page.locator('.big_card_image_gallery input[type="file"]').first().setInputFiles({
        name: 'hero.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
      });
      await expect(page.locator('[data-testid="big-card-image-thumb-0"]').first()).toHaveAttribute('src', /\/storage\//, { timeout: 15000 });

      await page.locator('[data-testid="big-card-attachments-input"]').first().setInputFiles({
        name: 'specification.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4\nBig-card field edit shared-assets regression test\n'),
      });
      await expect(page.locator('[data-testid="big-card-attachment-item-0"]').first()).toContainText('specification.pdf', { timeout: 15000 });

      await page.locator('[data-testid="big-card-edit-button"]').first().click();
      const titleField = page.locator('[data-column="title"]').first();
      const titleInput = titleField.locator('input, textarea').first();
      await expect(titleInput).toBeVisible({ timeout: 5000 });
      await titleInput.fill('Updated asset row');
      await page.locator('[data-testid="big-card-edit-button"]').first().click();

      await expect(titleField).toContainText('Updated asset row', { timeout: 15000 });
      await expect(page.locator('[data-testid="big-card-image-thumb-0"]').first()).toHaveAttribute('src', /\/storage\//, { timeout: 15000 });
      await expect(page.locator('[data-testid="big-card-attachment-item-0"]').first()).toContainText('specification.pdf', { timeout: 15000 });
      await expect(page.locator('[data-testid="big-card-attachments-count"]').first()).toHaveText('1', { timeout: 15000 });
      await expect(page.locator('[data-testid="big-card-attachment-preview-0"]').first()).toBeVisible({ timeout: 15000 });

      const dynamicChildren = await postJsonWithCsrf(page, `/api/fetch-dynamic-children?dataset=${encodeURIComponent(datasetName)}`, {
        parent_dataset: datasetName,
        parent_pk_value: '1',
      });
      expect(dynamicChildren.status, dynamicChildren.body).toBe(200);

      const dynamicPayload = JSON.parse(dynamicChildren.body);
      const assetsChild = Array.isArray(dynamicPayload?.child_tables)
        ? dynamicPayload.child_tables.find((child: Record<string, unknown>) => child.dataset === `${datasetName}_assets`)
        : null;

      expect(assetsChild).toBeTruthy();
      expect(Array.isArray(assetsChild.rows)).toBe(true);

      const assetKinds = assetsChild.rows.map((row: Record<string, unknown>) => row.asset_kind).sort();
      expect(assetKinds).toEqual(['image', 'pdf']);
    } finally {
      if (!page.isClosed()) {
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
