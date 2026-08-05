/**
 * C8_big_card_primary_image_actions.spec.ts
 *
 * Verifies the shared-image UX polish in big-card mode:
 * right-click menu, make-default action, and fallback delete behavior.
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

  expect(csrfResponse.ok, `Failed to fetch CSRF token for big-card primary image test: ${csrfResponse.body}`).toBe(true);

  const csrfData = JSON.parse(csrfResponse.body);
  const csrfToken = csrfData?.csrf_token;
  if (typeof csrfToken !== 'string' || csrfToken.trim() === '') {
    throw new Error('Missing csrf_token in /api/csrf-token response for big-card primary image test.');
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

async function confirmModal(page: E2EPage): Promise<void> {
  const confirmButton = page.locator('[data-testid="confirm-modal-confirm-button"]').first();
  await expect(confirmButton).toBeVisible({ timeout: 5000 });
  await confirmButton.click();
}

test.describe('C8 — Big Card Primary Image Actions', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('big card right-click menu can set a new default image and delete it with fallback', async ({ page }) => {
    test.setTimeout(70_000);
    const datasetName = buildTempDatasetName('e2e_card_primary');

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        title: 'TEXT',
      },
      seedRows: [
        {
          title: 'Primary image test row',
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
        name: 'alpha.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
      });
      await expect(page.locator('[data-testid="big-card-image-thumb-0"]').first()).toBeVisible({ timeout: 15000 });

      await galleryInput.setInputFiles({
        name: 'beta.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
      });
      await expect(page.locator('[data-testid="big-card-image-thumb-1"]').first()).toBeVisible({ timeout: 15000 });

      const firstThumbSrc = await page.locator('[data-testid="big-card-image-thumb-0"]').first().getAttribute('src');
      const targetThumbSrc = await page.locator('[data-testid="big-card-image-thumb-1"]').first().getAttribute('src');
      expect(firstThumbSrc).toBeTruthy();
      expect(targetThumbSrc).toBeTruthy();
      expect(firstThumbSrc).not.toBe(targetThumbSrc);

      await page.locator('[data-testid="big-card-image-item-1"]').first().click({ button: 'right' });
      await expect(page.locator('[data-testid="big-card-image-menu-primary"]').first()).toBeVisible({ timeout: 5000 });
      await page.locator('[data-testid="big-card-image-menu-primary"]').first().click();

      await expect(page.locator('[data-testid="big-card-image-thumb-0"]').first()).toHaveAttribute('src', targetThumbSrc!, { timeout: 15000 });
      await expect(page.locator('[data-testid="big-card-image-primary-0"]').first()).toHaveClass(/is-primary/, { timeout: 15000 });
      await expect(page.locator('[data-testid="big-card-image-delete-0"]').first()).toBeVisible({ timeout: 5000 });

      await page.locator('[data-testid="big-card-image-item-0"]').first().click({ button: 'right' });
      await expect(page.locator('[data-testid="big-card-image-menu-delete"]').first()).toBeVisible({ timeout: 5000 });
      await page.locator('[data-testid="big-card-image-menu-delete"]').first().click();
      await confirmModal(page);

      await expect(page.locator('[data-testid^="big-card-image-thumb-"]')).toHaveCount(1, { timeout: 15000 });
      await expect(page.locator('[data-testid="big-card-image-thumb-0"]').first()).toHaveAttribute('src', firstThumbSrc!, { timeout: 15000 });
      await expect(page.locator('[data-testid="big-card-image-delete-0"]').first()).toBeVisible({ timeout: 15000 });
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
