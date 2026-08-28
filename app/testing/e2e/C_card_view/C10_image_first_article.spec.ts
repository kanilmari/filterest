/**
 * C10_image_first_article.spec.ts
 *
 * Verifies the always-available image-first view in a real browser.
 * Bridges a throwaway image-enabled dataset, ordinary article upload,
 * card-image activation, and the separate full-viewport image modal.
 */

import { test, expect, type Page } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';

type JsonResponse = {
  status: number;
  ok: boolean;
  body: string;
};

type OverlayRevealSample = {
  elapsed: number;
  opacity: number;
  viewOpacity: number;
  background: string;
  backdropFilter: string;
  titleOpacity: number;
  animationProgress: number | null;
  viewAnimationProgress: number | null;
  applicationBlurProgress: number | null;
  titleAnimationProgress: number | null;
};

async function fetchCsrfToken(page: Page): Promise<string> {
  const response = await page.evaluate(async () => {
    const result = await fetch('/api/csrf-token', { credentials: 'include' });
    return {
      ok: result.ok,
      body: await result.text(),
    };
  });
  expect(response.ok, `Failed to fetch CSRF token for C10: ${response.body}`).toBe(true);

  const csrfToken = JSON.parse(response.body)?.csrf_token;
  if (typeof csrfToken !== 'string' || csrfToken.trim() === '') {
    throw new Error('Missing csrf_token in /api/csrf-token response for C10.');
  }
  return csrfToken;
}

async function postJsonWithCsrf(
  page: Page,
  url: string,
  payload: Record<string, unknown>,
): Promise<JsonResponse> {
  const csrfToken = await fetchCsrfToken(page);
  return page.evaluate(
    async ({ csrfToken, payload, url }) => {
      const result = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(payload),
      });
      return {
        status: result.status,
        ok: result.ok,
        body: await result.text(),
      };
    },
    { csrfToken, payload, url },
  );
}

async function configureArticleFieldRoles(page: Page, datasetName: string): Promise<void> {
  const visibilityResponse = await page.evaluate(async (targetDataset) => {
    const result = await fetch(`/api/card-visibility/${encodeURIComponent(targetDataset)}`, {
      credentials: 'include',
    });
    return {
      ok: result.ok,
      body: await result.text(),
    };
  }, datasetName);
  expect(
    visibilityResponse.ok,
    `Failed to read card field metadata for C10: ${visibilityResponse.body}`,
  ).toBe(true);

  const visibility = JSON.parse(visibilityResponse.body);
  const columns = Array.isArray(visibility?.columns) ? visibility.columns : [];
  const roles: Record<string, string> = {
    title: 'header',
    description: 'description',
    detail_note: 'details',
  };
  const configuredColumns = columns.map((column: Record<string, unknown>) => {
    const columnName = String(column.column_name || '');
    if (!roles[columnName]) {
      return column;
    }
    return {
      ...column,
      card_element: roles[columnName],
      show_value_on_card: true,
      hide_on_big_card: false,
    };
  });

  for (const requiredColumn of Object.keys(roles)) {
    expect(
      configuredColumns.some(
        (column: Record<string, unknown>) => column.column_name === requiredColumn,
      ),
      `Temporary dataset is missing required column metadata for "${requiredColumn}".`,
    ).toBe(true);
  }

  const updateResponse = await postJsonWithCsrf(page, '/api/card-visibility/update', {
    table_name: datasetName,
    card_details_layout: visibility.card_details_layout,
    card_style_variant: visibility.card_style_variant,
    columns: configuredColumns,
  });
  expect(
    updateResponse.ok,
    `Failed to configure C10 article field roles: ${updateResponse.body}`,
  ).toBe(true);
}

async function setExpandedCardState(
  page: Page,
  datasetName: string,
  expanded: boolean,
  expandedRowId = 1,
): Promise<void> {
  await page.evaluate(
    ({ datasetName, expanded, expandedRowId }) => {
      localStorage.setItem(`${datasetName}_sorting_and_filtering_specs`, JSON.stringify({
        sort: { column: null, direction: null },
        filters: {},
        offset: 0,
        cardView: {
          collapsed: expanded,
          expandedId: expanded ? expandedRowId : null,
        },
      }));
    },
    { datasetName, expanded, expandedRowId },
  );
}

async function closeArticleToCardView(page: Page): Promise<void> {
  const closeButton = page
    .locator('[data-testid="shared-topbar-article-close"]:visible')
    .first();
  await expect(closeButton).toBeVisible({ timeout: 10_000 });
  await closeButton.click();
  await expect(page.locator('[data-testid="big-card-container"]:visible')).toHaveCount(0, {
    timeout: 10_000,
  });
}

