/**
 * G4_svg_tab_alignment.spec.ts
 *
 * Verifies the sidebar SVG tabs keep the intended horizontal alignment in both
 * compact button mode and wide physical-navbar mode.
 */

import { test, expect, type Page } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { switchToView } from '../helpers/view-switch';

type TabMetrics = {
  navbarCenterX: number;
  tabCenterX: number;
  centerDelta: number;
  navbarLeftX: number;
  tabLeftX: number;
  leftDelta: number;
  navbarRightX: number;
  tabRightX: number;
  tabTopY: number;
  rightDelta: number;
  tabBorderRadius: string;
  navbarBoxShadow: string;
  topBarBoxShadow: string | null;
  topBarBorderBottomWidth: string | null;
  topBarBorderBottomStyle: string | null;
  tabPresentation: string | null;
  outlineD: string | null;
  outlineFill: string | null;
  outlineStrokeWidth: string | null;
};

async function readTabMetrics(page: Page, testId: string): Promise<TabMetrics> {
  return page.evaluate((resolvedTestId) => {
    const navbar = document.getElementById('navbar');
    const topBar = document.querySelector('.top-button-bar');
    const tab = document.querySelector(`[data-testid="${resolvedTestId}"]`);

    if (!(navbar instanceof HTMLElement) || !(tab instanceof HTMLElement)) {
      throw new Error(`Missing navbar or tab for ${resolvedTestId}`);
    }

    const navbarRect = navbar.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    const outline = tab.querySelector('.svg-container path');
    const navbarCenterX = navbarRect.left + (navbarRect.width / 2);
    const tabCenterX = tabRect.left + (tabRect.width / 2);
    const centerDelta = Math.abs(navbarCenterX - tabCenterX);
    const navbarLeftX = navbarRect.left;
    const tabLeftX = tabRect.left;
    const leftDelta = Math.abs(navbarLeftX - tabLeftX);
    const navbarRightX = navbarRect.right;
    const tabRightX = tabRect.right;
    const rightDelta = Math.abs(navbarRightX - tabRightX);
    const tabStyle = getComputedStyle(tab);
    const navbarStyle = getComputedStyle(navbar);
    const topBarStyle = topBar instanceof HTMLElement ? getComputedStyle(topBar) : null;

    return {
      navbarCenterX,
      tabCenterX,
      centerDelta,
      navbarLeftX,
      tabLeftX,
      leftDelta,
      navbarRightX,
      tabRightX,
      tabTopY: tabRect.top,
      rightDelta,
      tabBorderRadius: tabStyle.borderTopLeftRadius,
      navbarBoxShadow: navbarStyle.boxShadow,
      topBarBoxShadow: topBarStyle?.boxShadow ?? null,
      topBarBorderBottomWidth: topBarStyle?.borderBottomWidth ?? null,
      topBarBorderBottomStyle: topBarStyle?.borderBottomStyle ?? null,
      tabPresentation: tab.dataset.tabPresentation ?? null,
      outlineD: outline?.getAttribute('d') ?? null,
      outlineFill: outline?.getAttribute('fill') ?? null,
      outlineStrokeWidth: outline?.getAttribute('stroke-width') ?? null,
    };
  }, testId);
}

async function showTabPresentationForView(page: Page, datasetName: string, viewMode: 'table' | 'normal' | 'transposed' | 'card'): Promise<void> {
  await switchToView(page, viewMode, { allowMissing: true });
  await page.evaluate(async ({ datasetName: evaluatedDatasetName, viewMode: evaluatedViewMode }) => {
    localStorage.setItem(`${evaluatedDatasetName}_view`, evaluatedViewMode);
    const modulePath = '/frontend/core_components/navigation/main_tabs/main_tab_printer.js';
    const { updateTabPathsForView } = await import(modulePath);
    await updateTabPathsForView(evaluatedDatasetName);
  }, { datasetName, viewMode });
  await page.waitForTimeout(1000);
}

test.describe('G4 — SVG Tab Alignment', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.metadata?.screenWidth !== 'desktop',
      'SVG tab alignment rules are verified in the desktop navbar layout.',
    );
    await login(page, credentials);
  });

  test('grid-like views use centered button tabs while card view stays attached to the navbar edge', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForTimeout(300);

    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');

    await showTabPresentationForView(page, 'app_service_catalog', 'table');
    const tableMetrics = await readTabMetrics(page, 'tab-app_service_catalog');
    expect(tableMetrics.centerDelta).toBeLessThanOrEqual(12);
    expect(tableMetrics.leftDelta).toBeLessThanOrEqual(1);
    expect(tableMetrics.rightDelta).toBeGreaterThanOrEqual(1);
    expect(tableMetrics.rightDelta).toBeLessThanOrEqual(3);
    expect(tableMetrics.tabPresentation).toBe('button-active');
    expect(tableMetrics.outlineFill).toBe('none');
    expect(tableMetrics.outlineStrokeWidth).toBe('2');
    expect(tableMetrics.navbarBoxShadow).toContain('inset');
    expect(tableMetrics.topBarBorderBottomWidth).toBe('2px');
    expect(tableMetrics.topBarBorderBottomStyle).toBe('solid');

    await showTabPresentationForView(page, 'app_service_catalog', 'normal');
    const listMetrics = await readTabMetrics(page, 'tab-app_service_catalog');
    expect(listMetrics.centerDelta).toBeLessThanOrEqual(12);
    expect(listMetrics.tabPresentation).toBe('button-active');
    expect(Math.abs(listMetrics.tabTopY - tableMetrics.tabTopY)).toBeLessThanOrEqual(2);

    await showTabPresentationForView(page, 'app_service_catalog', 'transposed');
    const comparisonMetrics = await readTabMetrics(page, 'tab-app_service_catalog');
    expect(comparisonMetrics.centerDelta).toBeLessThanOrEqual(12);
    expect(comparisonMetrics.tabPresentation).toBe('button-active');
    expect(Math.abs(comparisonMetrics.tabTopY - tableMetrics.tabTopY)).toBeLessThanOrEqual(2);

    await showTabPresentationForView(page, 'app_service_catalog', 'card');
    const cardMetrics = await readTabMetrics(page, 'tab-app_service_catalog');
    expect(cardMetrics.rightDelta).toBeLessThanOrEqual(3);
    expect(cardMetrics.tabPresentation).toBe('tab-active');
    expect(cardMetrics.outlineD).toMatch(/^M [\d.]+ 1/);
    expect(cardMetrics.outlineD).toContain('A 7 7');
    expect(cardMetrics.outlineD).toContain(' 64');
    expect(cardMetrics.navbarBoxShadow).toContain('inset');

    await page.evaluate(() => {
      document.getElementById('tabs_container')?.classList.add('navbar_hidden');
      window.dispatchEvent(new Event('navbar-visibility-changed'));
    });
    const overlayMetrics = await readTabMetrics(page, 'tab-app_service_catalog');
    expect(overlayMetrics.centerDelta).toBeLessThanOrEqual(12);
    expect(overlayMetrics.tabPresentation).toBe('button-active');
  });
});
