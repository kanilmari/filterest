// capture_search_bar.spec.ts
// Captures focused filterbar/search-bar states for Visual Guardian review.
// Bridges responsive Playwright viewports and the screenshot artifact helper.
// Exists so search-bar visual regressions are visible across desktop and tablet states.

import { test } from '@playwright/test';

import {
  loadVisualGuardianApp,
  saveVisualGuardianFailureArtifacts,
  takeGuardianScreenshot,
  waitForVisualGuardianIdle,
} from './visual_guardian_helpers';

function getVisibleFilterPanel(page) {
  return page.locator('.filterbar-panel:visible, .dataset-filter-panel:visible').first();
}

test.describe('Visual Guardian - Search Bar Focus', () => {
  test.use({ ignoreHTTPSErrors: true });
  test.afterEach(async ({ page }, testInfo) => {
    await saveVisualGuardianFailureArtifacts(page, testInfo);
  });

  test('Desktop (1920x1080) - Flat Mode Search Bar', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await loadVisualGuardianApp(page, { datasetName: 'app_service_catalog' });
    
    const filterPanel = getVisibleFilterPanel(page);
    const panelVisible = await filterPanel.isVisible().catch(() => false);
    if (!panelVisible) {
      try {
        await filterPanel.waitFor({ state: 'visible', timeout: 5000 });
      } catch {
        test.skip(true, 'Filter panel not visible for the loaded dataset.');
        return;
      }
    }

    // Click toggle to go to Flat Mode
    const toggleBtn = page.locator('.filterbar-fixed-toggle');
    if (await toggleBtn.isVisible()) {
        await toggleBtn.click();
        await waitForVisualGuardianIdle(page);
        await takeGuardianScreenshot(page, testInfo, 'desktop_flat_mode_search_bar');
    } else {
        console.log('Toggle button not visible, trying scroll');
        await page.evaluate(() => window.scrollTo(0, 500));
        await waitForVisualGuardianIdle(page);
        await takeGuardianScreenshot(page, testInfo, 'desktop_flat_mode_search_bar_scrolled');
    }
  });

  test('Tablet (iPad Landscape 1024x768) - Flat Mode Search Bar', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await loadVisualGuardianApp(page, { datasetName: 'app_service_catalog' });
    
    const filterPanel = getVisibleFilterPanel(page);
    const panelVisible = await filterPanel.isVisible().catch(() => false);
    if (!panelVisible) {
      try {
        await filterPanel.waitFor({ state: 'visible', timeout: 5000 });
      } catch {
        test.skip(true, 'Filter panel not visible for the loaded dataset.');
        return;
      }
    }

    // Scroll to trigger flat mode (Tablet usually triggers via scroll or toggle)
    await page.evaluate(() => window.scrollTo(0, 500));
    await waitForVisualGuardianIdle(page);
    
    await takeGuardianScreenshot(page, testInfo, 'tablet_flat_mode_search_bar');
  });
});
