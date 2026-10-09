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
    // The check action may wait up to 35 s for the server's cooldown below, longer than the default test budget.
    test.setTimeout(90_000);

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
    await expect(indicator.locator('[data-symbol-key="info"]')).toBeVisible();

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

    await expect(indicator).toHaveAttribute('title', 'Site information');
    const escapedProductName = expectedProductName.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    );

    const panel = page.locator('[data-testid="filterbar-admin-version-info-panel"]').first();
    await expect(panel).toBeHidden();
    await indicator.click();
    await expect(indicator).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    const stackingContract = await panel.evaluate((element) => {
      const competingElements = Array.from(document.querySelectorAll(
        '.dataset-shared-topbar, .filterbar-panel, .column-preset-more-menu',
      ));
      const competingZIndexes = competingElements
        .map((candidate) => Number.parseInt(window.getComputedStyle(candidate).zIndex, 10))
        .filter(Number.isFinite);
      const panelRect = element.getBoundingClientRect();
      return {
        parentIsBody: element.parentElement === document.body,
        position: window.getComputedStyle(element).position,
        panelZIndex: Number.parseInt(window.getComputedStyle(element).zIndex, 10),
        maximumCompetingZIndex: Math.max(0, ...competingZIndexes),
        insideViewport:
          panelRect.left >= 0
          && panelRect.top >= 0
          && panelRect.right <= window.innerWidth
          && panelRect.bottom <= window.innerHeight,
      };
    });
    expect(stackingContract.parentIsBody).toBe(true);
    expect(stackingContract.position).toBe('fixed');
    expect(stackingContract.panelZIndex).toBeGreaterThan(
      stackingContract.maximumCompetingZIndex,
    );
    expect(stackingContract.insideViewport).toBe(true);
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
    const checkAgainButton = panel.locator('[data-testid="filterbar-admin-version-check-again"]');
    await expect(checkAgainButton).toHaveText('Check releases');
    await expect(panel.locator('button')).toHaveCount(1);
    await expect(panel.locator('[data-testid="filterbar-admin-update-preview-open"]')).toHaveCount(0);
    await expect(panel.locator('code, section, tfoot')).toHaveCount(0);
    await expect(panel.locator('.filterbar-clock-bar__version-operator-guidance'))
      .toHaveText('Updates are currently performed by the site operator.');
    await expect(panel.locator('[data-version-info-key="required-database"]'))
      .toHaveText('Required by the running application');
    if (versionInfo.latest_stable_version) {
      await expect(panel.locator('[data-version-info-value="latest-stable"]'))
        .toHaveText(`v. ${versionInfo.latest_stable_version}`);
    }
    const successTime = versionInfo.last_successful_check_at
      || (versionInfo.update_status !== 'unavailable' ? versionInfo.update_checked_at : '');
    if (successTime && Date.parse(successTime) === Date.parse(versionInfo.update_checked_at)) {
      await expect(panel.locator('[data-version-info-key="checked-successfully"]'))
        .toHaveText('Checked successfully');
      await expect(panel.locator('[data-version-info-key="last-checked"], [data-version-info-key="last-success"]'))
        .toHaveCount(0);
    } else if (versionInfo.update_checked_at) {
      await expect(panel.locator('[data-version-info-key="last-checked"]')).toHaveText('Last check attempt');
    }

    // The preceding GET may have performed the upstream check: respect its cooldown.
    await expect(checkAgainButton).toBeEnabled({ timeout: 35_000 });
    const forcedCheckResponsePromise = page.waitForResponse((candidate) => {
      const request = candidate.request();
      return request.method() === 'POST'
        && new URL(candidate.url()).pathname === '/api/admin/version-info';
    });
    await checkAgainButton.click();
    const forcedCheckResponse = await forcedCheckResponsePromise;
    expect(forcedCheckResponse.status()).toBe(200);
    const forcedVersionInfo = await forcedCheckResponse.json();
    expect(typeof forcedVersionInfo.upstream_check_performed).toBe('boolean');
    await expect(checkAgainButton).toHaveText('Check releases');
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-version-info-value="application"]'))
      .toHaveText(`v. ${versionInfo.app_version}`);

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
    await expect(indicator).toHaveAttribute(
      'title',
      new RegExp(
        `${escapedProductName} v\\. ${versionInfo.app_version}.*Database v\\. ${versionInfo.db_version}`,
        's',
      ),
    );

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

