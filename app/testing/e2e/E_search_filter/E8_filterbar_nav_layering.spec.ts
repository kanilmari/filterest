/**
 * E8_filterbar_nav_layering.spec.ts
 *
 * Verifies narrow filterbar opening does not get trapped under the navbar
 * overlay and that the navbar close state remains animated instead of snapping.
 */

import { test, expect, type Page } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { closeActiveFilterbarIfOpen, waitForActiveFilterbarLayout } from '../helpers/filterbar';

const DATASET = process.env.FILTEREST_E2E_TOPBAR_DATASET || 'app_service_catalog';
const DATASET_ADDRESS = '/' + (DATASET === 'app_service_catalog' ? 'service_catalog' : encodeURIComponent(DATASET));
const datasetHost = (page: Page) => page.locator(`[id="${DATASET}_container"]:not(.hidden)`);
const menuButton = (page: Page) => datasetHost(page).getByTestId('shared-topbar-menu-button');
const NARROW_WIDTHS = [375, 480, 768, 1024, 1099];

type LayerState = {
  navbarCollapsed: boolean;
  panelVisible: boolean;
  overlayVisible: boolean;
  panelAboveOverlay: boolean;
  navbarCloserTopmost: boolean;
  filterbarTopmostAtPanelEdge: boolean;
};

async function prepareHiddenNarrowDrawers(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  // A fresh page shows the view its address names and forgets a view seeded
  // before the load (owner decision K139), so the table view comes from the address.
  await page.goto(`${DATASET_ADDRESS}?view=table`, { waitUntil: 'domcontentloaded' });
  const host = datasetHost(page);
  await waitForActiveFilterbarLayout(page, host);
  await closeActiveFilterbarIfOpen(page, host);
  await expect(host.locator('.filterbar-panel')).toHaveClass(/filterbar-panel--hidden/);
  await expect(page.locator('#navbar')).toHaveClass(/collapsed/);
}

async function openNavbarThenFilterbar(page: Page): Promise<void> {
  await menuButton(page).click();
  await expect(page.locator('#navbar:not(.collapsed)')).toBeVisible({ timeout: 5000 });
  await datasetHost(page).getByTestId('filterbar-toggle').click();
}