async function captureImageFirstOverlayReveal(
  page: Page,
  activatorSelector: string,
): Promise<OverlayRevealSample[]> {
  return page.evaluate(async (selector) => {
    const activator = document.querySelector<HTMLElement>(selector);
    if (!activator) throw new Error('Image-first activator was not found.');

    const overlayReady = new Promise<HTMLElement>((resolve) => {
      const findVisibleOverlay = () => {
        const overlay = document.querySelector<HTMLElement>(
          '.modal_overlay.image_first_view_overlay',
        );
        return overlay && window.getComputedStyle(overlay).display !== 'none'
          ? overlay
          : null;
      };
      const current = findVisibleOverlay();
      if (current) {
        resolve(current);
        return;
      }
      const observer = new MutationObserver(() => {
        const overlay = findVisibleOverlay();
        if (!overlay) return;
        observer.disconnect();
        resolve(overlay);
      });
      observer.observe(document.body, {
        attributes: true,
        attributeFilter: ['class', 'style'],
        childList: true,
        subtree: true,
      });
    });

    activator.click();
    const overlay = await overlayReady;
    const stage = overlay.querySelector<HTMLElement>(
      '[data-testid="row-article-image-first-stage"]',
    );
    if (!stage) throw new Error('Image-first stage was not found inside the overlay.');
    const view = overlay.querySelector<HTMLElement>('.image_first_view');
    const revealCluster = overlay.querySelector<HTMLElement>(
      '[data-testid="row-article-image-first-reveal-cluster"]',
    );
    if (!view || !revealCluster) {
      throw new Error('Image-first view or reveal cluster was not found inside the overlay.');
    }
    const revealAnimations = overlay.getAnimations({ subtree: true });
    const animation = revealAnimations.find(
      (candidate) => candidate.animationName === 'image-first-backdrop-reveal',
    );
    const viewAnimation = revealAnimations.find(
      (candidate) => candidate.animationName === 'image-first-foreground-grow',
    );
    const applicationBlurAnimation = revealAnimations.find(
      (candidate) => candidate.animationName === 'image-first-application-blur-reveal',
    );
    const titleAnimation = revealAnimations.find(
      (candidate) => candidate.animationName === 'image-first-reveal-title',
    );
    if (!animation || !viewAnimation || !applicationBlurAnimation || !titleAnimation) {
      throw new Error('Image-first reveal animations were not found.');
    }
    animation.pause();
    viewAnimation.pause();
    applicationBlurAnimation.pause();
    titleAnimation.pause();

    const sample = (elapsed: number) => {
      const backdropStyle = window.getComputedStyle(stage, '::before');
      const revealTitle = overlay.querySelector<HTMLElement>(
        '[data-testid="row-article-image-first-reveal-title"]',
      );
      return {
        elapsed,
        opacity: Number.parseFloat(backdropStyle.opacity),
        viewOpacity: Number.parseFloat(window.getComputedStyle(view).opacity),
        background: backdropStyle.backgroundImage,
        backdropFilter: window.getComputedStyle(overlay).backdropFilter,
        titleOpacity: revealTitle
          ? Number.parseFloat(window.getComputedStyle(revealTitle).opacity)
          : -1,
        animationProgress: animation?.effect?.getComputedTiming().progress ?? null,
        viewAnimationProgress: viewAnimation?.effect?.getComputedTiming().progress ?? null,
        applicationBlurProgress:
          applicationBlurAnimation?.effect?.getComputedTiming().progress ?? null,
        titleAnimationProgress:
          titleAnimation?.effect?.getComputedTiming().progress ?? null,
      };
    };
    const samples = [];
    for (const elapsed of [0, 16, 60, 150, 300]) {
      animation.currentTime = elapsed;
      viewAnimation.currentTime = elapsed;
      applicationBlurAnimation.currentTime = elapsed;
      titleAnimation.currentTime = elapsed;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      samples.push(sample(elapsed));
    }
    return samples;
  }, activatorSelector);
}

