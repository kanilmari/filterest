/**
 * E10_site_identity_and_menu_contract.spec.ts
 *
 * Verifies branded dataset headings, valid filterbar tool groups, and the
 * stable surface-owned menu buttons across wide/narrow dataset and article views.
 * Exists so site identity moves out of the navbar without disappearing from
 * dataset pages or making hidden menu controls reachable.
 */

import { test, expect, type Page } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDefaultDataset } from '../helpers/navigation';
import { switchToView, openBigCard } from '../helpers/view-switch';
import { waitForActiveFilterbarLayout } from '../helpers/filterbar';
import { ensureNavbarVisible } from '../helpers/navbar';
import { installHomePolicy } from '../helpers/home-policy-fixture';

async function navigateToReadyDefaultDataset(page: Page): Promise<void> {
  // Root may show the optional Home page, which has no dataset filterbar.
  // Finish that startup before selecting a dataset and awaiting its layout.
  await page.waitForFunction(() => (window as Window & {
    __filterestShellBoot?: { status: () => { ready: boolean } };
  }).__filterestShellBoot?.status().ready === true);
  await navigateToDefaultDataset(page);
  await waitForActiveFilterbarLayout(page);
}

test.describe('E10 — Site identity and menu contract', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    // Keep existing dataset proofs deterministic without saving account appearance.
    await page.route(url => url.pathname === '/api/user-visual-preference', async route => {
      expect(route.request().method()).toBe('GET');
      await route.fulfill({ json: { theme_mode: 'light', revision: 1, configured: true } });
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(() => localStorage.setItem('theme', 'light'));
    await login(page, credentials);
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`Home shares the full-height menu and top-left control in ${theme}`, async ({ page }) => {
      await installHomePolicy(page.context(), theme);
      await page.route(url => url.pathname === '/api/user-visual-preference', async route => {
        expect(route.request().method()).toBe('GET');
        await route.fulfill({ json: { theme_mode: theme, revision: 1, configured: true } });
      });
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await page.addInitScript(theme => {
        localStorage.setItem('theme', theme); localStorage.setItem('chosen_language', 'fi');
        localStorage.setItem('navVisibleWide', 'true'); localStorage.setItem('navVisibleNarrow', 'true');
      }, theme);
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('.front-page-top-row')).toBeVisible();
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
      await ensureNavbarVisible(page);
      const host = page.viewportSize()!.width <= 700 ? '.front-page-phone-topbar' : '.front-page-top-row';
      const slot = page.locator(`${host} .dataset-shared-topbar__menu-slot`);
      const opener = slot.locator('#showMenuButton'), closer = page.locator('#navbar #hideMenuButton');
      // Home uses the dataset drawer from viewport top, with its own top-left closer.
      await expect(opener).toBeHidden(); await expect(closer).toBeVisible();
      await expect.poll(() => page.locator('#navbar').evaluate(element => {
        const box = element.getBoundingClientRect();
        return Math.abs(box.top) <= 1 && Math.abs(box.height - innerHeight) <= 1;
      })).toBe(true);
      await expect.poll(() => closer.evaluate(element => {
        const box = element.getBoundingClientRect();
        return Math.abs(box.x - 12) <= 1 && Math.abs(box.y - 12) <= 1;
      })).toBe(true);
      const closeBox = (await closer.boundingBox())!;
      expect(closeBox.x).toBeCloseTo(12, 0); expect(closeBox.y).toBeCloseTo(12, 0);
      await expect(page.locator('#showMenuButton:visible, #hideMenuButton:visible')).toHaveCount(1);
      expect(await slot.evaluate(element => element.getBoundingClientRect().width)).toBe(0);
      await closer.focus(); await closer.press('Space');
      await expect(page.locator('#navbar')).toHaveClass(/\bcollapsed\b/);
      await expect(opener).toBeVisible(); await expect(opener).toBeFocused();
      await expect.poll(() => opener.evaluate((element, position) => {
        const box = element.getBoundingClientRect();
        return Math.abs(box.x - position.x) <= 1 && Math.abs(box.y - position.y) <= 1;
      }, { x: closeBox.x, y: closeBox.y })).toBe(true);
      await expect(closer).toBeHidden();
      if (page.viewportSize()!.width <= 700) {
        await page.locator('.front-page-scroller').evaluate(element => { element.scrollTop = 100; });
        await expect.poll(() => page.locator('.front-page-scroller').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
        expect((await page.locator('.front-page-phone-topbar').boundingBox())!.y).toBeCloseTo(0, 0);
        await opener.press('Enter'); await expect(closer).toBeFocused();
        await closer.press('Enter'); await expect(opener).toBeFocused();
      }
      await expect(page.locator('#showMenuButton:visible, #hideMenuButton:visible')).toHaveCount(1);
      await expect(slot).toHaveJSProperty('inert', false);
      await expect(slot).toHaveAttribute('aria-hidden', 'false');
      await expect(opener).toHaveAttribute('aria-hidden', 'false');
      await expect(opener).toHaveAttribute('tabindex', '0');
      await expect(closer).toHaveAttribute('aria-hidden', 'true');
      await expect(closer).toHaveAttribute('tabindex', '-1');
      await opener.press('Enter'); await ensureNavbarVisible(page);
      await expect(closer).toBeFocused();
      await expect(slot).toHaveJSProperty('inert', true);
    });
  }

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
    await navigateToReadyDefaultDataset(page);

    const siteName = String(
      await page.locator('meta[property="og:site_name"]').getAttribute('content') || '',
    ).trim();
    expect(siteName).not.toBe('');

    const hero = page.locator('.tab_parts_container:visible .morphing-title').first();
    const datasetTitle = String(
      await hero.locator('.morphing-title__dataset-name').textContent() || '',
    ).trim();
    expect(datasetTitle).not.toBe('');
    if (datasetTitle.toLocaleLowerCase().startsWith(siteName.toLocaleLowerCase())) {
      // A dataset whose own title already opens with the site name must not be branded
      // a second time; the heading still names the site, once.
      await expect(hero.locator('.morphing-title__site-name')).toHaveCount(0);
      await expect(hero.locator('.morphing-title__separator')).toHaveCount(0);
    } else {
      const renderedSiteName = String(
        await hero.locator('.morphing-title__site-name').textContent() || '',
      ).trim();
      expect(renderedSiteName.toLocaleLowerCase()).toBe(siteName.toLocaleLowerCase());
      await expect(hero.locator('.morphing-title__separator')).toHaveText(' – ');
    }
    await expect(page.locator('.navbar-site-identity')).toHaveCount(0);

    const heroHeader = page
      .locator('.tab_parts_container:visible .morphing-header:visible')
      .first();
    const heroGeometry = await heroHeader.evaluate((headerElement) => {
      const header = headerElement.getBoundingClientRect();
      const content = headerElement.parentElement;
      const searchPanel = content?.querySelector<HTMLElement>('.dataset-search-panel');
      return {
        declaredMaxWidth: window.getComputedStyle(headerElement).maxWidth,
        headerWidth: header.width,
        searchWidth: searchPanel?.getBoundingClientRect().width || 0,
      };
    });
    expect(heroGeometry.declaredMaxWidth).toBe('1200px');
    expect(heroGeometry.headerWidth).toBeGreaterThan(550);
    expect(heroGeometry.headerWidth).toBeLessThanOrEqual(1201);
    expect(heroGeometry.searchWidth).toBeGreaterThan(0);
    expect(heroGeometry.searchWidth).toBeLessThanOrEqual(551);

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
    await navigateToReadyDefaultDataset(page);
    await switchToView(page, 'card');
    expect(await openBigCard(page)).toBe(true);

    const wideTopbar = page.locator('.tab_parts_container:visible .dataset-shared-topbar').first();
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
    await navigateToReadyDefaultDataset(page);
    await switchToView(page, 'card');
    expect(await openBigCard(page)).toBe(true);

    const narrowTopbar = page.locator('.tab_parts_container:visible .dataset-shared-topbar').first();
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
    await expect(page.locator('#navbar')).toBeInViewport({ ratio: 0.95 });
    await expect(navbarMenuButton).toBeVisible();
    // Round 5: phone chrome stays, but the open drawer owns the only menu control.
    await expect(narrowTopbarMenuButton).toBeHidden();
    await expect(narrowTopbarMenuButton).toHaveAttribute('aria-expanded', 'true');
    await expect(narrowTopbarMenuButton).toHaveAttribute('aria-hidden', 'true');
    await expect(narrowTopbarMenuButton).toHaveAttribute('tabindex', '-1');
    await expect(floatingMenuButton).toBeHidden();
    await expect(floatingMenuButton).toHaveAttribute('tabindex', '-1');
    await navbarMenuButton.click();
    await expect(page.locator('#navbar')).toHaveClass(/collapsed/);
    await expect(narrowTopbarMenuButton).toHaveAttribute('aria-expanded', 'false');
    await expect(narrowTopbarMenuButton).toBeVisible();
    await expect(navbarMenuButton).toHaveAttribute('aria-hidden', 'true');
    await expect(navbarMenuButton).toHaveAttribute('tabindex', '-1');
  });

  test('keeps the same physical menu-click contract in the card dataset view', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.metadata?.screenWidth !== 'desktop',
      'This proof drives its own viewport and only needs one project.',
    );

    await page.setViewportSize({ width: 1440, height: 900 });

    await page.evaluate(() => localStorage.setItem('navVisibleNarrow', 'false'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await navigateToReadyDefaultDataset(page);
    await switchToView(page, 'card');

    const floatingMenuButton = page.locator('#showMenuButton');
    const heroMenuButton = page.locator('.tab_parts_container:visible [data-testid="hero-menu-button"]');
    await expect(page.locator('.dataset-shared-topbar--visible')).toHaveCount(0);
    // The visible hero owns the menu opener even when the shared bar is absent.
    await expect(heroMenuButton).toBeVisible();
    await expect(heroMenuButton).toHaveAttribute('aria-expanded', 'false');
    await expect(heroMenuButton).toHaveAttribute('aria-hidden', 'false');
    await expect(heroMenuButton).toHaveAttribute('tabindex', '0');
    await expect(floatingMenuButton).toBeHidden();
    await expect(floatingMenuButton).toHaveClass(/shared-topbar-menu-source-hidden/);
    await expect(floatingMenuButton).toHaveAttribute('aria-hidden', 'true');
    await expect(floatingMenuButton).toHaveAttribute('tabindex', '-1');
    await heroMenuButton.click();
    await expect(page.locator('#navbar')).not.toHaveClass(/collapsed/);
    await expect(page.locator('#navbar')).toBeInViewport({ ratio: 0.95 });
    await expect(page.locator('#hideMenuButton')).toBeVisible();
    await expect(heroMenuButton).toBeHidden();
    await expect(heroMenuButton).toHaveAttribute('aria-hidden', 'true');
    await expect(heroMenuButton).toHaveAttribute('tabindex', '-1');
    await expect(floatingMenuButton).toBeHidden();
    await page.locator('#hideMenuButton').click();
    await expect(page.locator('#navbar')).toHaveClass(/collapsed/);
    await expect(heroMenuButton).toBeVisible();
    await expect(heroMenuButton).toHaveAttribute('aria-expanded', 'false');
    await expect(floatingMenuButton).toBeHidden();
  });
});
