/**
 * D5_switch_to_ticket.spec.ts
 *
 * Tests switching to ticket view using the view selector button.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

test.describe('D5 — Switch to Ticket View', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await page.context().clearCookies();
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await login(page, credentials);
  });

  test('can switch to ticket view', async ({ page }) => {
    const datasetName = buildTempDatasetName('e2e_ticket_view');
    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        name: 'TEXT',
        type: 'TEXT',
        description: 'TEXT',
      },
      seedRows: [
        {
          name: 'Ticket row',
          type: 'issue',
          description: 'visible in ticket layout',
        },
      ],
    });

    try {
      await openTempDataset(page, datasetName, 'ticket');

      const ticketContainer = page.locator(`#${datasetName}_ticket_view_container .ticket-container`);
      await expect(ticketContainer).toBeVisible({ timeout: 10000 });
      await expect(ticketContainer.locator('.ticket').first()).toBeVisible({ timeout: 10000 });
      await expect(ticketContainer).toContainText('Ticket row');
      await expect(ticketContainer).toContainText('visible in ticket layout');
    } finally {
      await dropTempDataset(page, datasetName);
    }
  });
});
