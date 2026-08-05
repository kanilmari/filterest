// capture_screens.spec.ts
// Captures representative navbar and viewport states for Visual Guardian review.
// Bridges Playwright responsive projects and the screenshot artifact helper.
// Exists so shell-level visual regressions are checked from stable screenshots.

import { test } from '@playwright/test';

import {
  loadVisualGuardianApp,
  saveVisualGuardianFailureArtifacts,
  takeGuardianScreenshot,
  waitForVisualGuardianIdle,
} from './visual_guardian_helpers';

test.describe('Visual Guardian Capture', () => {
  // Allow insecure certs as per config
  test.use({ ignoreHTTPSErrors: true });
  test.afterEach(async ({ page }, testInfo) => {
    await saveVisualGuardianFailureArtifacts(page, testInfo);
  });

  test.describe('Desktop (Wide) - 1920x1080', () => {
    test.use({ viewport: { width: 1920, height: 1080 } });

    test('Capture Navbar States', async ({ page }, testInfo) => {
      await loadVisualGuardianApp(page);

      // 1. Desktop Default (Navbar Open)
      await takeGuardianScreenshot(page, testInfo, 'desktop_navbar_open');

      // 2. Desktop Navbar Closed
      const menuButton = page.locator('#showMenuButton');
      if (await menuButton.isVisible()) {
          await menuButton.click();
          await waitForVisualGuardianIdle(page);
          await takeGuardianScreenshot(page, testInfo, 'desktop_navbar_closed');
      } else {
          console.log('Menu button not visible in Desktop mode');
      }
    });
  });

  test.describe('Laptop (Narrow) - 1400x900', () => {
    test.use({ viewport: { width: 1400, height: 900 } });

    test('Capture Navbar Overlay States', async ({ page }, testInfo) => {
      await loadVisualGuardianApp(page);

      // 1. Laptop Default (Navbar Closed)
      await takeGuardianScreenshot(page, testInfo, 'laptop_navbar_closed');

      // 2. Laptop Navbar Open (Overlay)
      const showButton = page.locator('#showMenuButton');
      if (await showButton.isVisible()) {
          await showButton.click();
          await waitForVisualGuardianIdle(page);
          await takeGuardianScreenshot(page, testInfo, 'laptop_navbar_open');
      } else {
          console.log('Show button not visible in Laptop mode');
      }
    });
  });

  test.describe('Tablet (iPad Landscape) - 1024x768', () => {
    test.use({ viewport: { width: 1024, height: 768 } });

    test('Capture Tablet States', async ({ page }, testInfo) => {
      await loadVisualGuardianApp(page);

      // 1. Tablet Default
      await takeGuardianScreenshot(page, testInfo, 'tablet_landscape_default');
    });
  });

  test.describe('Mobile - 375x812', () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test('Capture Mobile States', async ({ page }, testInfo) => {
      await loadVisualGuardianApp(page);

      // 1. Mobile Default
      await takeGuardianScreenshot(page, testInfo, 'mobile_view');
      
      // 2. Mobile Menu Open
      const showButton = page.locator('#showMenuButton');
      if (await showButton.isVisible()) {
          await showButton.click();
          await waitForVisualGuardianIdle(page);
          await takeGuardianScreenshot(page, testInfo, 'mobile_menu_open');
      }
    });
  });
});
