/**
 * E9_admin_version_info.spec.ts
 *
 * Verifies the admin-only filterbar version indicator against the running app.
 * Bridges protected version metadata with the visible clock-bar placement contract.
 * Exists so product/DB support details stay available without shifting the centered clock.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { openActiveFilterbarIfCollapsed } from '../helpers/filterbar';
import { navigateToDataset } from '../helpers/navigation';

test.describe('E9 — Admin version info', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('shows protected app and database versions at the clock-bar edge', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.metadata?.screenWidth !== 'desktop',
      'This placement proof drives its own viewport and only needs one project.',
    );

    await page.setViewportSize({ width: 1024, height: 768 });
    const identityResponse = await page.request.get('/api/product-identity');
    expect(identityResponse.status()).toBe(200);
    const identity = await identityResponse.json();
    const expectedProductName = String(identity.name || '');
    expect(expectedProductName).toMatch(/^(Easelect|Filterest)$/);
    await navigateToDataset(
      page,
      expectedProductName === 'Filterest' ? 'riskienhallinta' : 'app_service_catalog',
    );
    await openActiveFilterbarIfCollapsed(page);

    const indicator = page
      .locator('.tab_parts_container:visible')
      .first()
      .locator('[data-testid="filterbar-admin-version-info"]')
      .first();
    await expect(indicator).toBeVisible({ timeout: 10000 });
    await expect(indicator.locator('svg')).toBeVisible();

    const response = await page.request.get('/api/admin/version-info');
    expect(response.status()).toBe(200);
    const versionInfo = await response.json();
    expect(versionInfo).toMatchObject({
      product_name: expectedProductName,
      db_compatible: true,
    });
    expect(versionInfo.app_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(versionInfo.db_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(versionInfo.runtime_mode).toMatch(/^(docker|native)$/);
    const expectedRuntimeMode = String(process.env.EASELECT_EXPECTED_RUNTIME_MODE || '').trim();
    if (expectedRuntimeMode) {
      expect(versionInfo.runtime_mode).toBe(expectedRuntimeMode);
    }

    await indicator.hover();
    const escapedProductName = expectedProductName.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    );
    await expect(indicator).toHaveAttribute(
      'title',
      new RegExp(
        `${escapedProductName} ${versionInfo.app_version}.*Database ${versionInfo.db_version}`,
        's',
      ),
    );

    const panel = page
      .locator('.tab_parts_container:visible')
      .first()
      .locator('[data-testid="filterbar-admin-version-info-panel"]')
      .first();
    await expect(panel).toBeHidden();
    await indicator.click();
    await expect(indicator).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    await expect(panel.locator('caption')).toHaveText('Version information');
    const expectedSiteName = await page.locator('meta[property="og:site_name"]').getAttribute('content');
    await expect(panel.locator('[data-version-info-key="site"]'))
      .toHaveText('Site');
    await expect(panel.locator('[data-version-info-value="site"]'))
      .toHaveText(String(expectedSiteName || expectedProductName).trim());
    await expect(panel.locator('[data-version-info-key="application"]'))
      .toHaveText(expectedProductName);
    await expect(panel.locator('[data-version-info-value="application"]'))
      .toHaveText(versionInfo.app_version);
    await expect(panel.locator('[data-version-info-key="database"]'))
      .toHaveText('Database');
    await expect(panel.locator('[data-version-info-value="database"]'))
      .toContainText(versionInfo.db_version);
    await expect(panel.locator('[data-version-info-key="runtime"]'))
      .toHaveText('Runtime');
    await expect(panel.locator('[data-version-info-value="runtime"]'))
      .toHaveText(versionInfo.runtime_mode === 'docker' ? 'Docker' : 'Native');

    const columnLayout = await panel.evaluate((element) => {
      const keys = Array.from(element.querySelectorAll('[data-version-info-key]'));
      const values = Array.from(element.querySelectorAll('[data-version-info-value]'));
      return {
        widestKeyTextRight: Math.max(...keys.map((key) => {
          const keyBox = key.getBoundingClientRect();
          const rightPadding = Number.parseFloat(getComputedStyle(key).paddingRight) || 0;
          return keyBox.right - rightPadding;
        })),
        valueLefts: values.map((value) => value.getBoundingClientRect().left),
      };
    });
    expect(Math.max(...columnLayout.valueLefts) - Math.min(...columnLayout.valueLefts))
      .toBeLessThanOrEqual(1);
    expect(Math.min(...columnLayout.valueLefts) - columnLayout.widestKeyTextRight)
      .toBeCloseTo(19, 0);
    await testInfo.attach('admin-version-info-columns', {
      body: await panel.screenshot(),
      contentType: 'image/png',
    });

    await indicator.click();
    await expect(indicator).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();

    await indicator.click();
    await expect(panel).toBeVisible();
    await page
      .locator('.tab_parts_container:visible .filterbar-clock-bar__content')
      .first()
      .click();
    await expect(indicator).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();

    const placement = await indicator.evaluate((element) => {
      const indicatorBox = element.getBoundingClientRect();
      const clockBarBox = element.closest('.filterbar-clock-bar')?.getBoundingClientRect();
      if (!clockBarBox) {
        throw new Error('Version indicator is not mounted in the filterbar clock bar.');
      }
      return {
        rightGap: clockBarBox.right - indicatorBox.right,
        verticalCenterDelta:
          indicatorBox.top + indicatorBox.height / 2
          - (clockBarBox.top + clockBarBox.height / 2),
      };
    });

    expect(placement.rightGap).toBeCloseTo(8, 0);
    expect(Math.abs(placement.verticalCenterDelta)).toBeLessThanOrEqual(1);
  });
});
