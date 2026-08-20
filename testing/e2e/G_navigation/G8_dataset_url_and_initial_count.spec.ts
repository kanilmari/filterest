/**
 * G8_dataset_url_and_initial_count.spec.ts
 * Verifies dataset URL state excludes authentication-shell markers and renders the first count immediately.
 * Bridges real browser navigation, the dataset query store, and the initial result-count mirror.
 * Exists to prevent login handoffs and dormant infinite scroll from corrupting first-load dataset feedback.
 */

import { expect, test } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';

test.describe('G8 — Dataset URL and initial result count', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      class IdleIntersectionObserver {
        readonly root = null;
        readonly rootMargin = '0px';
        readonly thresholds: number[] = [];

        disconnect(): void {}
        observe(): void {}
        takeRecords(): IntersectionObserverEntry[] { return []; }
        unobserve(): void {}
      }

      window.IntersectionObserver = IdleIntersectionObserver as unknown as typeof IntersectionObserver;
    });
    await login(page, credentials);
  });

  test('auth-shell markers never become dataset filters while explicit search remains named', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');

    const params = await page.evaluate(async () => {
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}?login-entry=1&redirect=%2Fservice_catalog&search=service`,
      );
      const queryState = await import(
        '/frontend/core_components/navigation/nav_engine/query_params.js'
      );
      queryState.useUrlParams();
      return queryState.getParams('app_service_catalog');
    });

    expect(params).toEqual({ search: 'service' });
  });

  test('shows the first dataset result count without an infinite-scroll callback', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');

    const initialCount = page.locator(
      '#app_service_catalog_card_top_controls '
      + '[data-results-count-for="app_service_catalog"]',
    );
    await expect(initialCount).toBeVisible();
    await expect(initialCount).toHaveText(/^\d+\s+\S+/);
  });
});
