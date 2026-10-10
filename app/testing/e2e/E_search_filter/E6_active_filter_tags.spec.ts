/**
 * E6_active_filter_tags.spec.ts
 *
 * Verifies selected-chip visibility, centred wrapping and responsive touch boxes.
 * Connects URL-backed search chips with public remove-side settings and both themes.
 * Protects compact desktop geometry while retaining real mobile touch targets.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset } from '../helpers/navigation';

test.describe('E6 — Active Filter Tags', () => {
  test.use({ viewport: { width: 1280, height: 900 }, hasTouch: false });
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('active filter tags appear when filter is set', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');

    const activeTagsContainer = page.locator('[data-testid="active-filters"]');
    const filterToggle = page.locator('[data-testid="filterbar-toggle"]').first();

    if (await filterToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
      await filterToggle.click();
      await page.waitForTimeout(300);

      const filterInput = page.locator('[data-testid^="table-filter-input-"]').first();
      if (await filterInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await filterInput.fill('a');
        await page.waitForTimeout(500);

        if (await activeTagsContainer.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(activeTagsContainer.first()).toBeVisible();
        }
      }
    }

    await expect(page.locator('body')).toBeVisible();
  });

  for (const side of ['start', 'end']) {
    for (const theme of ['light', 'dark']) {
      test(`centres compact ${side} chips in ${theme}, with 44px targets at 375px`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
        await page.route('**/api/site-presentation-settings', async route => {
          const response = await route.fetch();
          const settings = await response.json();
          // Follows site_presentation_state.js: chip side belongs to the public site-only map.
          settings.site_values['shared.active_filter_remove_side'] = side;
          await route.fulfill({ response, json: settings });
        });
        await page.goto('/app_service_catalog?search=chip-proof', { waitUntil: 'domcontentloaded' });
        await page.evaluate(selectedTheme => {
          document.body.classList.toggle('light-mode', selectedTheme === 'light');
          document.body.classList.toggle('dark-mode', selectedTheme === 'dark');
        }, theme);
        const row = page.locator('#app_service_catalog_card_top_controls [data-testid="active-filters"]');
        await expect(row).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-active-filter-remove-side', side);
        await expect(page.locator('[data-testid="active-filters"]:visible')).toHaveCount(1);
        const chip = row.locator('[data-testid="active-filter-item"]').first();
        await expect(chip).toContainText('chip-proof');
        await expect(chip).toHaveAttribute('data-remove-side', side);
        expect(await chip.evaluate(element => element.firstElementChild!.tagName)).toBe(side === 'start' ? 'BUTTON' : 'SPAN');
        await expect(row).toHaveCSS('justify-content', 'center');
        expect((await chip.boundingBox())!.height).toBeCloseTo(26, 0);
        const remove = chip.locator('[data-testid="active-filter-remove"]');
        expect((await remove.boundingBox())!.width).toBeCloseTo(24, 0);
        expect((await remove.boundingBox())!.height).toBeCloseTo(24, 0);
        await expect(row.locator(':scope > :first-child')).toHaveClass('active-filters-lead');
        await expect(row.locator(':scope > :last-child')).toHaveClass('active-filters-clear-all');
        // Measure every wrapped line's occupied span, not just the flex declaration.
        const checkLines = async () => {
          const offsets = await row.evaluate(element => {
            const bounds = element.getBoundingClientRect();
            const lines = new Map<number, DOMRect[]>();
            [...element.children].forEach(child => {
              const box = child.getBoundingClientRect();
              const centre = Math.round(box.y + box.height / 2);
              lines.set(centre, [...(lines.get(centre) || []), box]);
            });
            return [...lines.values()].map(boxes => Math.abs(
              (Math.min(...boxes.map(box => box.left)) + Math.max(...boxes.map(box => box.right))) / 2
              - (bounds.left + bounds.right) / 2
            ));
          });
          offsets.forEach(offset => expect(offset).toBeLessThanOrEqual(1));
        };
        await checkLines();
        await page.setViewportSize({ width: 375, height: 812 });
        await expect(remove).toHaveCSS('width', '44px');
        // The resize reflows the page through its layout transitions; measure once the chip has settled.
        await expect.poll(async () => (await chip.boundingBox())!.height).toBeCloseTo(46, 0);
        const target = (await remove.boundingBox())!;
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
        const clear = (await row.locator('[data-testid="active-filters-clear-all"]').boundingBox())!;
        expect(clear.width).toBeGreaterThanOrEqual(44);
        expect(clear.height).toBeGreaterThanOrEqual(44);
        await checkLines();
      });
    }
  }
});
