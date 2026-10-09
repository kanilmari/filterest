// image-first-article.ts
// Supports C10's field-role setup, image activation and visual contract assertions.
// Connects revision-aware appearance writes and the real image-first article DOM.
// Keeps the browser proof within file limits while retaining its existing assertions.
import { expect, type Locator, type Page } from '@playwright/test';
import { saveCardVisibilityWithFreshRevisions } from './appearance-revisions';

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

export async function postJsonWithCsrf(
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

export async function configureArticleFieldRoles(page: Page, datasetName: string): Promise<void> {
  await saveCardVisibilityWithFreshRevisions(page.request, datasetName, visibility => {
    const columns = visibility.columns;
    const roles: Record<string, string> = {
      title: 'header',
      description: 'description',
      detail_note: 'details',
    };
    const configuredColumns = columns.map(column => {
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
          column => column.column_name === requiredColumn,
        ),
        `Temporary dataset is missing required column metadata for "${requiredColumn}".`,
      ).toBe(true);
    }

    return {
      card_details_layout: visibility.card_details_layout,
      card_style_variant: visibility.card_style_variant,
      columns: configuredColumns,
    };
  });
}

export async function closeArticleToCardView(page: Page): Promise<void> {
  const closeButton = page
    .locator('[data-testid="shared-topbar-article-close"]:visible')
    .first();
  await expect(closeButton).toBeVisible({ timeout: 10_000 });
  await closeButton.click();
  await expect(page.locator('[data-testid="big-card-container"]:visible')).toHaveCount(0, {
    timeout: 10_000,
  });
}

export async function captureImageFirstOverlayReveal(
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

/** Verify the image modal's visual contract without duplicating the test's data lifecycle. */
export async function assertImageFirstVisualContract(page: Page, stage: Locator, viewportHeight: number): Promise<void> {
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
  expect(Math.abs(visualContract.imageHeight - viewportHeight)).toBeLessThanOrEqual(1);
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
}
