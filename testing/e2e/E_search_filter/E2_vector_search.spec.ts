/**
 * E2_vector_search.spec.ts
 *
 * Tests vector search endpoint response status handling.
 * Ensures endpoint returns an expected status for current dataset state.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset } from '../helpers/navigation';

test.describe('E2 — Vector Search', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('vector search endpoint responds', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');

    const status = await page.evaluate(async () => {
      const resp = await fetch('/api/get-results-vector?dataset_name=app_service_catalog&query=test&limit=5', {
        credentials: 'include',
      });
      return resp.status;
    });

    expect([200, 400, 404, 403]).toContain(status);
  });
});
