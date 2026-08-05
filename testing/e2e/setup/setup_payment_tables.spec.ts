/**
 * setup_payment_tables.spec.ts
 *
 * Creates payment gateway and styling tables via Easelect API.
 * Run explicitly: npx playwright test testing/e2e/setup/setup_payment_tables.spec.ts
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';

test.describe('Payment Gateway Table Setup', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  async function createTable(page: any, tableDef: any, tableName: string) {
    await login(page, credentials);

    const result = await page.evaluate(async (def: any) => {
      const response = await fetch('/api/create_dataset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(def),
        credentials: 'include',
      });
      return { status: response.status, body: await response.text() };
    }, tableDef);

    if (result.status === 201) {
      console.log(`Created ${tableName}`);
    } else if (result.body.includes('already exists') || result.body.includes('jo olemassa')) {
      console.log(`${tableName} already exists`);
    } else {
      expect(result.status).toBe(201);
    }
  }

  test('Create payments table via API', async ({ page }) => {
    await createTable(page, {
      dataset_name: 'payments',
      columns: {
        payment_token: 'TEXT',
        app_name: 'VARCHAR(100)',
        external_order_id: 'VARCHAR(255)',
        customer_email: 'VARCHAR(255)',
        amount_cents: 'INTEGER',
        currency: 'VARCHAR(3)',
        status: 'VARCHAR(20)',
        revolut_order_id: 'VARCHAR(255)',
        revolut_checkout_url: 'TEXT',
        metadata: 'JSONB',
        paid_at: 'TIMESTAMPTZ',
        webhook_received_at: 'TIMESTAMPTZ',
      },
      grant_users_read: false,
      grant_guests_read: false,
      prevent_deletion: true,
    }, 'payments');
  });

  test('Create styling_orders table via API', async ({ page }) => {
    await createTable(page, {
      dataset_name: 'styling_orders',
      columns: {
        order_token: 'TEXT',
        payment_id: 'INTEGER',
        customer_email: 'VARCHAR(255)',
        service_type: 'VARCHAR(20)',
        status: 'VARCHAR(20)',
        image_count: 'INTEGER',
        price_per_image_cents: 'INTEGER',
        total_price_cents: 'INTEGER',
        paid_at: 'TIMESTAMPTZ',
        completed_at: 'TIMESTAMPTZ',
        download_token: 'TEXT',
        download_expires_at: 'TIMESTAMPTZ',
      },
      foreign_keys: [{ referencing_column: 'payment_id', referenced_dataset: 'payments', referenced_column: 'id' }],
      grant_users_read: false,
      grant_guests_read: false,
      prevent_deletion: true,
    }, 'styling_orders');
  });

  test('Create styling_order_assets table via API', async ({ page }) => {
    await createTable(page, {
      dataset_name: 'styling_order_assets',
      columns: {
        order_id: 'INTEGER',
        original_filename: 'VARCHAR(255)',
        original_path: 'VARCHAR(500)',
        preview_path: 'VARCHAR(500)',
        result_path: 'VARCHAR(500)',
        status: 'VARCHAR(20)',
      },
      foreign_keys: [{ referencing_column: 'order_id', referenced_dataset: 'styling_orders', referenced_column: 'id' }],
      grant_users_read: false,
      grant_guests_read: false,
      prevent_deletion: true,
    }, 'styling_order_assets');
  });

  test('Create styling_tasks table via API', async ({ page }) => {
    await createTable(page, {
      dataset_name: 'styling_tasks',
      columns: {
        order_id: 'INTEGER',
        assigned_to: 'INTEGER',
        status: 'VARCHAR(20)',
        notes: 'TEXT',
        started_at: 'TIMESTAMPTZ',
        completed_at: 'TIMESTAMPTZ',
      },
      foreign_keys: [{ referencing_column: 'order_id', referenced_dataset: 'styling_orders', referenced_column: 'id' }],
      grant_users_read: false,
      grant_guests_read: false,
      prevent_deletion: true,
    }, 'styling_tasks');
  });
});
