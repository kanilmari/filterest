/**
 * E11_filterbar_persistence_and_article_seam.spec.ts
 *
 * Verifies filterbar state survives reloads and article chrome keeps its intended spacing.
 * Bridges persisted filterbar settings with live article-panel browser geometry.
 * Exists to prevent reload regressions, duplicate top seams, and lost content insets.
 */

import { test, expect, type Locator, type Page } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDefaultDataset, waitForDataLoaded } from '../helpers/navigation';
import { switchToView, openBigCard } from '../helpers/view-switch';

const SECTION_KEY = 'field_sets';

type FilterbarLayout = {
  section_order: string[];
  section_collapsed: Record<string, boolean>;
};

async function callFilterbarLayoutEndpoint(
  page: Page,
  routeName: 'getFilterbarSectionLayout' | 'saveFilterbarSectionLayout',
  layout?: FilterbarLayout,
): Promise<FilterbarLayout> {
  return page.evaluate(async ({ requestedRoute, requestedLayout }) => {
    const { endpoint_router } = await import(
      '/frontend/core_components/endpoints/endpoint_router.js'
    );
    return endpoint_router(requestedRoute, {
      method: requestedRoute === 'getFilterbarSectionLayout' ? 'GET' : 'POST',
      ...(requestedLayout ? { body_data: requestedLayout } : {}),
    });
  }, { requestedRoute: routeName, requestedLayout: layout });
}

async function readActiveDatasetName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const activeParts = Array.from(
      document.querySelectorAll<HTMLElement>('.tab_parts_container'),
    ).find((element) => {
      const style = getComputedStyle(element);
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && element.getClientRects().length > 0;
    });
    const suffix = '_tab_parts_container';
    if (!activeParts?.id.endsWith(suffix)) {
      throw new Error('Active dataset container is missing.');
    }
    return activeParts.id.slice(0, -suffix.length);
  });
}

async function toggleDisclosureAndWaitForSave(page: Page, header: Locator) {
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().endsWith('/api/filterbar-section-layout/save')
        && response.request().method() === 'POST'
        && response.ok(),
      { timeout: 10000 },
    ),
    header.click(),
  ]);
}

