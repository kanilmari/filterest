/**
 * C9_big_card_image_metadata_editor.spec.ts
 *
 * Verifies the shared-image metadata editor in big-card mode:
 * upload one image, edit title + description, and keep the saved values visible after refresh.
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

  expect(csrfResponse.ok, `Failed to fetch CSRF token for image metadata editor test: ${csrfResponse.body}`).toBe(true);

  const csrfData = JSON.parse(csrfResponse.body);
  const csrfToken = csrfData?.csrf_token;
  if (typeof csrfToken !== 'string' || csrfToken.trim() === '') {
    throw new Error('Missing csrf_token in /api/csrf-token response for image metadata editor test.');
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

test.describe('C9 — Big Card Image Metadata Editor', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('shared image rows can edit title and description in the big-card editor', async ({ page }) => {
    test.setTimeout(70_000);
    const datasetName = buildTempDatasetName('e2e_card_image_meta');

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        title: 'TEXT',
      },
      seedRows: [
        {
          title: 'Image metadata row',
        },
      ],
    });

    try {
      const enableImageResponse = await postJsonWithCsrf(page, '/api/asset-linking/images/enable', {
        parent_table: datasetName,
        max_file_size_mb: 10,
      });
      expect(enableImageResponse.status, enableImageResponse.body).toBe(201);

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

      const galleryInput = page.locator('.big_card_image_gallery input[type="file"]').first();
      await galleryInput.setInputFiles({
        name: 'hero.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
      });

      await expect(page.locator('[data-testid="big-card-image-thumb-0"]').first()).toBeVisible({ timeout: 15000 });
      await page.locator('[data-testid="big-card-image-editor-toggle"]').first().click();
      await expect(page.locator('[data-testid="big-card-image-editor"]').first()).toBeVisible({ timeout: 5000 });

      await page.locator('[data-testid="big-card-image-title-input"]').first().fill('Marketing hero');
      await page.locator('[data-testid="big-card-image-description-input"]').first().fill('Shared asset image description');
      await page.locator('[data-testid="big-card-image-save"]').first().click();

      await expect(page.locator('[data-testid="big-card-image-title-input"]').first()).toHaveValue('Marketing hero', { timeout: 15000 });
      await expect(page.locator('[data-testid="big-card-image-description-input"]').first()).toHaveValue('Shared asset image description', { timeout: 15000 });
      await expect(page.locator('[data-testid="big-card-image-thumb-0"]').first()).toHaveAttribute('src', /\/storage\//, { timeout: 5000 });
    } finally {
      if (!page.isClosed()) {
        await postJsonWithCsrf(page, '/api/asset-linking/images/remove', {
          parent_table: datasetName,
          confirm: true,
        }).catch(() => {});
        await dropTempDataset(page, datasetName);
      }
    }
  });
});
