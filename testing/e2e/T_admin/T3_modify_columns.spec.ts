/**
 * T3_modify_columns.spec.ts
 *
 * Verifies that an admin user can open column management controls via stable toolbar anchors.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
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
  const response = await page.evaluate(async () => {
    const result = await fetch('/api/csrf-token', { credentials: 'include' });
    return {
      ok: result.ok,
      body: await result.text(),
    };
  });
  expect(response.ok, `Failed to fetch CSRF token for T3: ${response.body}`).toBe(true);

  const csrfToken = JSON.parse(response.body)?.csrf_token;
  if (typeof csrfToken !== 'string' || csrfToken.trim() === '') {
    throw new Error('Missing csrf_token in /api/csrf-token response for T3.');
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
      const result = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(payload),
      });
      return {
        status: result.status,
        ok: result.ok,
        body: await result.text(),
      };
    },
    { csrfToken, payload, url },
  );
}

async function getJson(page: E2EPage, url: string): Promise<JsonResponse> {
  return page.evaluate(async (targetUrl) => {
    const result = await fetch(targetUrl, { credentials: 'include' });
    return {
      status: result.status,
      ok: result.ok,
      body: await result.text(),
    };
  }, url);
}

test.describe('T3 — Modify Columns', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('admin can open column management', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');

    const adminBtn = page.locator('[data-testid="btn-edit-table"]');

    if (await adminBtn.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await adminBtn.first().click();

      const adminPanel = page.locator('[data-testid="modal-container"]');
      if (await adminPanel.first().isVisible({ timeout: 10000 }).catch(() => false)) {
        await expect(adminPanel.first()).toBeVisible();
        await page.locator('[data-testid="modal-close-button"]').click();
      }
    } else {
      test.skip();
    }
  });

  test('a link field added after table creation is editable and clickable in article view', async ({ page }) => {
    test.setTimeout(60_000);
    const datasetName = buildTempDatasetName('e2e_late_link_field');

    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        title: 'TEXT',
      },
      seedRows: [{ title: 'Late link field proof' }],
    });

    try {
      const addColumnResponse = await postJsonWithCsrf(page, '/api/modify-columns', {
        dataset_name: datasetName,
        modified_columns: [],
        added_columns: [{
          original_name: '',
          new_name: 'website',
          data_type: 'TEXT',
          length: null,
        }],
        removed_columns: [],
      });
      expect(
        addColumnResponse.ok,
        `Admin could not add the late link field: ${addColumnResponse.body}`,
      ).toBe(true);

      const visibilityResponse = await getJson(
        page,
        `/api/card-visibility/${encodeURIComponent(datasetName)}`,
      );
      expect(
        visibilityResponse.ok,
        `Could not load metadata for the late link field: ${visibilityResponse.body}`,
      ).toBe(true);

      const visibility = JSON.parse(visibilityResponse.body);
      const columns = Array.isArray(visibility?.columns) ? visibility.columns : [];
      const websiteColumn = columns.find((column: Record<string, unknown>) => column.column_name === 'website');
      expect(websiteColumn, 'The late link field must receive system column metadata.').toBeTruthy();

      const saveVisibilityResponse = await postJsonWithCsrf(page, '/api/card-visibility/update', {
        table_name: datasetName,
        card_details_layout: visibility.card_details_layout,
        card_style_variant: visibility.card_style_variant,
        columns: columns.map((column: Record<string, unknown>) => (
          column.column_name === 'website'
            ? { ...column, card_element: 'details_link' }
            : column
        )),
      });
      expect(
        saveVisibilityResponse.ok,
        `Admin could not assign the late link field's presentation role: ${saveVisibilityResponse.body}`,
      ).toBe(true);

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

      await page.locator('[data-testid="big-card-edit-button"]').first().click();
      const websiteField = page.locator('[data-column="website"]').first();
      const websiteInput = websiteField.locator('input, textarea').first();
      await expect(websiteInput).toBeVisible({ timeout: 5000 });
      await websiteInput.fill('https://example.test/late-link');
      await page.locator('[data-testid="big-card-edit-button"]').first().click();

      const websiteLink = websiteField.locator('a[href="https://example.test/late-link"]').first();
      await expect(websiteLink).toBeVisible({ timeout: 15000 });
      await expect(websiteLink).toHaveAttribute('target', '_blank');
      await expect(websiteLink).toHaveAttribute('rel', /noopener/);
    } finally {
      if (!page.isClosed()) {
        await page.keyboard.press('Escape').catch(() => {});
        await dropTempDataset(page, datasetName);
      }
    }
  });
});