test.describe('E11 — Filterbar persistence and article seam', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('keeps a committed table search across F5 while the admin session remains active', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.metadata?.screenWidth !== 'desktop'
        || testInfo.project.metadata?.cardView !== 'normal',
      'This persistence proof only needs one desktop project.',
    );

    await navigateToDefaultDataset(page);
    await waitForDataLoaded(page);
    const searchInput = page.locator(
      '.tab_parts_container:visible [data-dataset-search-input]:visible',
    ).first();
    await expect(searchInput).toBeVisible();
    await searchInput.fill('title');
    await searchInput.press('Enter');
    await expect(page).toHaveURL(/(?:\?|&)search=title(?:&|$)/);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForDataLoaded(page);
    await expect(page.locator(
      '.tab_parts_container:visible [data-dataset-search-input]:visible',
    ).first()).toHaveValue('title');
    await expect(page).toHaveURL(/(?:\?|&)search=title(?:&|$)/);
  });

  test('restores the visible panel and an opened section across F5 and viewport classes', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.metadata?.screenWidth !== 'desktop'
        || testInfo.project.metadata?.cardView !== 'normal',
      'This persistence proof drives both viewport classes and only needs one project.',
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToDefaultDataset(page);
    await waitForDataLoaded(page);
    const datasetName = await readActiveDatasetName(page);
    const originalLayout = await callFilterbarLayoutEndpoint(
      page,
      'getFilterbarSectionLayout',
    );

    try {
      await page.evaluate((datasetName) => {
        localStorage.setItem(`${datasetName}_filterbar_visible`, 'true');
        localStorage.removeItem(`${datasetName}_filterbar_visible_wide`);
        localStorage.removeItem(`${datasetName}_filterbar_visible_narrow`);
      }, datasetName);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await navigateToDefaultDataset(page);
      await waitForDataLoaded(page);

      const panel = page.locator('.tab_parts_container:visible .filterbar-panel').first();
      const section = panel.locator(`[data-filterbar-section-key="${SECTION_KEY}"]`);
      const header = section.locator(':scope > .animated-disclosure-header');
      await expect(panel).not.toHaveClass(/filterbar-panel--hidden/);
      await expect(header).toBeVisible();

      if (!(await section.evaluate((element) => element.classList.contains('is-collapsed')))) {
        await toggleDisclosureAndWaitForSave(page, header);
      }
      await toggleDisclosureAndWaitForSave(page, header);
      await expect(header).toHaveAttribute('aria-expanded', 'true');

      await page.reload({ waitUntil: 'domcontentloaded' });
      await navigateToDefaultDataset(page);
      await waitForDataLoaded(page);
      await expect(
        page.locator('.tab_parts_container:visible .filterbar-panel').first(),
      ).not.toHaveClass(/filterbar-panel--hidden/);
      await expect(
        page.locator(
          `.tab_parts_container:visible [data-filterbar-section-key="${SECTION_KEY}"] > .animated-disclosure-header`,
        ).first(),
      ).toHaveAttribute('aria-expanded', 'true');

      await page.setViewportSize({ width: 800, height: 900 });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForDataLoaded(page);
      await expect(
        page.locator('.tab_parts_container:visible .filterbar-panel').first(),
      ).not.toHaveClass(/filterbar-panel--hidden/);
    } finally {
      await callFilterbarLayoutEndpoint(
        page,
        'saveFilterbarSectionLayout',
        originalLayout,
      );
    }
  });

  test('joins both article panes directly to the shared top bar', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.metadata?.screenWidth !== 'desktop'
        || testInfo.project.metadata?.cardView !== 'normal',
      'This geometry proof drives its own wide viewport and only needs one project.',
    );

    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => localStorage.setItem('navVisibleWide', 'true'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await navigateToDefaultDataset(page);
    await switchToView(page, 'card');
    expect(await openBigCard(page)).toBe(true);

    const geometry = await page.evaluate(() => {
      const topbar = document.querySelector<HTMLElement>(
        '.content_div:not(.hidden) .dataset-shared-topbar--visible',
      );
      const sidebar = document.querySelector<HTMLElement>(
        '.content_div:not(.hidden) .card_view_wrapper.big-card-open .card_sidebar_panel',
      );
      const article = document.querySelector<HTMLElement>(
        '.content_div:not(.hidden) .card_view_wrapper.big-card-open .big_card_container',
      );
      if (!topbar || !sidebar || !article) {
        throw new Error('Missing shared top bar, selector rail, or article panel.');
      }

      const topbarRect = topbar.getBoundingClientRect();
      const sidebarRect = sidebar.getBoundingClientRect();
      const articleRect = article.getBoundingClientRect();
      const contentBody = topbar.parentElement?.querySelector<HTMLElement>('.tab-content-body');
      const scrollable = sidebar.closest<HTMLElement>('.scrollable_content');
      const wrapper = sidebar.closest<HTMLElement>('.card_view_wrapper.big-card-open');
      const controls = scrollable?.querySelector<HTMLElement>(':scope > .card_top_controls');
      return {
        topbarTop: topbarRect.top,
        topbarBottom: topbarRect.bottom,
        contentBodyTop: contentBody?.getBoundingClientRect().top ?? -1,
        scrollableTop: scrollable?.getBoundingClientRect().top ?? -1,
        wrapperTop: wrapper?.getBoundingClientRect().top ?? -1,
        controlsDisplay: controls ? getComputedStyle(controls).display : '',
        controlsHeight: controls?.getBoundingClientRect().height ?? -1,
        sidebarGap: sidebarRect.top - topbarRect.bottom,
        articleGap: articleRect.top - topbarRect.bottom,
        sidebarBorderTop: getComputedStyle(sidebar).borderTopWidth,
        articleBorderTop: getComputedStyle(article).borderTopWidth,
      };
    });

    expect(Math.abs(geometry.sidebarGap)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geometry.articleGap)).toBeLessThanOrEqual(0.5);
    expect(geometry.sidebarBorderTop).toBe('0px');
    expect(geometry.articleBorderTop).toBe('0px');
  });

  test('draws article toolbars full-width while keeping text safely inset', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.metadata?.screenWidth !== 'desktop'
        || testInfo.project.metadata?.cardView !== 'normal',
      'This article-width proof drives one wide normal-card project.',
    );

    await page.setViewportSize({ width: 1920, height: 1080 });
    await navigateToDefaultDataset(page);
    await switchToView(page, 'card');
    expect(await openBigCard(page)).toBe(true);
    await expect(page.locator(
      '.content_div:not(.hidden) .row_article_related_items_section '
        + '.row_article_disclosure_content',
    ).first()).toBeAttached({ timeout: 10000 });

    const geometry = await page.evaluate(() => {
      const article = document.querySelector<HTMLElement>(
        '.content_div:not(.hidden) .row_article_container.active_row_article',
      );
      const content = article?.querySelector<HTMLElement>(':scope > .row_article_content');
      const toolbar = content?.querySelector<HTMLElement>('.row_article_disclosure_header');
      const text = content?.querySelector<HTMLElement>(
        ':scope > .big_card_header, :scope > .big_card_description_container',
      );
      const actionBar = article?.querySelector<HTMLElement>(':scope > .big_card_action_bar');
      if (!article || !content || !toolbar || !text || !actionBar) {
        throw new Error('Missing article content, toolbar, text, or action bar.');
      }

      const contentRect = content.getBoundingClientRect();
      const toolbarRect = toolbar.getBoundingClientRect();
      const textRect = text.getBoundingClientRect();
      const titleValue = text.querySelector<HTMLElement>('.big_card_header_value');
      const titleValueRect = titleValue?.getBoundingClientRect();
      const textInnerRect = text.firstElementChild?.getBoundingClientRect();
      const actionBarRect = actionBar.getBoundingClientRect();
      const imageContent = content.querySelector<HTMLElement>(
        '.row_article_image_gallery_section .row_article_disclosure_content',
      );
      const relatedContent = content.querySelector<HTMLElement>(
        '.row_article_related_items_section .row_article_disclosure_content',
      );
      const relatedSection = relatedContent?.closest<HTMLElement>(
        '.row_article_related_items_section',
      );
      const relatedHeader = relatedSection?.querySelector<HTMLElement>(
        ':scope > .row_article_disclosure_header',
      );
      const relatedTabBar = relatedContent?.querySelector<HTMLElement>(
        ':scope > .child_tabs_bar',
      );
      const activeRelatedTab = relatedTabBar?.querySelector<HTMLElement>(
        ':scope > .child_tab_button.active',
      );
      const commentsPanel = relatedContent?.querySelector<HTMLElement>('.comments_tab_panel');
      if (!relatedContent || !relatedHeader || !relatedTabBar || !activeRelatedTab || !commentsPanel) {
        throw new Error('Missing related-row disclosure header, tab bar, active tab, or comments panel.');
      }

      const relatedContentRect = relatedContent.getBoundingClientRect();
      const relatedHeaderRect = relatedHeader.getBoundingClientRect();
      const relatedTabBarRect = relatedTabBar.getBoundingClientRect();
      const relatedContentStyle = getComputedStyle(relatedContent);
      const activeRelatedTabStyle = getComputedStyle(activeRelatedTab);
      const commentsPanelStyle = getComputedStyle(commentsPanel);
      const relatedContentPaddingLeft = Number.parseFloat(relatedContentStyle.paddingLeft);
      const relatedContentPaddingRight = Number.parseFloat(relatedContentStyle.paddingRight);
      return {
        toolbarLeftGap: toolbarRect.left - contentRect.left,
        toolbarRightGap: contentRect.right - toolbarRect.right,
        actionLeftGap: actionBarRect.left - contentRect.left,
        actionRightGap: contentRect.right - actionBarRect.right,
        textLeftGap: textRect.left - contentRect.left,
        textInnerLeftGap: (textInnerRect?.left ?? textRect.left) - contentRect.left,
        titleTopGap: (titleValueRect?.top ?? textRect.top) - contentRect.top,
        textPaddingTop: Number.parseFloat(getComputedStyle(text).paddingTop),
        textPaddingLeft: Number.parseFloat(getComputedStyle(text).paddingLeft),
        imageContentPaddingLeft: imageContent
          ? Number.parseFloat(getComputedStyle(imageContent).paddingLeft)
          : null,
        relatedContentPaddingLeft,
        relatedTabsTopGap: relatedTabBarRect.top - relatedHeaderRect.bottom,
        relatedTabsLeftGap:
          relatedTabBarRect.left - relatedContentRect.left - relatedContentPaddingLeft,
        relatedTabsRightGap:
          relatedContentRect.right - relatedContentPaddingRight - relatedTabBarRect.right,
        relatedContentPaddingTop: Number.parseFloat(relatedContentStyle.paddingTop),
        relatedContentBorderTop: relatedContentStyle.borderTopWidth,
        relatedContentMarginTop: relatedContentStyle.marginTop,
        activeRelatedTabBorderRadius: activeRelatedTabStyle.borderRadius,
        activeRelatedTabBorderBottom: activeRelatedTabStyle.borderBottomWidth,
        activeRelatedTabBackground: activeRelatedTabStyle.backgroundColor,
        activeRelatedTabFontWeight: activeRelatedTabStyle.fontWeight,
        commentsPanelPaddingBottom: Number.parseFloat(commentsPanelStyle.paddingBottom),
        commentsPanelOverflow: commentsPanelStyle.overflow,
        actionBorderTop: getComputedStyle(actionBar).borderTopWidth,
      };
    });

    expect(Math.abs(geometry.toolbarLeftGap)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geometry.toolbarRightGap)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geometry.actionLeftGap)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geometry.actionRightGap)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geometry.textLeftGap)).toBeLessThanOrEqual(0.5);
    expect(geometry.textPaddingTop).toBe(19);
    expect(geometry.textPaddingLeft).toBe(16);
    expect(geometry.textInnerLeftGap).toBeGreaterThanOrEqual(15.5);
    expect(geometry.titleTopGap).toBeGreaterThanOrEqual(18.5);
    expect(geometry.titleTopGap).toBeLessThanOrEqual(19.5);
    expect(geometry.relatedContentPaddingLeft).toBe(16);
    expect(Math.abs(geometry.relatedTabsTopGap)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geometry.relatedTabsLeftGap)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(geometry.relatedTabsRightGap)).toBeLessThanOrEqual(0.5);
    expect(geometry.relatedContentPaddingTop).toBe(0);
    expect(geometry.relatedContentBorderTop).toBe('0px');
    expect(geometry.relatedContentMarginTop).toBe('0px');
    expect(geometry.activeRelatedTabBorderRadius).toBe('0px');
    expect(geometry.activeRelatedTabBorderBottom).toBe('2px');
    expect(geometry.activeRelatedTabBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(Number.parseInt(geometry.activeRelatedTabFontWeight, 10)).toBeGreaterThanOrEqual(700);
    expect(geometry.commentsPanelPaddingBottom).toBeGreaterThanOrEqual(21.5);
    expect(geometry.commentsPanelOverflow).toBe('visible');
    if (geometry.imageContentPaddingLeft !== null) {
      expect(geometry.imageContentPaddingLeft).toBe(16);
    }
    expect(geometry.actionBorderTop).toBe('1px');
  });
});
