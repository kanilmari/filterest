/**
 * S3_runtime_role_browsing.spec.ts
 * Verifies that a visitor, an ordinary signed-in user and an administrator can still list and
 * search a dataset after the runtime database roles lost their write rights (WL124, stage 1).
 * Bridges each role's real browser session with the database rights the server uses for it.
 * Exists because a missing database right shows only on the path that needs it, as a server error
 * or "permission denied", and each role reads through its own database role.
 */

import { expect, test, type Page } from '@playwright/test';
import { login, loadCredentials, loadUserCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { switchToView } from '../helpers/view-switch';

// The service catalog is readable by visitors on a standard installation.
const DATASET = 'app_service_catalog';

/** Collects every server error and every database permission refusal the page meets. */
function recordServerFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 500) failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  page.on('console', (message) => {
    if (/permission denied|42501/i.test(message.text())) failures.push(`console: ${message.text().slice(0, 200)}`);
  });
  return failures;
}

/** Lists the catalog, searches it and shows its cards, as every role does. */
async function listSearchAndOpenRow(page: Page): Promise<void> {
  await navigateToDataset(page, DATASET);
  await waitForDataLoaded(page, DATASET);
  const datasetPath = new URL(page.url()).pathname;
  expect(datasetPath).not.toBe('/');
  await page.goto(`${datasetPath}?search=a`, { waitUntil: 'domcontentloaded' });
  await waitForDataLoaded(page, DATASET);
  await switchToView(page, 'card');
  await page.waitForSelector('[data-testid="card-item"]', { timeout: 10000 });
  // Give the page's remaining requests a moment to answer before the failures are read. An
  // administrator keeps a live event stream open, so the network is never idle.
  await page.waitForTimeout(1500);
}

test.describe('S3 — Runtime roles still browse without write rights (WL124)', () => {
  test.describe('visitor', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('a visitor lists and searches without a server error', async ({ page }) => {
      const failures = recordServerFailures(page);
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await listSearchAndOpenRow(page);
      expect(failures).toEqual([]);
    });
  });

  test.describe('ordinary signed-in user', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('a signed-in user lists and searches without a server error', async ({ page }) => {
      const failures = recordServerFailures(page);
      await login(page, loadUserCredentials());
      await listSearchAndOpenRow(page);
      expect(failures).toEqual([]);
    });
  });

  test('an administrator lists and searches without a server error', async ({ page }) => {
    const failures = recordServerFailures(page);
    await login(page, loadCredentials());
    await listSearchAndOpenRow(page);
    expect(failures).toEqual([]);
  });
});
