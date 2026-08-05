/**
 * delete_payments_table.spec.ts
 *
 * Cleanup: deletes the payments table via Easelect API.
 * Run explicitly: npx playwright test testing/e2e/setup/delete_payments_table.spec.ts
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';

test.describe('Delete Payments Table', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test('Delete payments table via API', async ({ page }) => {
    await login(page, credentials);

    // Verify payments table exists
    const datasetsResult = await page.evaluate(async () => {
      const response = await fetch('/api/datasets', { method: 'GET', credentials: 'include' });
      return { status: response.status, body: await response.text() };
    });

    const datasets = JSON.parse(datasetsResult.body);
    const paymentsExists = datasets.some((d: any) => d.name === 'payments');

    if (!paymentsExists) {
      console.log('payments table does not exist, nothing to delete');
      return;
    }

    // Delete
    const deleteResult = await page.evaluate(async () => {
      const response = await fetch('/api/drop-dataset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataset_name: 'payments' }),
        credentials: 'include',
      });
      return { status: response.status, statusText: response.statusText, body: await response.text() };
    });

    if (deleteResult.status === 200) {
      console.log('payments table deleted successfully');
    } else {
      throw new Error(`Delete failed with status ${deleteResult.status}: ${deleteResult.body}`);
    }

    // Verify deletion
    const verifyResult = await page.evaluate(async () => {
      const response = await fetch('/api/datasets', { method: 'GET', credentials: 'include' });
      return { status: response.status, body: await response.text() };
    });

    const updatedDatasets = JSON.parse(verifyResult.body);
    expect(updatedDatasets.some((d: any) => d.name === 'payments')).toBe(false);
  });
});
