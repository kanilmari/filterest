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
import { switchToView } from '../helpers/view-switch';

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

type GalleryState = {
  cardPicture: string;
  filenames: string[];
};

// Reads what the server reports for row 1: its shown card picture and its gallery's
// stored names in the gallery order.
async function readGalleryState(page: E2EPage, datasetName: string): Promise<GalleryState> {
  const response = await postJsonWithCsrf(page, `/api/fetch-dynamic-children?dataset=${encodeURIComponent(datasetName)}`, {
    parent_dataset: datasetName,
    parent_pk_value: '1',
  });
  expect(response.ok, `Failed to read the gallery of ${datasetName}: ${response.body}`).toBe(true);
  const body = JSON.parse(response.body);
  const relation = body?.gallery_relation;
  const gallery = (Array.isArray(body?.child_tables) ? body.child_tables : []).find(
    (childTable: { dataset?: string; column?: string }) =>
      childTable?.dataset === relation?.dataset && childTable?.column === relation?.column,
  );
  return {
    cardPicture: String(body?.card_picture ?? ''),
    filenames: (Array.isArray(gallery?.rows) ? gallery.rows : [])
      .map((row: { filename?: string }) => String(row?.filename || ''))
      .filter(Boolean),
  };
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

      // The article is a view of its own; switching to it opens the first result's article.
      await openTempDataset(page, datasetName, 'card');
      await switchToView(page, 'article_view');
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

      // The thumbnail is a presentation wrapper; the picture is the image inside it.
      const thumbImage = (index: number) => page.locator(`[data-testid="big-card-image-thumb-${index}"] img`).first();
      const firstThumbSrc = await thumbImage(0).getAttribute('src');
      const targetThumbSrc = await thumbImage(1).getAttribute('src');
      expect(firstThumbSrc).toBeTruthy();
      expect(targetThumbSrc).toBeTruthy();
      expect(firstThumbSrc).not.toBe(targetThumbSrc);

      // K120: an upload becomes the card picture only when the row has none, so the first
      // upload stays the card picture and the second goes after it.
      const afterUploads = await readGalleryState(page, datasetName);
      expect(afterUploads.filenames).toHaveLength(2);
      expect(afterUploads.cardPicture).toBe(afterUploads.filenames[0]);

      await page.locator('[data-testid="big-card-image-item-1"]').first().click({ button: 'right' });
      await expect(page.locator('[data-testid="big-card-image-menu-primary"]').first()).toBeVisible({ timeout: 5000 });
      await page.locator('[data-testid="big-card-image-menu-primary"]').first().click();

      await expect(thumbImage(0)).toHaveAttribute('src', targetThumbSrc!, { timeout: 15000 });
      await expect(page.locator('[data-testid="big-card-image-primary-0"]').first()).toHaveClass(/is-primary/, { timeout: 15000 });
      await expect(page.locator('[data-testid="big-card-image-delete-0"]').first()).toBeVisible({ timeout: 5000 });
      // The primary picture is the card picture.
      await expect.poll(async () => (await readGalleryState(page, datasetName)).cardPicture, { timeout: 15000 })
        .toBe(afterUploads.filenames[1]);

      await page.locator('[data-testid="big-card-image-item-0"]').first().click({ button: 'right' });
      await expect(page.locator('[data-testid="big-card-image-menu-delete"]').first()).toBeVisible({ timeout: 5000 });
      await page.locator('[data-testid="big-card-image-menu-delete"]').first().click();
      await confirmModal(page);

      await expect(page.locator('[data-testid^="big-card-image-thumb-"]')).toHaveCount(1, { timeout: 15000 });
      await expect(thumbImage(0)).toHaveAttribute('src', firstThumbSrc!, { timeout: 15000 });
      await expect(page.locator('[data-testid="big-card-image-delete-0"]').first()).toBeVisible({ timeout: 15000 });
      // Deleting the primary leaves the gallery's first picture on the card.
      await expect.poll(async () => (await readGalleryState(page, datasetName)).cardPicture, { timeout: 15000 })
        .toBe(afterUploads.filenames[0]);
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
