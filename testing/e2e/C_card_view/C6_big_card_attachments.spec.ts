/**
 * C6_big_card_attachments.spec.ts
 *
 * Verifies the first end-user shared-asset UX in the big card view:
 * image upload/delete plus attachment upload/list/download/delete.
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

  expect(csrfResponse.ok, `Failed to fetch CSRF token for big-card attachment test: ${csrfResponse.body}`).toBe(true);

  const csrfData = JSON.parse(csrfResponse.body);
  const csrfToken = csrfData?.csrf_token;
  if (typeof csrfToken !== 'string' || csrfToken.trim() === '') {
    throw new Error('Missing csrf_token in /api/csrf-token response for big-card attachment test.');
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

test.describe('C6 — Big Card Attachments', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('big card supports shared image + attachment assets on the canonical asset-linking path', async ({ page }) => {
    test.setTimeout(60_000);
    const datasetName = buildTempDatasetName('e2e_card_attach');

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        title: 'TEXT',
        description: 'TEXT',
      },
      seedRows: [
        {
          title: 'Attachment test row',
          description: 'Seed row for the big-card attachment smoke test.',
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

      const galleryInput = page.locator('.big_card_image_gallery input[type="file"]').first();
      await galleryInput.setInputFiles({
        name: 'cover.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
      });
      await expect(page.locator('[data-testid="big-card-image-thumb-0"]').first()).toHaveAttribute('src', /\/storage\//, { timeout: 15000 });

      const section = page.locator('[data-testid="big-card-attachments"]').first();
      await expect(section).toBeVisible({ timeout: 10000 });

      const input = page.locator('[data-testid="big-card-attachments-input"]').first();
      await input.setInputFiles([
        {
          name: 'contract.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4\nAttachment smoke test\n'),
        },
        {
          name: 'specification.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
        },
      ]);

      const item = page.locator('[data-testid="big-card-attachment-item-0"]').first();
      await expect(item).toBeVisible({ timeout: 15000 });
      await expect(page.locator('[data-testid="big-card-attachment-open-0"]').first()).toContainText('contract.pdf');
      await expect(page.locator('[data-testid="big-card-attachment-item-1"]').first()).toContainText('specification.docx', { timeout: 15000 });
      await expect(page.locator('[data-testid="big-card-attachment-preview-0"]').first()).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-testid="big-card-attachment-preview-1"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="big-card-pdf-thumbnail-0"]').first()).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-testid="big-card-pdf-thumbnail-frame-0"]').first()).toHaveAttribute('src', /\/storage\/.*#toolbar=0.*page=1/, { timeout: 10000 });

      const downloadLink = page.locator('[data-testid="big-card-attachment-download-0"]').first();
      await expect(downloadLink).toHaveAttribute('href', /\/storage\//);

      await page.locator('[data-testid="big-card-pdf-thumbnail-0"]').first().click();
      const previewPanel = page.locator('[data-testid="big-card-pdf-preview"]').first();
      await expect(previewPanel).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-testid="big-card-pdf-preview-frame"]').first()).toHaveAttribute('src', /\/storage\/.*#toolbar=0/, { timeout: 10000 });
      await expect(page.locator('[data-testid="big-card-pdf-preview-open"]').first()).toHaveAttribute('href', /\/storage\//);
      await expect(page.locator('[data-testid="big-card-pdf-preview-download"]').first()).toHaveAttribute('download', 'contract.pdf');
      await page.locator('[data-testid="big-card-pdf-preview-close"]').first().click();
      await expect(previewPanel).toHaveAttribute('hidden', '', { timeout: 10000 });

      await page.locator('[data-testid="big-card-attachment-edit-0"]').first().click();
      await page.locator('[data-testid="big-card-attachment-title-input-0"]').first().fill('Customer contract PDF');
      await page.locator('[data-testid="big-card-attachment-description-input-0"]').first().fill('Final signed PDF for the smoke test.');
      await page.locator('[data-testid="big-card-attachment-save-0"]').first().click();
      await expect(section).toContainText('Customer contract PDF', { timeout: 15000 });
      await expect(section).toContainText('Final signed PDF for the smoke test.', { timeout: 15000 });
      await expect(section).toContainText('contract.pdf', { timeout: 15000 });
      await expect(page.locator('[data-testid="big-card-attachment-download-0"]').first()).toHaveAttribute('download', 'Customer contract PDF.pdf');
      await page.locator('[data-testid="big-card-pdf-thumbnail-0"]').first().click();
      await expect(page.locator('[data-testid="big-card-pdf-preview-download"]').first()).toHaveAttribute('download', 'Customer contract PDF.pdf');
      await page.locator('[data-testid="big-card-pdf-preview-close"]').first().click();

      await page.locator('[data-testid="big-card-image-delete-0"]').first().click();
      await confirmModal(page);

      await expect(page.locator('[data-testid^="big-card-image-thumb-"]')).toHaveCount(0, { timeout: 15000 });
      await expect(page.locator('.big_card_thumbnail_row .image_upload_placeholder.small').first()).toBeVisible({ timeout: 15000 });
      await expect(page.locator('[data-testid="big-card-attachment-item-0"]').first()).toBeVisible({ timeout: 15000 });

      await page.locator('.big_card_attachment_item', { hasText: 'Customer contract PDF' }).first().locator('.big_card_attachment_delete').click();
      await confirmModal(page);

      await expect(section).not.toContainText('Customer contract PDF', { timeout: 15000 });
      await expect(section).toContainText('specification.docx', { timeout: 15000 });
      await expect(page.locator('.big_card_thumbnail_row .image_upload_placeholder.small').first()).toBeVisible({ timeout: 15000 });

      await page.locator('.big_card_attachment_item', { hasText: 'specification.docx' }).first().locator('.big_card_attachment_delete').click();
      await confirmModal(page);

      await expect(section).not.toContainText('specification.docx', { timeout: 15000 });
      await expect(page.locator('[data-testid="big-card-attachments-empty"]').first()).toBeVisible({ timeout: 15000 });
      await expect(page.locator('[data-testid="big-card-attachments-dropzone"]').first()).toContainText('Pudota liitteet', { timeout: 15000 });
      await expect(page.locator('.big_card_thumbnail_row .image_upload_placeholder.small').first()).toBeVisible({ timeout: 15000 });
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
