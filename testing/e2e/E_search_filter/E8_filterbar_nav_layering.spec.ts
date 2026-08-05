/**
 * E8_filterbar_nav_layering.spec.ts
 *
 * Verifies narrow filterbar opening does not get trapped under the navbar
 * overlay and that the navbar close state remains animated instead of snapping.
 */

import { test, expect, type Page } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { clickFirstVisibleByTestId, navigateToDataset, waitForDataLoaded } from '../helpers/navigation';

const DATASET = 'app_service_catalog';
const NARROW_WIDTHS = [375, 480, 768, 1024, 1099];

type LayerState = {
  navbarCollapsed: boolean;
  panelVisible: boolean;
  overlayVisible: boolean;
  panelAboveOverlay: boolean;
  filterbarTopmostAtPanelEdge: boolean;
};

async function prepareHiddenNarrowDrawers(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.evaluate((datasetName) => {
    localStorage.setItem('navVisibleNarrow', 'false');
    localStorage.setItem(`${datasetName}_filterbar_visible_narrow`, 'false');
    localStorage.setItem(`${datasetName}_view`, 'table');
  }, DATASET);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await navigateToDataset(page, DATASET);
  await waitForDataLoaded(page, DATASET);
}

async function openNavbarThenFilterbar(page: Page): Promise<void> {
  await expect(page.locator('#showMenuButton')).toBeVisible({ timeout: 5000 });
  await page.locator('#showMenuButton').evaluate((button) => {
    if (button instanceof HTMLElement) {
      button.click();
    }
  });
  await expect(page.locator('#navbar:not(.collapsed)')).toBeVisible({ timeout: 5000 });
  await clickFirstVisibleByTestId(page, 'filterbar-toggle');
}

async function readLayerState(page: Page): Promise<LayerState> {
  return page.evaluate(() => {
    const navbar = document.getElementById('navbar');
    const panel = document.querySelector('.filterbar-panel');
    const overlay = document.getElementById('mobileFilterOverlay');

    if (!(navbar instanceof HTMLElement) || !(panel instanceof HTMLElement) || !(overlay instanceof HTMLElement)) {
      throw new Error('Missing navbar, filterbar panel, or mobile overlay.');
    }

    const panelRect = panel.getBoundingClientRect();
    const panelStyle = getComputedStyle(panel);
    const overlayStyle = getComputedStyle(overlay);
    const hitX = Math.min(Math.max(panelRect.left + 24, 1), window.innerWidth - 2);
    const hitY = Math.min(Math.max(panelRect.top + 80, 1), window.innerHeight - 2);
    const topElements = document.elementsFromPoint(hitX, hitY);

    return {
      navbarCollapsed: navbar.classList.contains('collapsed'),
      panelVisible: !panel.classList.contains('filterbar-panel--hidden'),
      overlayVisible: overlay.classList.contains('mfo-overlay--visible'),
      panelAboveOverlay: Number(panelStyle.zIndex) > Number(overlayStyle.zIndex),
      filterbarTopmostAtPanelEdge: topElements.some((element) => panel.contains(element)),
    };
  });
}

test.describe('E8 — Filterbar and Navbar Layering', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('narrow filterbar opens above the backdrop and closes the open navbar across breakpoints', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.metadata?.screenWidth !== 'desktop',
      'This test drives its own viewport sweep and only needs one project.',
    );

    for (const width of NARROW_WIDTHS) {
      await prepareHiddenNarrowDrawers(page, width);
      await openNavbarThenFilterbar(page);
      await page.waitForTimeout(850);

      const layerState = await readLayerState(page);
      expect(layerState.navbarCollapsed, `navbar should close at ${width}px`).toBe(true);
      expect(layerState.panelVisible, `filterbar should be open at ${width}px`).toBe(true);
      expect(layerState.overlayVisible, `overlay should be visible at ${width}px`).toBe(true);
      expect(layerState.panelAboveOverlay, `filterbar should be above overlay at ${width}px`).toBe(true);
      expect(layerState.filterbarTopmostAtPanelEdge, `filterbar should be reachable at ${width}px`).toBe(true);
    }
  });

  test('navbar is still sliding during its narrow close transition', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.metadata?.screenWidth !== 'desktop',
      'This test drives its own viewport and only needs one project.',
    );

    await prepareHiddenNarrowDrawers(page, 375);
    await expect(page.locator('#showMenuButton')).toBeVisible({ timeout: 5000 });
    await page.locator('#showMenuButton').evaluate((button) => {
      if (button instanceof HTMLElement) {
        button.click();
      }
    });
    await expect(page.locator('#navbar:not(.collapsed)')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(850);

    await page.locator('#hideMenuButton').evaluate((button) => {
      if (button instanceof HTMLElement) {
        button.click();
      }
    });
    await page.waitForTimeout(100);

    const transitionState = await page.locator('#navbar').evaluate((navbar) => {
      const element = navbar as HTMLElement;
      const rect = element.getBoundingClientRect();
      return {
        opacity: Number(getComputedStyle(element).opacity),
        right: rect.right,
        width: rect.width,
      };
    });
    expect(transitionState.opacity).toBe(1);
    expect(transitionState.right).toBeGreaterThan(0);
    expect(transitionState.right).toBeLessThan(transitionState.width);
  });
});
