// capture_filterbar.spec.ts
// Captures filterbar expansion and show-more states for Visual Guardian review.
// Bridges a representative dataset surface and screenshot artifact capture.
// Exists so filterbar interaction visuals stay covered without broad E2E assertions.

import { test } from '@playwright/test';

import {
  loadVisualGuardianApp,
  saveVisualGuardianFailureArtifacts,
  takeGuardianScreenshot,
  waitForVisualGuardianIdle,
} from './visual_guardian_helpers';

test.describe('Visual Guardian - Filter Bar', () => {
  test.use({ ignoreHTTPSErrors: true });
  test.use({ viewport: { width: 1920, height: 1080 } });
  test.afterEach(async ({ page }, testInfo) => {
    await saveVisualGuardianFailureArtifacts(page, testInfo);
  });

  test('Interact with Filter Bar', async ({ page }, testInfo) => {
    await loadVisualGuardianApp(page, { datasetName: 'app_service_catalog' });

    // 1. Initial State
    await takeGuardianScreenshot(page, testInfo, 'filterbar_initial');

    // 2. Expand a filter section (if any exist)
    const filterHeaders = page.locator('.filter-header:visible');
    const count = await filterHeaders.count();
    
    if (count > 0) {
        // Click the first one
        await filterHeaders.first().click();
        await waitForVisualGuardianIdle(page);
        await takeGuardianScreenshot(page, testInfo, 'filterbar_expanded_first');
    } else {
        console.log('No filter headers found');
    }

    // 3. Check for "Show more" button
    const showMoreBtn = page.locator('.favefox-show-more');
    if (await showMoreBtn.isVisible()) {
        await showMoreBtn.click();
        await waitForVisualGuardianIdle(page);
        await takeGuardianScreenshot(page, testInfo, 'filterbar_show_more_clicked');
    } else {
        console.log('Show more button not visible');
    }
  });
});
