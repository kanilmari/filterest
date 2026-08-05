/**
 * T10_asset_linking_admin.spec.ts
 *
 * E2E smoke test for the shared asset_linking admin tab.
 * Verifies image and attachment capability rows can disable, re-enable, and remove on a temp dataset.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { expandAdminTreeFolder, openAdminTreeButton } from '../helpers/admin-navigation';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
} from '../helpers/temp-dataset';

type E2EPage = import('@playwright/test').Page;

type JsonResponse = {
  status: number;
  ok: boolean;
  body: string;
};

async function ensureNavbarVisible(page: E2EPage): Promise<void> {
  const opened = await page.evaluate(() => {
    const navbar = document.getElementById('navbar');
    if (!navbar) {
      return false;
    }
    if (!navbar.classList.contains('collapsed')) {
      return true;
    }

    const showMenuButton = document.getElementById('showMenuButton') as HTMLButtonElement | null;
    if (!showMenuButton) {
      return false;
    }

    showMenuButton.click();
    return true;
  });

  if (!opened) {
    throw new Error('Could not open the navbar before navigating to asset linking.');
  }

  await page.waitForFunction(() => {
    const navbar = document.getElementById('navbar');
    return navbar instanceof HTMLElement && !navbar.classList.contains('collapsed');
  }, { timeout: 5000 });
}

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

  expect(csrfResponse.ok, `Failed to fetch CSRF token for asset-linking admin test: ${csrfResponse.body}`).toBe(true);

  const csrfData = JSON.parse(csrfResponse.body);
  const csrfToken = csrfData?.csrf_token;
  if (typeof csrfToken !== 'string' || csrfToken.trim() === '') {
    throw new Error('Missing csrf_token in /api/csrf-token response for asset-linking admin test.');
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

async function openAssetLinkingAdminView(page: E2EPage): Promise<void> {
  await ensureNavbarVisible(page);
  await expandAdminTreeFolder(page, 'table_tools');
  await openAdminTreeButton(page, 'asset_linking');
  await expect(page.locator('#asset_linking_container')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-testid="asset-linking-root"]')).toBeVisible({ timeout: 10000 });
}

async function clickVisibleTestId(page: E2EPage, testId: string): Promise<void> {
  const clicked = await page.evaluate((targetTestId) => {
    const button = document.querySelector(`[data-testid="${targetTestId}"]`) as HTMLElement | null;
    if (!button) {
      return false;
    }

    button.scrollIntoView({ block: 'center', inline: 'center' });
    button.click();
    return true;
  }, testId);

  if (!clicked) {
    throw new Error(`Could not click data-testid="${testId}"`);
  }
}

async function confirmModal(page: E2EPage): Promise<void> {
  const confirmButton = page.locator('[data-testid="confirm-modal-confirm-button"]').first();
  await expect(confirmButton).toBeVisible({ timeout: 5000 });
  await confirmButton.click();
}

test.describe('T10 — Asset Linking Admin', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('asset_linking admin tab renders image + attachment capability rows and actions', async ({ page }) => {
    const datasetName = buildTempDatasetName('e2e_asset_linking');

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        title: 'TEXT',
      },
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

      await openAssetLinkingAdminView(page);

      await expect(page.locator('[data-testid="asset-linking-image-section"]')).toBeVisible();
      await expect(page.locator('[data-testid="asset-linking-attachment-section"]')).toBeVisible();
      await expect(page.locator('[data-testid="asset-linking-image-row-' + datasetName + '"]')).toBeVisible();
      await expect(page.locator('[data-testid="asset-linking-attachment-row-' + datasetName + '"]')).toBeVisible();

      const imageStatus = page.locator(`[data-testid="asset-linking-image-status-${datasetName}"]`).first();
      await expect(imageStatus).toHaveAttribute('data-state', 'enabled');

      await clickVisibleTestId(page, `asset-linking-image-toggle-${datasetName}`);
      await expect(imageStatus).toHaveAttribute('data-state', 'disabled');

      await clickVisibleTestId(page, `asset-linking-image-toggle-${datasetName}`);
      await expect(imageStatus).toHaveAttribute('data-state', 'enabled');

      const attachmentStatus = page.locator(`[data-testid="asset-linking-attachment-status-${datasetName}"]`).first();
      await expect(attachmentStatus).toHaveAttribute('data-state', 'enabled');

      await clickVisibleTestId(page, `asset-linking-attachment-toggle-${datasetName}`);
      await expect(attachmentStatus).toHaveAttribute('data-state', 'disabled');

      await clickVisibleTestId(page, `asset-linking-attachment-toggle-${datasetName}`);
      await expect(attachmentStatus).toHaveAttribute('data-state', 'enabled');

      await clickVisibleTestId(page, `asset-linking-attachment-remove-${datasetName}`);
      await confirmModal(page);
      await expect(page.locator(`[data-testid="asset-linking-attachment-row-${datasetName}"]`)).toBeHidden({ timeout: 10000 });
      await expect(page.locator(`[data-testid="asset-linking-image-row-${datasetName}"]`)).toBeVisible();
      await clickVisibleTestId(page, `asset-linking-image-toggle-${datasetName}`);
      await expect(imageStatus).toHaveAttribute('data-state', 'disabled');
      await clickVisibleTestId(page, `asset-linking-image-toggle-${datasetName}`);
      await expect(imageStatus).toHaveAttribute('data-state', 'enabled');

      await clickVisibleTestId(page, `asset-linking-image-remove-${datasetName}`);
      await confirmModal(page);
      await expect(page.locator(`[data-testid="asset-linking-image-row-${datasetName}"]`)).toBeHidden({ timeout: 10000 });
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
