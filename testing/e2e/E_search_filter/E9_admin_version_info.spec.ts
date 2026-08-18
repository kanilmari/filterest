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
import { navigateToDefaultDataset } from '../helpers/navigation';

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

    await page.setViewportSize({ width: 1280, height: 768 });
    const identityResponse = await page.request.get('/api/product-identity');
    expect(identityResponse.status()).toBe(200);
    const identity = await identityResponse.json();
    const expectedProductName = String(identity.name || '');
    const expectedPublicDistribution = Boolean(identity.public_distribution);
    expect(expectedProductName).toBe('Filterest');
    await navigateToDefaultDataset(page);
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
    expect(versionInfo.release_channel).toMatch(/^(development|stable|unknown)$/);
    expect(versionInfo.artifact_purpose).toMatch(/^(developer_backup|public_release|unknown)$/);
    expect(versionInfo.artifact_type).toMatch(/^(runtime|backup|unknown)$/);
    expect(versionInfo.release_maturity).toMatch(/^(snapshot|candidate|published|unknown)$/);
    expect(versionInfo.identity_verification)
      .toMatch(/^(local_contract_validated|legacy_unverified|unverified)$/);
    expect(versionInfo.public_distribution).toBe(expectedPublicDistribution);
    expect(versionInfo.update_status).toMatch(/^(available|current|ahead_of_stable|unavailable)$/);
    expect(versionInfo.update_available).toBe(versionInfo.update_status === 'available');
    if (versionInfo.update_status !== 'unavailable') {
      expect(versionInfo.latest_stable_version).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(versionInfo.db_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(versionInfo.runtime_mode).toMatch(/^(docker|native)$/);
    const releaseChannelLabels: Record<string, string> = {
      development: 'Development',
      stable: 'Stable',
      unknown: 'Unknown',
    };
    const artifactPurposeLabels: Record<string, string> = {
      developer_backup: 'Developer backup',
      public_release: 'Intended for public release',
      unknown: 'Unknown',
    };
    const artifactTypeLabels: Record<string, string> = {
      runtime: 'Runtime',
      backup: 'Backup',
      unknown: 'Unknown',
    };
    const releaseMaturityLabels: Record<string, string> = {
      snapshot: 'Development snapshot',
      candidate: 'Release candidate',
      published: 'Published',
      unknown: 'Unknown',
    };
    const identityVerificationLabels: Record<string, string> = {
      local_contract_validated: 'Local release contract validated',
      legacy_unverified: 'Legacy marker, unverified',
      unverified: 'Unverified',
    };
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
        `${escapedProductName} v\\. ${versionInfo.app_version}.*Database v\\. ${versionInfo.db_version}`,
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
    await expect(panel.locator('thead th')).toHaveText('Site information');
    const expectedSiteName = await page.locator('meta[property="og:site_name"]').getAttribute('content');
    const expectedSiteDisplayName = String(expectedSiteName || expectedProductName)
      .trim()
      .replace(/^\p{Ll}/u, (character) => character.toLocaleUpperCase());
    await expect(panel.locator('[data-version-info-key="site"]'))
      .toHaveText('Site');
    await expect(panel.locator('[data-version-info-value="site"]'))
      .toHaveText(expectedSiteDisplayName);
    await expect(panel.locator('[data-version-info-key="application"]'))
      .toHaveText(expectedProductName);
    await expect(panel.locator('[data-version-info-value="application"]'))
      .toHaveText(`v. ${versionInfo.app_version}`);
    await expect(panel.locator('[data-version-info-key="release-channel"]'))
      .toHaveText('Release channel');
    await expect(panel.locator('[data-version-info-value="release-channel"]'))
      .toHaveText(releaseChannelLabels[String(versionInfo.release_channel)] || 'Unknown');
    await expect(panel.locator('[data-version-info-key="artifact-purpose"]'))
      .toHaveText('Release purpose');
    await expect(panel.locator('[data-version-info-value="artifact-purpose"]'))
      .toHaveText(artifactPurposeLabels[String(versionInfo.artifact_purpose)] || 'Unknown');
    await expect(panel.locator('[data-version-info-key="artifact-type"]'))
      .toHaveText('Package type');
    await expect(panel.locator('[data-version-info-value="artifact-type"]'))
      .toHaveText(artifactTypeLabels[String(versionInfo.artifact_type)] || 'Unknown');
    await expect(panel.locator('[data-version-info-key="release-maturity"]'))
      .toHaveText('Release stage');
    await expect(panel.locator('[data-version-info-value="release-maturity"]'))
      .toHaveText(releaseMaturityLabels[String(versionInfo.release_maturity)] || 'Unknown');
    await expect(panel.locator('[data-version-info-key="identity-verification"]'))
      .toHaveText('Identity verification');
    await expect(panel.locator('[data-version-info-value="identity-verification"]'))
      .toHaveText(identityVerificationLabels[String(versionInfo.identity_verification)] || 'Unverified');
    await expect(panel.locator('[data-version-info-key="latest-stable"]'))
      .toHaveText('Latest stable version');
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