test.describe('C10 — Standalone Image-first View', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('card image opens a 100dvh image-first article with bounded, ordered content', async ({ page }, testInfo) => {
    test.skip(
      !['desktop-card', 'firefox'].includes(testInfo.project.name),
      'One desktop project per requested browser provides proof without duplicating temp datasets in the normal matrix.',
    );
    test.setTimeout(90_000);

    const datasetName = buildTempDatasetName('e2e_image_first_article');
    await createTempDataset(page, {
      datasetName,
      columns: {
        id: 'SERIAL',
        title: 'TEXT',
        description: 'TEXT',
        detail_note: 'TEXT',
      },
      seedRows: [
        {
          title: 'Image-first browser proof one',
          description: 'Description after the details disclosure',
          detail_note: 'Article details proof',
        },
        {
          title: 'Image-first browser proof two',
          description: 'Second description after the details disclosure',
          detail_note: 'Article details proof',
        },
      ],
    });

    try {
      const enableImageResponse = await postJsonWithCsrf(
        page,
        '/api/asset-linking/images/enable',
        {
          parent_table: datasetName,
          max_file_size_mb: 10,
        },
      );
      expect(enableImageResponse.status, enableImageResponse.body).toBe(201);

      await configureArticleFieldRoles(page, datasetName);
      // Open the one seeded row once so the real gallery upload path can add
      // its single image. This remains the unchanged ordinary article.
      await setExpandedCardState(page, datasetName, true);
      await openTempDataset(page, datasetName, 'card');
      await expect(page.locator('[data-testid="big-card-container"]')).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.locator('[data-testid="row-article-image-first-stage"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="image-first-view"]')).toHaveCount(0);

      const galleryInput = page.locator('.big_card_image_gallery input[type="file"]').first();
      await galleryInput.setInputFiles({
        name: 'image-first.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
      });
      await expect(page.locator('[data-testid^="big-card-image-thumb-"]').first()).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.locator('[data-testid="row-article-image-first-stage"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="big-card-container"]')).not.toHaveAttribute(
        'data-article-presentation',
        /.+/,
      );

      // Opening the same image from article view must retain the bounded
      // result-set context; record navigation is not a card-thumbnail-only
      // capability.
      await page.locator('[data-testid^="big-card-image-thumb-"]').first().click();
      const articleOriginNavigation = page.locator(
        '[data-testid="row-article-row-navigation"]',
      );
      await expect(articleOriginNavigation).toBeVisible({ timeout: 15_000 });
      const articleOriginRecordButtons = articleOriginNavigation.locator('button');
      await expect(articleOriginRecordButtons).toHaveCount(2);
      await expect.poll(
        () => articleOriginRecordButtons.evaluateAll(
          (buttons) => buttons.some((button) => !(button as HTMLButtonElement).disabled),
        ),
      ).toBe(true);
      await page.locator(
        '.image_modal.image_first_view_modal [data-testid="modal-close-button"]',
      ).click();
      await expect(page.locator('[data-testid="image-first-view"]')).toBeHidden({
        timeout: 2_000,
      });
      await expect(page.locator('[data-testid="big-card-container"]')).toBeVisible();

      await closeArticleToCardView(page);
      // Give the neighboring record its own image so row-to-row navigation can
      // prove the in-place outgoing/incoming handoff in the same modal.
      await setExpandedCardState(page, datasetName, true, 2);
      await openTempDataset(page, datasetName, 'card');
      await expect(page.locator('[data-testid="big-card-container"]')).toBeVisible({
        timeout: 15_000,
      });
      const secondGalleryInput = page.locator(
        '.big_card_image_gallery input[type="file"]',
      ).first();
      await secondGalleryInput.setInputFiles({
        name: 'image-first-second.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64',
        ),
      });
      await expect(page.locator('[data-testid^="big-card-image-thumb-"]').first()).toBeVisible({
        timeout: 15_000,
      });
      await closeArticleToCardView(page);
      await setExpandedCardState(page, datasetName, false);
      await openTempDataset(page, datasetName, 'card');

      const cardImageActivator = page
        .locator(
          `#${datasetName}_card_view_container .card_image [data-image-first-src][role="button"]:visible`,
        )
        .first();
      await expect(cardImageActivator).toBeVisible({ timeout: 15_000 });
      await expect(cardImageActivator.locator('img')).toBeVisible();
      const overlayReveal = await captureImageFirstOverlayReveal(
        page,
        `#${datasetName}_card_view_container .card_image [data-image-first-src][role="button"]`,
      );
      const startOpacity = overlayReveal[0].opacity;
      const earlyOpacity = overlayReveal[2].opacity;
      const middleOpacity = overlayReveal[3].opacity;
      const finalOpacity = overlayReveal[4].opacity;
      const startViewOpacity = overlayReveal[0].viewOpacity;
      const earlyViewOpacity = overlayReveal[2].viewOpacity;
      const middleViewOpacity = overlayReveal[3].viewOpacity;
      const finalViewOpacity = overlayReveal[4].viewOpacity;
      expect(startOpacity).toBe(0);
      expect(earlyOpacity).toBeGreaterThan(0);
      expect(earlyOpacity).toBeLessThan(finalOpacity * 0.35);
      expect(middleOpacity).toBeGreaterThan(finalOpacity * 0.35);
      expect(middleOpacity).toBeLessThan(finalOpacity * 0.65);
      expect(finalOpacity).toBeGreaterThanOrEqual(0.76);
      expect(finalOpacity).toBeLessThanOrEqual(0.8);
      expect(overlayReveal[4].background).not.toBe('none');
      expect(overlayReveal[0].backdropFilter).toContain('blur(0px)');
      expect(overlayReveal[0].applicationBlurProgress).toBe(0);
      expect(overlayReveal[3].applicationBlurProgress).toBeCloseTo(0.5, 1);
      expect(overlayReveal[4].backdropFilter).toContain('blur(12px)');
      expect(overlayReveal[4].applicationBlurProgress).toBe(1);
      expect(overlayReveal[0].titleOpacity).toBe(1);
      expect(overlayReveal[3].titleOpacity).toBe(1);
      expect(overlayReveal[4].titleOpacity).toBe(0);
      expect(startViewOpacity).toBe(1);
      expect(earlyViewOpacity).toBe(1);
      expect(middleViewOpacity).toBe(1);
      expect(finalViewOpacity).toBe(1);

      const imageFirstView = page.locator('[data-testid="image-first-view"]');
      await expect(imageFirstView).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-testid="big-card-container"]')).toHaveCount(0);
      const stage = imageFirstView.locator('[data-testid="row-article-image-first-stage"]');
      await expect(stage).toBeVisible({ timeout: 15_000 });
      await expect(stage.locator('[data-testid="row-article-image-first-media"]')).toBeVisible();
      await expect(stage.locator('[data-testid="row-article-image-previous"]')).toBeDisabled();
      await expect(stage.locator('[data-testid="row-article-image-next"]')).toBeDisabled();
      await expect(stage.locator('[data-testid="row-article-image-scroll-hint"]')).toBeVisible();
      const rowNavigation = page.locator('[data-testid="row-article-row-navigation"]');
      await expect(rowNavigation.locator('[data-testid="row-article-previous-row"]'))
        .toBeDisabled();
      await expect(rowNavigation.locator('[data-testid="row-article-next-row"]'))
        .toBeEnabled();
      await expect(rowNavigation.locator('[data-testid$="-preview-slot"]')).toHaveCount(2);
      await expect.poll(
        () => stage.evaluate(
          (stageElement) => Math.abs(
            stageElement.getBoundingClientRect().height - window.innerHeight,
          ),
        ),
        { timeout: 5_000 },
      ).toBeLessThanOrEqual(1);

      const layout = await imageFirstView.evaluate((viewElement) => {
        const content = viewElement.querySelector<HTMLElement>(
          ':scope > .image_first_view_article_content',
        );
        const imageStage = viewElement.querySelector<HTMLElement>(
          '[data-testid="row-article-image-first-stage"]',
        );
        const scrollSurface = viewElement.closest<HTMLElement>('.modal_body');
        const details = content?.querySelector<HTMLElement>(
          ':scope > .row_article_details_section',
        );
        const description = content?.querySelector<HTMLElement>(
          ':scope > .big_card_description_container',
        );
        const title = content?.querySelector<HTMLElement>(':scope > .big_card_header');
        if (!content || !imageStage || !scrollSurface || !details || !description || !title) {
          throw new Error(
            'Image-first article is missing its scroll surface, content, stage, title, details, or description.',
          );
        }

        return {
          stageHeight: imageStage.getBoundingClientRect().height,
          viewportHeight: window.innerHeight,
          articleWidth: content.getBoundingClientRect().width,
          articleTitleWidth: title.getBoundingClientRect().width,
          articleTitleLeftOffset:
            title.getBoundingClientRect().left - content.getBoundingClientRect().left,
          articleTitleJustification: window.getComputedStyle(title).justifyContent,
          articleTitleTextAlignment: window.getComputedStyle(title).textAlign,
          articleTitleMarginBottom: window.getComputedStyle(title).marginBottom,
          hasAutomaticDatasetIcon: Boolean(
            title.querySelector('.big_card_header_dataset_icon'),
          ),
          detailsImmediatelyAfterDescription: description.nextElementSibling === details,
          scrollRange: scrollSurface.scrollHeight - scrollSurface.clientHeight,
        };
      });

      expect(Math.abs(layout.stageHeight - layout.viewportHeight)).toBeLessThanOrEqual(1);
      expect(layout.articleWidth).toBeGreaterThan(0);
      expect(layout.articleWidth).toBeLessThanOrEqual(801);
      expect(layout.articleTitleWidth).toBeLessThan(layout.articleWidth);
      expect(layout.articleWidth - layout.articleTitleWidth).toBeCloseTo(20, 0);
      expect(layout.articleTitleLeftOffset).toBeCloseTo(10, 0);
      expect(layout.articleTitleJustification).toBe('flex-start');
      expect(layout.articleTitleTextAlignment).toBe('left');
      expect(layout.articleTitleMarginBottom).toBe('30px');
      expect(layout.hasAutomaticDatasetIcon).toBe(false);
      expect(layout.detailsImmediatelyAfterDescription).toBe(true);
      expect(layout.scrollRange).toBeGreaterThan(0);
      const visualContract = await stage.evaluate((stageElement) => {
        const stageStyle = window.getComputedStyle(stageElement);
        const backdropStyle = window.getComputedStyle(stageElement, '::before');
        const imageFirstView = stageElement.closest<HTMLElement>('.image_first_view');
        const revealCluster = stageElement.querySelector<HTMLElement>(
          '[data-testid="row-article-image-first-reveal-cluster"]',
        );
        const revealTitle = stageElement.querySelector<HTMLElement>(
          '[data-testid="row-article-image-first-reveal-title"]',
        );
        const imageFirstModal = stageElement.closest<HTMLElement>('.image_first_view_modal');
        const imageFirstOverlay = imageFirstModal?.closest<HTMLElement>('.modal_overlay');
        const articleContent = stageElement.parentElement?.querySelector<HTMLElement>(
          '.image_first_view_article_content',
        );
        const imageFirstBackdropStyle = imageFirstOverlay
          ? window.getComputedStyle(imageFirstOverlay, '::before')
          : null;
        const rowNavigation = imageFirstModal?.querySelector<HTMLElement>(
          '[data-testid="row-article-row-navigation"]',
        );
        const rowNavigationButton = rowNavigation?.querySelector<HTMLElement>(
          '.row_article_row_navigation_button',
        );
        const media = stageElement
          .querySelector<HTMLElement>('[data-testid="row-article-image-first-media"]');
        return {
          animationName: revealCluster
            ? window.getComputedStyle(revealCluster).animationName
            : '',
          animationDuration: revealCluster
            ? window.getComputedStyle(revealCluster).animationDuration
            : '',
          animationTimingFunction: revealCluster
            ? window.getComputedStyle(revealCluster).animationTimingFunction
            : '',
          foregroundWillChange: revealCluster
            ? window.getComputedStyle(revealCluster).willChange
            : '',
          foregroundBackfaceVisibility: revealCluster
            ? window.getComputedStyle(revealCluster).backfaceVisibility
            : '',
          revealTitleText: revealTitle?.textContent || '',
          revealTitleAriaHidden: revealTitle?.getAttribute('aria-hidden') || '',
          overlayAnimationName: imageFirstBackdropStyle
            ? imageFirstBackdropStyle.animationName
            : '',
          overlayAnimationDuration: imageFirstBackdropStyle
            ? imageFirstBackdropStyle.animationDuration
            : '',
          modalAnimationName: imageFirstModal
            ? window.getComputedStyle(imageFirstModal).animationName
            : '',
          modalAnimationDuration: imageFirstModal
            ? window.getComputedStyle(imageFirstModal).animationDuration
            : '',
          modalAnimationTimingFunction: imageFirstModal
            ? window.getComputedStyle(imageFirstModal).animationTimingFunction
            : '',
          backdropContent: backdropStyle.content,
          backdropImage: backdropStyle.backgroundImage,
          backdropOpacity: backdropStyle.opacity,
          backdropFilter: backdropStyle.filter,
          backdropApplicationFilter: backdropStyle.backdropFilter,
          backdropPosition: backdropStyle.position,
          backdropAnimationName: backdropStyle.animationName,
          backdropAnimationDuration: backdropStyle.animationDuration,
          backdropWillChange: backdropStyle.willChange,
          backdropBackfaceVisibility: backdropStyle.backfaceVisibility,
          overlayBackground: imageFirstBackdropStyle
            ? imageFirstBackdropStyle.backgroundColor
            : '',
          outerOverlayBackground: imageFirstOverlay
            ? window.getComputedStyle(imageFirstOverlay).backgroundColor
            : '',
          outerOverlayBackdropFilter: imageFirstOverlay
            ? window.getComputedStyle(imageFirstOverlay).backdropFilter
            : '',
          modalBackground: imageFirstModal
            ? window.getComputedStyle(imageFirstModal).backgroundColor
            : '',
          modalBackdropFilter: imageFirstModal
            ? window.getComputedStyle(imageFirstModal).backdropFilter
            : '',
          imageHeight: media?.getBoundingClientRect().height || 0,
          imageWidth: media?.getBoundingClientRect().width || 0,
          rowNavigationBackground: rowNavigation
            ? window.getComputedStyle(rowNavigation).backgroundColor
            : '',
          rowNavigationPointerEvents: rowNavigation
            ? window.getComputedStyle(rowNavigation).pointerEvents
            : '',
          rowNavigationButtonPointerEvents: rowNavigationButton
            ? window.getComputedStyle(rowNavigationButton).pointerEvents
            : '',
          stageWidth: stageElement.getBoundingClientRect().width,
          stageBackground: stageStyle.backgroundColor,
          stageBackdropFilter: stageStyle.backdropFilter,
          articleContentOpacity: articleContent
            ? window.getComputedStyle(articleContent).opacity
            : '',
          articleContentFilter: articleContent
            ? window.getComputedStyle(articleContent).filter
            : '',
          articleContentZIndex: articleContent
            ? window.getComputedStyle(articleContent).zIndex
            : '',
        };
      });
      expect(visualContract.animationName).toBe('image-first-foreground-grow');
      expect(visualContract.animationDuration).toBe('0.3s');
      expect(visualContract.animationTimingFunction).toBe('linear');
      expect(visualContract.foregroundWillChange).toBe('transform');
      expect(visualContract.foregroundBackfaceVisibility).toBe('hidden');
      expect(visualContract.revealTitleText.trim()).not.toBe('');
      expect(visualContract.revealTitleAriaHidden).toBe('true');
      expect(visualContract.overlayAnimationName).toBe('none');
      expect(visualContract.overlayAnimationDuration).toBe('0s');
      expect(visualContract.modalAnimationName).toBe('none');
      expect(visualContract.modalAnimationDuration).toBe('0s');
      expect(visualContract.backdropContent).toBe('""');
      expect(visualContract.backdropImage).not.toBe('none');
      expect(Number.parseFloat(visualContract.backdropOpacity)).toBeCloseTo(0.78, 2);
      expect(visualContract.backdropFilter).toContain('blur(48px)');
      expect(visualContract.backdropApplicationFilter).toBe('none');
      expect(visualContract.backdropPosition).toBe('fixed');
      expect(visualContract.backdropAnimationName).toBe('image-first-backdrop-reveal');
      expect(visualContract.backdropAnimationDuration).toBe('0.3s');
      expect(visualContract.backdropWillChange).toBe('opacity');
      expect(visualContract.backdropBackfaceVisibility).toBe('hidden');
      expect(visualContract.overlayBackground).not.toBe('rgba(0, 0, 0, 0.8)');
      expect(visualContract.outerOverlayBackground).toBe('rgba(0, 0, 0, 0)');
      expect(visualContract.outerOverlayBackdropFilter).toContain('blur(12px)');
      expect(visualContract.modalBackground).toBe('rgba(0, 0, 0, 0)');
      expect(visualContract.modalBackdropFilter).toBe('none');
      expect(Math.abs(visualContract.imageHeight - layout.viewportHeight)).toBeLessThanOrEqual(1);
      expect(visualContract.imageWidth).toBeLessThan(visualContract.stageWidth);
      expect(visualContract.rowNavigationBackground).toBe('rgba(0, 0, 0, 0)');
      expect(visualContract.rowNavigationPointerEvents).toBe('none');
      expect(visualContract.rowNavigationButtonPointerEvents).toBe('auto');
      expect(visualContract.stageBackground).toBe('rgba(0, 0, 0, 0)');
      expect(visualContract.stageBackdropFilter).toBe('none');
      expect(visualContract.articleContentOpacity).toBe('1');
      expect(visualContract.articleContentFilter).toBe('none');
      expect(visualContract.articleContentZIndex).toBe('1');
      await page.emulateMedia({ colorScheme: 'dark' });
      const themeContract = await stage.evaluate((stageElement) => {
        const originalBodyClasses = document.body.className;
        const imageFirstOverlay = stageElement
          .closest<HTMLElement>('.image_first_view_modal')
          ?.closest<HTMLElement>('.modal_overlay');
        const captureTheme = (themeClass: 'light-mode' | 'dark-mode') => {
          document.body.classList.remove('light-mode', 'dark-mode', 'system-mode');
          document.body.classList.add(themeClass);
          const backdropStyle = window.getComputedStyle(stageElement, '::before');
          const foreground = stageElement.querySelector<HTMLElement>(
            '[data-testid="row-article-image-first-media"]',
          );
          return {
            backdropImage: backdropStyle.backgroundImage,
            backdropOpacity: backdropStyle.opacity,
            themeScrim: window.getComputedStyle(
              stageElement.closest<HTMLElement>('.image_first_view_modal')!,
            ).getPropertyValue('--image-first-theme-scrim').trim(),
            applicationBlur: imageFirstOverlay
              ? window.getComputedStyle(imageFirstOverlay).backdropFilter
              : '',
            foregroundOpacity: foreground
              ? window.getComputedStyle(foreground).opacity
              : '',
          };
        };

        try {
          return {
            forcedLightOnDarkOperatingSystem: captureTheme('light-mode'),
            explicitDark: captureTheme('dark-mode'),
          };
        } finally {
          document.body.className = originalBodyClasses;
        }
      });
      for (const theme of Object.values(themeContract)) {
        expect(theme.backdropImage).not.toBe('none');
        expect(Number.parseFloat(theme.backdropOpacity)).toBeCloseTo(0.78, 2);
        expect(theme.applicationBlur).toContain('blur(12px)');
        expect(theme.foregroundOpacity).toBe('1');
      }
      expect(themeContract.forcedLightOnDarkOperatingSystem.backdropImage)
        .not.toBe(themeContract.explicitDark.backdropImage);
      expect(themeContract.forcedLightOnDarkOperatingSystem.themeScrim).toContain('78%');
      expect(themeContract.explicitDark.themeScrim).toContain('90%');

      await expect(stage.locator('[data-testid="row-article-image-scroll-hint"]'))
        .not.toHaveAttribute('aria-label', '');

      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      const reducedMotionContract = await stage.evaluate((stageElement) => {
        const view = stageElement.closest<HTMLElement>('.image_first_view');
        const revealCluster = stageElement.querySelector<HTMLElement>(
          '[data-testid="row-article-image-first-reveal-cluster"]',
        );
        const backdropStyle = window.getComputedStyle(stageElement, '::before');
        return {
          foregroundAnimation: revealCluster
            ? window.getComputedStyle(revealCluster).animationName
            : '',
          foregroundOpacity: view ? window.getComputedStyle(view).opacity : '',
          backdropAnimation: backdropStyle.animationName,
          backdropOpacity: backdropStyle.opacity,
          backdropImage: backdropStyle.backgroundImage,
        };
      });
      expect(reducedMotionContract.foregroundAnimation).toBe('none');
      expect(reducedMotionContract.foregroundOpacity).toBe('1');
      expect(reducedMotionContract.backdropAnimation).toBe('none');
      expect(Number.parseFloat(reducedMotionContract.backdropOpacity)).toBeCloseTo(0.78, 2);
      expect(reducedMotionContract.backdropImage).not.toBe('none');
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
      const closeButton = page.locator(
        '.image_modal.image_first_view_modal [data-testid="modal-close-button"]',
      );
      await closeButton.hover();
      await page.waitForTimeout(1_500);
      await expect(closeButton).toHaveCSS('opacity', '1');
      await expect(rowNavigation.locator('[data-testid="row-article-previous-row"]'))
        .toHaveCSS('opacity', '0.52');
      await expect(rowNavigation.locator('[data-testid="row-article-next-row"]'))
        .toHaveCSS('opacity', '1');
      const disabledNextImageButton = stage.locator(
        '[data-testid="row-article-image-next"]',
      );
      await expect(disabledNextImageButton).toBeDisabled();
      await expect(disabledNextImageButton).toHaveCSS('pointer-events', 'auto');
      const disabledButtonBounds = await disabledNextImageButton.boundingBox();
      if (!disabledButtonBounds) {
        throw new Error('Disabled next-image button has no pointer hit area.');
      }
      await page.mouse.click(
        disabledButtonBounds.x + (disabledButtonBounds.width / 2),
        disabledButtonBounds.y + (disabledButtonBounds.height / 2),
      );
      await expect(imageFirstView).toBeVisible();

      const initialRecordTitle = await imageFirstView
        .locator('.big_card_header')
        .innerText();
      await page.evaluate(() => {
        const button = document.querySelector<HTMLButtonElement>(
          '[data-testid="row-article-next-row"]',
        );
        if (!button) throw new Error('Next-record button missing before transition.');
        const tracker = {
          becameDisabled: button.disabled,
          observer: null as MutationObserver | null,
        };
        tracker.observer = new MutationObserver(() => {
          tracker.becameDisabled ||= button.disabled;
        });
        tracker.observer.observe(button, {
          attributes: true,
          attributeFilter: ['disabled'],
        });
        (window as typeof window & { __imageFirstRecordButtonTracker?: typeof tracker })
          .__imageFirstRecordButtonTracker = tracker;
      });
      const recordTransitionSnapshot = page.evaluate(() => new Promise<{
        viewCount: number;
        outgoingAnimation: string;
        incomingAnimation: string;
        incomingBackdropContent: string;
      }>((resolve, reject) => {
        const overlay = document.querySelector<HTMLElement>(
          '.modal_overlay.image_first_view_overlay',
        );
        if (!overlay) {
          reject(new Error('Image-first overlay missing before record navigation.'));
          return;
        }
        const capture = () => {
          if (!overlay.classList.contains('image-first-record-transitioning')) return false;
          const outgoing = overlay.querySelector<HTMLElement>(
            '.image_first_view--outgoing .row_article_image_first_reveal_cluster',
          );
          const incoming = overlay.querySelector<HTMLElement>(
            '.image_first_view--incoming .row_article_image_first_reveal_cluster',
          );
          const incomingStage = overlay.querySelector<HTMLElement>(
            '.image_first_view--incoming .row_article_image_first_stage',
          );
          if (!outgoing || !incoming || !incomingStage) return false;
          resolve({
            viewCount: overlay.querySelectorAll('.image_first_view').length,
            outgoingAnimation: window.getComputedStyle(outgoing).animationName,
            incomingAnimation: window.getComputedStyle(incoming).animationName,
            incomingBackdropContent: window.getComputedStyle(
              incomingStage,
              '::before',
            ).content,
          });
          return true;
        };
        if (capture()) return;
        const observer = new MutationObserver(() => {
          if (!capture()) return;
          observer.disconnect();
        });
        observer.observe(overlay, {
          attributes: true,
          attributeFilter: ['class'],
          childList: true,
          subtree: true,
        });
        window.setTimeout(() => {
          observer.disconnect();
          reject(new Error('Record handoff did not begin within five seconds.'));
        }, 5_000);
      }));
      await rowNavigation.locator('[data-testid="row-article-next-row"]').click();
      const handoff = await recordTransitionSnapshot;
      const outgoingRecordButtonBecameDisabled = await page.evaluate(() => {
        const tracker = (window as typeof window & {
          __imageFirstRecordButtonTracker?: {
            becameDisabled: boolean;
            observer: MutationObserver | null;
          };
        }).__imageFirstRecordButtonTracker;
        tracker?.observer?.disconnect();
        return tracker?.becameDisabled ?? true;
      });
      expect(outgoingRecordButtonBecameDisabled).toBe(false);
      expect(handoff.viewCount).toBe(2);
      expect(handoff.outgoingAnimation).toBe('image-first-record-media-shrink');
      expect(handoff.incomingAnimation).toBe('image-first-record-media-grow');
      expect(handoff.incomingBackdropContent).toBe('none');
      const imageFirstOverlay = page.locator('.modal_overlay.image_first_view_overlay');
      await expect(imageFirstOverlay).not.toHaveClass(
        /image-first-record-transitioning/,
        { timeout: 2_000 },
      );
      await expect(imageFirstView).toHaveCount(1);
      await expect(imageFirstView.locator('.big_card_header')).not.toHaveText(
        initialRecordTitle,
      );
      await expect(rowNavigation.locator('[data-testid="row-article-previous-row"]'))
        .toBeEnabled();
      await expect(rowNavigation.locator('[data-testid="row-article-next-row"]'))
        .toBeDisabled();

      const modalScrollSurface = page.locator('.image_modal.image_first_view_modal .modal_body');
      const initialScrollTop = await modalScrollSurface.evaluate((element) => element.scrollTop);
      await stage.hover();
      await page.mouse.wheel(0, layout.viewportHeight);
      await expect.poll(
        () => modalScrollSurface.evaluate((element) => element.scrollTop),
      ).toBeGreaterThan(initialScrollTop);

      const articleContent = imageFirstView.locator('.image_first_view_article_content');
      await expect(articleContent).toBeInViewport({ ratio: 0.05 });
      await expect(articleContent.locator('.row_article_details_section')).toContainText(
        'Article details proof',
      );
      await modalScrollSurface.evaluate((element) => element.scrollTo({ top: 0 }));
      const clickPoints = await stage.evaluate((stageElement) => {
        const visibleImage = stageElement.querySelector<HTMLElement>(
          '[data-testid="row-article-image-first-media"]',
        );
        if (!visibleImage) {
          throw new Error('Image-first stage is missing its visible image.');
        }
        const stageRect = stageElement.getBoundingClientRect();
        const imageRect = visibleImage.getBoundingClientRect();
        const leftGap = imageRect.left - stageRect.left;
        if (leftGap < 4) {
          throw new Error('Image-first proof image did not leave a clickable side backdrop.');
        }
        return {
          foreground: {
            x: imageRect.left + (imageRect.width / 2),
            y: imageRect.top + (imageRect.height / 2),
          },
          backdrop: {
            x: stageRect.left + (leftGap / 2),
            y: stageRect.top + (stageRect.height / 2),
          },
        };
      });
      await page.mouse.click(clickPoints.foreground.x, clickPoints.foreground.y);
      await expect(imageFirstView).toBeVisible();
      await page.mouse.click(clickPoints.backdrop.x, clickPoints.backdrop.y);
      await expect(imageFirstOverlay).toHaveClass(/image-first-view-closing/);
      const closingContract = await stage.evaluate((stageElement) => {
        const view = stageElement.closest<HTMLElement>('.image_first_view');
        const revealCluster = stageElement.querySelector<HTMLElement>(
          '[data-testid="row-article-image-first-reveal-cluster"]',
        );
        const backdropStyle = window.getComputedStyle(stageElement, '::before');
        return {
          viewAnimationName: view ? window.getComputedStyle(view).animationName : '',
          viewAnimationDuration: view ? window.getComputedStyle(view).animationDuration : '',
          foregroundAnimationName: revealCluster
            ? window.getComputedStyle(revealCluster).animationName
            : '',
          foregroundAnimationDuration: revealCluster
            ? window.getComputedStyle(revealCluster).animationDuration
            : '',
          backdropAnimationName: backdropStyle.animationName,
          backdropAnimationDuration: backdropStyle.animationDuration,
        };
      });
      expect(closingContract.viewAnimationName).toBe('image-first-view-shrink-conceal');
      expect(closingContract.viewAnimationDuration).toBe('0.3s');
      expect(closingContract.foregroundAnimationName).toBe('image-first-foreground-shrink');
      expect(closingContract.foregroundAnimationDuration).toBe('0.3s');
      expect(closingContract.backdropAnimationName).toBe('image-first-backdrop-conceal');
      expect(closingContract.backdropAnimationDuration).toBe('0.3s');
      await expect(imageFirstView).toBeHidden({ timeout: 2_000 });
    } finally {
      if (!page.isClosed()) {
        await postJsonWithCsrf(page, '/api/asset-linking/images/remove', {
          parent_table: datasetName,
          confirm: true,
        }).catch(() => {});
        await dropTempDataset(page, datasetName);
      }
    }
  });
});