async function readLayerState(page: Page): Promise<LayerState> {
  return datasetHost(page).evaluate(host => {
    const navbar = document.getElementById('navbar');
    const panel = host.querySelector('.filterbar-panel');
    const overlay = document.getElementById('mobileFilterOverlay');
    const menuClose = navbar?.querySelector('#hideMenuButton');

    if (!(navbar instanceof HTMLElement) || !(panel instanceof HTMLElement) || !(overlay instanceof HTMLElement) || !(menuClose instanceof HTMLElement)) {
      throw new Error('Missing navbar, filterbar panel, or mobile overlay.');
    }

    const menuRect = menuClose.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const panelStyle = getComputedStyle(panel);
    const overlayStyle = getComputedStyle(overlay);
    // Both drawers may overlap on a phone. Check the filter panel's exposed right edge.
    const hitX = Math.min(panelRect.right, window.innerWidth) - 24;
    const hitY = Math.min(Math.max(panelRect.top + 80, 1), window.innerHeight - 2);
    const hit = document.elementFromPoint(hitX, hitY);

    return {
      navbarCollapsed: navbar.classList.contains('collapsed'),
      panelVisible: !panel.classList.contains('filterbar-panel--hidden'),
      overlayVisible: overlay.classList.contains('mfo-overlay--visible'),
      panelAboveOverlay: Number(panelStyle.zIndex) > Number(overlayStyle.zIndex),
      navbarCloserTopmost: menuRect.width > 0 && menuRect.height > 0 && menuClose.contains(
        document.elementFromPoint(menuRect.left + menuRect.width / 2, menuRect.top + menuRect.height / 2)),
      filterbarTopmostAtPanelEdge: panel.contains(hit),
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
    await page.addInitScript(dataset => {
      localStorage.setItem('navVisibleNarrow', 'false');
      localStorage.setItem(`${dataset}_filterbar_visible`, 'false');
    }, DATASET);
  });

  test('narrow filterbar opens above its backdrop and toggles independently of the navbar across breakpoints', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.metadata?.screenWidth !== 'desktop',
      'This test drives its own viewport sweep and only needs one project.',
    );
    // Five widths, each with a fresh page load and data wait: the default 30 s ran out under nightly load (20.10.).
    test.setTimeout(90_000);

    for (const width of NARROW_WIDTHS) {
      await prepareHiddenNarrowDrawers(page, width);
      await openNavbarThenFilterbar(page);
      const navbar = page.locator('#navbar');
      const panel = datasetHost(page).locator('.filterbar-panel');
      await expect.poll(() => readLayerState(page), { message: `both drawers and filter hit target at ${width}px` })
        .toEqual({
          navbarCollapsed: false, panelVisible: true, overlayVisible: true, panelAboveOverlay: true,
          filterbarTopmostAtPanelEdge: true, navbarCloserTopmost: true,
        });
      await panel.locator('.hide_filter_bar_button').click();
      await expect(panel).toHaveClass(/filterbar-panel--hidden/);
      await expect(navbar).not.toHaveClass(/collapsed/);
    }
  });

  test('navbar is still sliding during its narrow close transition', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.metadata?.screenWidth !== 'desktop',
      'This test drives its own viewport and only needs one project.',
    );

    await prepareHiddenNarrowDrawers(page, 375);
    const visibleMenuButton = menuButton(page);
    await visibleMenuButton.click();
    await expect(page.locator('#navbar:not(.collapsed)')).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(850);

    await visibleMenuButton.click();
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

  // navbar_layout.css keeps the sliding top row on a neutral cursor while it opens (it moves under a stationary
  // pointer); only the navbar's own menu control stays a pointer. Its Vitest pins the same contract.
  test('keeps the opening top row neutral except for its menu button', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.metadata?.screenWidth !== 'desktop',
      'This proof drives its own viewport and only needs one project.',
    );

    await prepareHiddenNarrowDrawers(page, 375);
    const visibleMenuButton = menuButton(page);
    await visibleMenuButton.click();

    const navbar = page.locator('#navbar');
    await expect(navbar).toHaveClass(/navbar-opening/);
    const openingCursorState = await navbar.evaluate((element) => {
      const topBar = element.querySelector<HTMLElement>('.top-button-bar');
      const historyGap = element.querySelector<HTMLElement>('.nav-history-buttons');
      const menuButton = element.querySelector<HTMLElement>('#hideMenuButton');
      const disabledHistoryButtons = Array.from(
        element.querySelectorAll<HTMLButtonElement>('.nav-history-btn:disabled'),
      );
      return {
        topBar: topBar ? getComputedStyle(topBar).cursor : '',
        historyGap: historyGap ? getComputedStyle(historyGap).cursor : '',
        menuButton: menuButton ? getComputedStyle(menuButton).cursor : '',
        disabledButtons: disabledHistoryButtons.map((button) => ({
          cursor: getComputedStyle(button).cursor,
          disabled: button.disabled,
        })),
      };
    });

    expect(openingCursorState.topBar).toBe('default');
    expect(openingCursorState.historyGap).toBe('default');
    expect(openingCursorState.menuButton).toBe('pointer');
    expect(openingCursorState.disabledButtons.length).toBeGreaterThan(0);
    expect(openingCursorState.disabledButtons.every(({ cursor }) => cursor === 'default')).toBe(true);
    expect(openingCursorState.disabledButtons.every(({ disabled }) => disabled)).toBe(true);

    await expect(navbar).not.toHaveClass(/navbar-opening/, { timeout: 1000 });
    const settledDisabledCursors = await navbar
      .locator('.nav-history-btn:disabled')
      .evaluateAll((buttons) => buttons.map((button) => getComputedStyle(button).cursor));
    expect(settledDisabledCursors.every((cursor) => cursor === 'default')).toBe(true);
  });
});
