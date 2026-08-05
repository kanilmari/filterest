/**
 * E10_site_identity_and_menu_contract.spec.ts
 *
 * Verifies branded dataset headings, closed filterbar tool groups, and the
 * single canonical menu-button placement across wide and narrow articles.
 * Exists so site identity moves out of the navbar without disappearing from
 * dataset pages or creating a duplicate menu control.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset } from '../helpers/navigation';
import { switchToView, openBigCard } from '../helpers/view-switch';

const DATASET = 'app_service_catalog';

test.describe('E10 — Site identity and menu contract', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('shows the dynamic site–dataset heading and keeps sidebar groups closed', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.metadata?.screenWidth !== 'desktop',
      'This proof drives a wide viewport and only needs one project.',
    );

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => localStorage.setItem('navVisibleWide', 'true'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await navigateToDataset(page, DATASET);

    const siteName = String(
      await page.locator('meta[property="og:site_name"]').getAttribute('content') || '',
    ).trim();
    expect(siteName).not.toBe('');

    const hero = page.locator('.tab_parts_container:visible .morphing-title').first();
    await expect(hero.locator('.morphing-title__site-name')).toHaveText(siteName);
    await expect(hero.locator('.morphing-title__separator')).toHaveText(' – ');
    await expect(hero.locator('.morphing-title__dataset-name')).not.toHaveText('');
    await expect(page.locator('.navbar-site-identity')).toHaveCount(0);

    for (const sectionKey of ['filters', 'tools', 'views', 'field_sets']) {
      const section = page
        .locator(`.tab_parts_container:visible [data-filterbar-section-key="${sectionKey}"]`)
        .first();
      await expect(section).toBeVisible();
      await expect(section.locator('.animated-disclosure-header')).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      await expect(section.locator('.favefox-filterbar-disclosure-content')).toBeHidden();
    }
  });

  test('keeps one top-left menu button in wide and narrow article views', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.metadata?.screenWidth !== 'desktop',
      'This proof drives both responsive layouts and only needs one project.',
    );

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => localStorage.setItem('navVisibleWide', 'true'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await navigateToDataset(page, DATASET);
    await switchToView(page, 'card');
    expect(await openBigCard(page)).toBe(true);

    const wideTopbar = page.locator('.dataset-shared-topbar--visible').first();
    const menuButton = page.locator('#showMenuButton');
    await expect(wideTopbar).toBeVisible();
    await expect(menuButton).toBeVisible();
    await expect(wideTopbar.locator('#showMenuButton')).toHaveCount(0);
    await expect(page.locator('#hideMenuButton')).toBeHidden();
    await expect(page.locator('#showMenuButton')).toHaveCount(1);

    const wideBadge = page.locator('#showMenuButton .environment-badge');
    await expect(wideBadge).toBeVisible();
    const wideMenuGeometry = await menuButton.evaluate((element) => {
      const button = element.getBoundingClientRect();
      const badge = element.querySelector('.environment-badge')?.getBoundingClientRect();
      return {
        buttonWidth: button.width,
        buttonHeight: button.height,
        badgeTopOffset: (badge?.top ?? button.top) - button.top,
        badgeRightOffset: (badge?.right ?? button.right) - button.right,
      };
    });
    expect(wideMenuGeometry.buttonWidth).toBe(44);
    expect(wideMenuGeometry.buttonHeight).toBe(44);

    const widePosition = await menuButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    });
    expect(widePosition.left).toBeLessThan(80);
    expect(widePosition.top).toBeLessThan(80);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.evaluate(() => localStorage.setItem('navVisibleNarrow', 'false'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await navigateToDataset(page, DATASET);
    await switchToView(page, 'card');
    expect(await openBigCard(page)).toBe(true);

    const narrowTopbar = page.locator('.dataset-shared-topbar--visible').first();
    await expect(narrowTopbar).toBeVisible();
    await expect(narrowTopbar.locator('.dataset-shared-topbar__menu-slot #showMenuButton'))
      .toBeVisible();
    await expect(page.locator('#showMenuButton')).toHaveCount(1);
    await expect(page.locator('#hideMenuButton')).toBeHidden();

    const narrowBadge = menuButton.locator('.environment-badge');
    await expect(narrowBadge).toBeVisible();
    const narrowMenuGeometry = await menuButton.evaluate((element) => {
      const button = element.getBoundingClientRect();
      const badge = element.querySelector('.environment-badge')?.getBoundingClientRect();
      const topbar = element.closest('.dataset-shared-topbar')?.getBoundingClientRect();
      const topbarInner = element.closest('.dataset-shared-topbar__inner');
      return {
        buttonWidth: button.width,
        buttonHeight: button.height,
        badgeTop: badge?.top ?? Number.NEGATIVE_INFINITY,
        badgeBottom: badge?.bottom ?? Number.POSITIVE_INFINITY,
        badgeTopOffset: (badge?.top ?? button.top) - button.top,
        badgeRightOffset: (badge?.right ?? button.right) - button.right,
        topbarTop: topbar?.top ?? Number.POSITIVE_INFINITY,
        topbarBottom: topbar?.bottom ?? Number.NEGATIVE_INFINITY,
        innerOverflow: topbarInner ? getComputedStyle(topbarInner).overflow : '',
      };
    });
    expect(narrowMenuGeometry.buttonWidth).toBe(wideMenuGeometry.buttonWidth);
    expect(narrowMenuGeometry.buttonHeight).toBe(wideMenuGeometry.buttonHeight);
    expect(narrowMenuGeometry.badgeTopOffset).toBeCloseTo(wideMenuGeometry.badgeTopOffset, 1);
    expect(narrowMenuGeometry.badgeRightOffset).toBeCloseTo(wideMenuGeometry.badgeRightOffset, 1);
    expect(narrowMenuGeometry.badgeTop).toBeGreaterThanOrEqual(narrowMenuGeometry.topbarTop);
    expect(narrowMenuGeometry.badgeBottom).toBeLessThanOrEqual(narrowMenuGeometry.topbarBottom);
    expect(narrowMenuGeometry.innerOverflow).toBe('visible');

    const narrowPosition = await menuButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    });
    expect(narrowPosition.left).toBeLessThan(80);
    expect(narrowPosition.top).toBeLessThan(100);
  });
});