// Native browser proofs use mocked release responses, so GitHub availability
// cannot change the evidence under test. Other application APIs remain real.
for (const [language, theme, osTheme] of [
  ['fi', 'light', 'dark'], ['en', 'dark', 'light'],
  ['fi', 'dark', 'light'], ['en', 'light', 'dark'],
] as const) {
  test(`release facts, retained failure and focus: ${language}, ${theme}, OS ${osTheme}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.metadata?.screenWidth !== 'desktop', 'One project drives its own viewports.');
    await login(page, loadCredentials());
    await page.addInitScript(({ language }) => {
      localStorage.setItem('chosen_language', language);
    }, { language });
    await page.emulateMedia({ colorScheme: osTheme });
    const time = '2026-10-09T09:00:00Z';
    const releaseURL = 'https://github.com/kanilmari/filterest/releases/tag/v99.0.1';
    const initial = {
      product_name: 'Filterest', app_version: '99.0.0', db_version: '9.10.2',
      required_db_version: '9.10.2', db_compatible: true, runtime_mode: 'native',
      latest_stable_version: '99.0.1', latest_release_url: releaseURL,
      update_status: 'available', update_available: true, upstream_check_performed: true,
      update_checked_at: time, last_successful_check_at: time, refresh_allowed_at: '',
    };
    let checks = 0;
    await page.route('**/api/admin/version-info', async (route) => {
      if (route.request().method() !== 'POST') return route.fulfill({ json: initial });
      checks += 1;
      if (checks === 1) return route.abort('failed');
      return route.fulfill({ json: { ...initial, update_status: 'current', update_available: false,
        update_checked_at: '2026-10-09T09:00:01Z', last_successful_check_at: '2026-10-09T09:00:01Z',
        refresh_allowed_at: '2026-10-09T09:00:03Z' } });
    });
    await page.reload();
    await navigateToDefaultDataset(page); await openActiveFilterbarIfCollapsed(page);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    // A signed-in account's theme replaces a stored one during start-up, so switch the explicit application theme only
    // after the view exists (as E6 does), against the opposite OS preference emulated above.
    await page.evaluate(selected => {
      document.body.classList.toggle('light-mode', selected === 'light');
      document.body.classList.toggle('dark-mode', selected === 'dark');
    }, theme);
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
    await page.clock.install({ time: new Date(time) });
    const indicator = page.locator('.tab_parts_container:visible [data-testid="filterbar-admin-version-info"]').first();
    await indicator.click();
    const panel = page.locator('[data-testid="filterbar-admin-version-info-panel"]:visible');
    const check = panel.locator('[data-testid="filterbar-admin-version-check-again"]');
    const fact = (id: string) => panel.locator(`[data-version-info-value="${id}"]`);
    await expect(check).toHaveText(language === 'fi' ? 'Tarkista julkaisut' : 'Check releases');
    await expect(fact('latest-stable')).toHaveText('v. 99.0.1');
    await expect(panel.locator('button')).toHaveCount(1);
    await expect(panel.locator('[data-testid="filterbar-admin-update-preview-open"], section, code, tfoot')).toHaveCount(0);
    await expect(panel.locator('.filterbar-clock-bar__version-operator-guidance')).toHaveText(language === 'fi'
      ? 'Päivitykset tekee toistaiseksi sivuston ylläpitäjä palvelimella.'
      : 'Updates are currently performed by the site operator.');
    await expect(fact('checked-successfully')).toHaveCount(1);
    await expect(fact('last-checked')).toHaveCount(0); await expect(fact('last-success')).toHaveCount(0);
    expect(await panel.locator('[data-version-info-value]').evaluateAll(cells => {
      const keys = cells.map(cell => (cell as HTMLElement).dataset.versionInfoValue);
      return new Set(keys).size === keys.length;
    })).toBe(true);
    expect(await panel.textContent()).toMatch(language === 'fi' ? /päivitys saatavilla/ : /update available/);

    await page.clock.fastForward(1000);
    await check.focus(); await check.click();
    await expect(fact('check-state')).toContainText(language === 'fi' ? 'vanhentunut' : 'stale');
    await expect(fact('latest-stable')).toHaveText('v. 99.0.1');
    await expect(fact('latest-stable').locator('a')).toHaveAttribute('href', releaseURL);
    await expect(fact('last-success')).toHaveCount(1); await expect(fact('last-checked')).toHaveCount(1);
    await expect(fact('checked-successfully')).toHaveCount(0); await expect(check).toBeFocused();
    await expect(indicator).not.toHaveClass(/version-info--update-available/);
    const staleCells = await panel.locator('[data-version-info-value]').evaluateAll(cells =>
      cells.filter(cell => /stale|vanhentunut/.test(cell.textContent || '')).map(cell =>
        (cell as HTMLElement).dataset.versionInfoValue));
    expect(staleCells).toEqual(['check-state']);

    await check.click();
    await expect(fact('check-result')).toHaveText(language === 'fi' ? 'ajan tasalla' : 'up to date');
    await expect(fact('checked-successfully')).toHaveCount(1);
    await expect(check).toBeDisabled(); await expect(panel).toBeFocused();
    expect(checks).toBe(2);
    await page.clock.fastForward(2000);
    await expect(check).toBeEnabled(); await expect(check).toBeFocused();

    for (const viewport of [{ width: 1280, height: 768 }, { width: 320, height: 280 }]) {
      await page.setViewportSize(viewport);
      await expect.poll(() => panel.evaluate(element => {
        const box = element.getBoundingClientRect();
        return box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
      })).toBe(true);
      await testInfo.attach(`release-check-${language}-${theme}-os-${osTheme}-${viewport.width}`, {
        body: await panel.screenshot(), contentType: 'image/png',
      });
    }
    await page.keyboard.press('Escape'); await expect(indicator).toBeFocused();
    await expect(panel).toHaveCount(0);
  });
}

test('does not build the release panel when its route permission is absent', async ({ page }, testInfo) => {
  test.skip(testInfo.project.metadata?.screenWidth !== 'desktop', 'Permission gating needs one project.');
  await login(page, loadCredentials());
  await page.route('**/api/user-permissions', async (route) => {
    const response = await route.fetch();
    const permissions = await response.json();
    await route.fulfill({ json: { ...permissions,
      endpoints: permissions.endpoints.filter((endpoint: string) => endpoint !== '/api/admin/version-info') } });
  });
  let versionRequests = 0;
  await page.route('**/api/admin/version-info', async (route) => {
    versionRequests += 1; await route.abort();
  });
  await page.evaluate(() => sessionStorage.removeItem('user_permissions'));
  await page.reload(); await navigateToDefaultDataset(page); await openActiveFilterbarIfCollapsed(page);
  await expect(page.locator('.tab_parts_container:visible [data-testid="filterbar-admin-version-info"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="filterbar-admin-version-info-panel"]')).toHaveCount(0);
  expect(versionRequests).toBe(0);
});
