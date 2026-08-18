/**
 * E10_site_identity_and_menu_contract.spec.ts
 *
 * Verifies branded dataset headings, valid filterbar tool groups, and the
 * stable surface-owned menu buttons across wide/narrow dataset and article views.
 * Exists so site identity moves out of the navbar without disappearing from
 * dataset pages or making hidden menu controls reachable.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDefaultDataset } from '../helpers/navigation';
import { switchToView, openBigCard } from '../helpers/view-switch';

test.describe('E10 — Site identity and menu contract', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('shows the dynamic site–dataset heading and keeps sidebar groups structurally valid', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.metadata?.screenWidth !== 'desktop',
      'This proof drives a wide viewport and only needs one project.',
    );

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => {
      localStorage.setItem('navVisibleWide', 'true');
      localStorage.setItem('chosen_language', 'en');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await navigateToDefaultDataset(page);

    const siteName = String(
      await page.locator('meta[property="og:site_name"]').getAttribute('content') || '',
    ).trim();
    expect(siteName).not.toBe('');

    const hero = page.locator('.tab_parts_container:visible .morphing-title').first();
    const renderedSiteName = String(
      await hero.locator('.morphing-title__site-name').textContent() || '',
    ).trim();
    expect(renderedSiteName.toLocaleLowerCase()).toBe(siteName.toLocaleLowerCase());
    await expect(hero.locator('.morphing-title__separator')).toHaveText(' – ');
    await expect(hero.locator('.morphing-title__dataset-name')).not.toHaveText('');
    await expect(page.locator('.navbar-site-identity')).toHaveCount(0);

    const sectionHeadings = {
      filters: { key: 'filterbar_filter_results', label: 'Filter results' },
      tools: { key: 'filterbar_add_manage_content', label: 'Add & manage content' },
      views: { key: 'filterbar_view_content_as', label: 'View content as…' },
      field_sets: { key: 'filterbar_select_visible_fields', label: 'Select visible fields' },
    } as const;
    for (const [sectionKey, heading] of Object.entries(sectionHeadings)) {
      const section = page
        .locator(`.tab_parts_container:visible [data-filterbar-section-key="${sectionKey}"]`)
        .first();
      await expect(section).toBeVisible();
      const header = section.locator('.animated-disclosure-header');
      await expect(header.locator(`[data-lang-key="${heading.key}"]`)).toHaveText(
        heading.label,
      );
      const content = section.locator(':scope > .animated-disclosure-content-shell');
      const expanded = await header.getAttribute('aria-expanded');
      expect(['true', 'false']).toContain(expanded);
      if (expanded === 'true') {
        await expect(content).toBeVisible();
      } else {
        await expect(content).toBeHidden();
      }
    }
  });

  test('uses real Chromium clicks on stable menu buttons in wide and narrow article views', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.metadata?.screenWidth !== 'desktop',
      'This proof drives both responsive layouts and only needs one project.',
    );

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => localStorage.setItem('navVisibleWide', 'true'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await navigateToDefaultDataset(page);
    await switchToView(page, 'card');
    expect(await openBigCard(page)).toBe(true);

    const wideTopbar = page.locator('.dataset-shared-topbar--visible').first();
    const floatingMenuButton = page.locator('#showMenuButton');
    const navbarMenuButton = page.locator('#hideMenuButton');
    const wideTopbarMenuButton = wideTopbar.locator(
      '[data-testid="shared-topbar-menu-button"]',
    );
    const wideTopbarMenuSlot = wideTopbar.locator(
      '.dataset-shared-topbar__menu-slot',
    );
    const wideDatasetTitle = wideTopbar.locator(
      '.dataset-shared-topbar__dataset-title',
    );
    await expect(wideTopbar).toBeVisible();
    await expect(navbarMenuButton).toBeVisible();
    await expect(floatingMenuButton).toBeHidden();
    await expect(wideTopbarMenuButton).toBeHidden();
    await expect(wideTopbar.locator('#showMenuButton')).toHaveCount(0);
    await expect(page.locator('#showMenuButton')).toHaveCount(1);

    const wideBadge = navbarMenuButton.locator('.environment-badge');
    await expect(wideBadge).toBeVisible();
    const wideMenuGeometry = await navbarMenuButton.evaluate((element) => {
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

    const collapsedMenuSlotGeometry = await wideTopbarMenuSlot.evaluate((slot) => {
      const slotRect = slot.getBoundingClientRect();
      const titleRect = slot.nextElementSibling?.getBoundingClientRect();
      const styles = getComputedStyle(slot);
      return {
        slotWidth: slotRect.width,
        titleOffsetFromSlot: (titleRect?.left ?? slotRect.left) - slotRect.left,
        transitionProperty: styles.transitionProperty,
        transitionDuration: styles.transitionDuration,
      };
    });
    expect(collapsedMenuSlotGeometry.slotWidth).toBeLessThan(0.5);
    expect(collapsedMenuSlotGeometry.transitionProperty).toContain('flex-basis');
    expect(collapsedMenuSlotGeometry.transitionDuration).toContain('0.26s');

    await navbarMenuButton.click();
    await expect(page.locator('#navbar')).toHaveClass(/collapsed/);
    await expect(wideTopbarMenuButton).toBeVisible();
    await expect(floatingMenuButton).toBeHidden();

    const partialRevealGeometry = await wideTopbarMenuSlot.evaluate(async (slot) => {
      const transitions = slot.getAnimations().filter(
        (animation) => 'transitionProperty' in animation,
      );
      transitions.forEach((animation) => {
        animation.pause();
        animation.currentTime = 80;
      });
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const slotRect = slot.getBoundingClientRect();
      const button = slot.querySelector<HTMLElement>(
        '[data-testid="shared-topbar-menu-button"]',
      );
      const buttonRect = button?.getBoundingClientRect();
      const farPointElements = buttonRect
        ? document.elementsFromPoint(buttonRect.left + 35, buttonRect.top + 22)
        : [];
      const result = {
        slotWidth: slotRect.width,
        clipPath: getComputedStyle(slot).clipPath,
        hiddenButtonAreaIsHitTestable: Boolean(
          button && farPointElements.includes(button),
        ),
      };

      transitions.forEach((animation) => animation.finish());
      return result;
    });
    expect(partialRevealGeometry.slotWidth).toBeGreaterThan(0);
    expect(partialRevealGeometry.slotWidth).toBeLessThan(35);
    expect(partialRevealGeometry.clipPath).not.toBe('none');
    expect(partialRevealGeometry.hiddenButtonAreaIsHitTestable).toBe(false);

    await expect.poll(
      () => wideTopbarMenuSlot.evaluate((slot) => slot.getBoundingClientRect().width),
      { timeout: 1000 },
    ).toBeGreaterThanOrEqual(51.5);
    const expandedMenuSlotGeometry = await wideTopbarMenuSlot.evaluate((slot) => {
      const slotRect = slot.getBoundingClientRect();
      const titleRect = slot.nextElementSibling?.getBoundingClientRect();
      return {
        slotWidth: slotRect.width,
        titleOffsetFromSlot: (titleRect?.left ?? slotRect.left) - slotRect.left,
      };
    });
    expect(expandedMenuSlotGeometry.slotWidth).toBeGreaterThanOrEqual(51.5);
    expect(
      expandedMenuSlotGeometry.titleOffsetFromSlot
        - collapsedMenuSlotGeometry.titleOffsetFromSlot,
    ).toBeGreaterThanOrEqual(51.5);
    await expect(wideDatasetTitle).toBeVisible();

    await wideTopbarMenuButton.click();
    await expect(page.locator('#navbar')).not.toHaveClass(/collapsed/);
    await expect(navbarMenuButton).toBeVisible();
    await expect(wideTopbarMenuButton).toBeHidden();

    await page.setViewportSize({ width: 375, height: 812 });
    await page.evaluate(() => localStorage.setItem('navVisibleNarrow', 'false'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await navigateToDefaultDataset(page);
    await switchToView(page, 'card');
    expect(await openBigCard(page)).toBe(true);

    const narrowTopbar = page.locator('.dataset-shared-topbar--visible').first();
    const narrowTopbarMenuButton = narrowTopbar.locator(
      '[data-testid="shared-topbar-menu-button"]',
    );
    await expect(narrowTopbar).toBeVisible();
    await expect(narrowTopbarMenuButton).toBeVisible();
    await expect(page.locator('#showMenuButton')).toHaveCount(1);
    await expect(floatingMenuButton).toBeHidden();
    await expect(navbarMenuButton).toHaveAttribute('aria-hidden', 'true');
    await expect(navbarMenuButton).toHaveAttribute('tabindex', '-1');

    const narrowBadge = narrowTopbarMenuButton.locator('.environment-badge');
    await expect(narrowBadge).toBeVisible();
    const narrowMenuGeometry = await narrowTopbarMenuButton.evaluate((element) => {
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

    const narrowPosition = await narrowTopbarMenuButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top };
    });
    expect(narrowPosition.left).toBeLessThan(80);
    expect(narrowPosition.top).toBeLessThan(100);

    await narrowTopbarMenuButton.click();
    await expect(page.locator('#navbar')).not.toHaveClass(/collapsed/);
    await expect(navbarMenuButton).toBeVisible();
    await expect(narrowTopbarMenuButton).toBeHidden();
  });

  test('keeps the same physical menu-click contract in the card dataset view', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.metadata?.screenWidth !== 'desktop',
      'This proof drives its own viewport and only needs one project.',
    );

    await page.setViewportSize({ width: 1440, height: 900 });

    await page.evaluate(() => localStorage.setItem('navVisibleNarrow', 'false'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await navigateToDefaultDataset(page);
    await switchToView(page, 'card');

    const floatingMenuButton = page.locator('#showMenuButton');
    await expect(page.locator('.dataset-shared-topbar--visible')).toHaveCount(0);
    await expect(floatingMenuButton).toBeVisible();
    await floatingMenuButton.click();
    await expect(page.locator('#navbar')).not.toHaveClass(/collapsed/);
    await expect(page.locator('#hideMenuButton')).toBeVisible();
    await expect(floatingMenuButton).toBeHidden();
  });
});
