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
): Promise<void> {
  await page.evaluate(
    ({ datasetName, expanded }) => {
      localStorage.setItem(`${datasetName}_sorting_and_filtering_specs`, JSON.stringify({
        sort: { column: null, direction: null },
        filters: {},
        offset: 0,
        cardView: {
          collapsed: expanded,
          expandedId: expanded ? 1 : null,
        },
      }));
    },
    { datasetName, expanded },
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
      seedRows: [{
        title: 'Image-first browser proof',
        description: 'Description after the details disclosure',
        detail_note: 'Article details proof',
      }],
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
      await cardImageActivator.click();

      const imageFirstView = page.locator('[data-testid="image-first-view"]');
      await expect(imageFirstView).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('[data-testid="big-card-container"]')).toHaveCount(0);
      const stage = imageFirstView.locator('[data-testid="row-article-image-first-stage"]');
      await expect(stage).toBeVisible({ timeout: 15_000 });
      await expect(stage.locator('[data-testid="row-article-image-first-media"]')).toBeVisible();
      await expect(stage.locator('[data-testid="row-article-image-previous"]')).toBeDisabled();
      await expect(stage.locator('[data-testid="row-article-image-next"]')).toBeDisabled();
      await expect(stage.locator('[data-testid="row-article-image-scroll-hint"]')).toBeVisible();
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
          articleTitleCenterOffset: Math.abs(
            title.getBoundingClientRect().left
              + (title.getBoundingClientRect().width / 2)
              - (window.innerWidth / 2),
          ),
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
      expect(layout.articleTitleWidth).toBeGreaterThan(800);
      expect(layout.articleTitleWidth).toBeLessThanOrEqual(1201);
      expect(layout.articleTitleCenterOffset).toBeLessThanOrEqual(1);
      expect(layout.hasAutomaticDatasetIcon).toBe(false);
      expect(layout.detailsImmediatelyAfterDescription).toBe(true);
      expect(layout.scrollRange).toBeGreaterThan(0);
      const visualContract = await stage.evaluate((stageElement) => {
        const stageStyle = window.getComputedStyle(stageElement);
        const backdropStyle = window.getComputedStyle(stageElement, '::before');
        const imageFirstView = stageElement.closest<HTMLElement>('.image_first_view');
        const rowNavigation = imageFirstView?.querySelector<HTMLElement>(
          '[data-testid="row-article-row-navigation"]',
        );
        const rowNavigationButton = rowNavigation?.querySelector<HTMLElement>(
          '.row_article_row_navigation_button',
        );
        const media = stageElement
          .querySelector<HTMLElement>('[data-testid="row-article-image-first-media"]');
        return {
          animationName: imageFirstView
            ? window.getComputedStyle(imageFirstView).animationName
            : '',
          animationDuration: imageFirstView
            ? window.getComputedStyle(imageFirstView).animationDuration
            : '',
          backdropImage: backdropStyle.backgroundImage,
          backdropFilter: backdropStyle.filter,
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
        };
      });
      expect(visualContract.animationName).toBe('image-first-view-grow-reveal');
      expect(visualContract.animationDuration).toBe('0.5s');
      expect(visualContract.backdropImage).not.toBe('none');
      expect(visualContract.backdropFilter).toContain('blur(');
      expect(Math.abs(visualContract.imageHeight - layout.viewportHeight)).toBeLessThanOrEqual(1);
      expect(visualContract.imageWidth).toBeLessThan(visualContract.stageWidth);
      expect(visualContract.rowNavigationBackground).toBe('rgba(0, 0, 0, 0)');
      expect(visualContract.rowNavigationPointerEvents).toBe('none');
      expect(visualContract.rowNavigationButtonPointerEvents).toBe('auto');
      expect(visualContract.stageBackground).not.toBe('rgba(0, 0, 0, 0)');
      const closeButton = page.locator(
        '.image_modal.image_first_view_modal [data-testid="modal-close-button"]',
      );
      await closeButton.hover();
      await page.waitForTimeout(1_500);
      await expect(closeButton).toHaveCSS('opacity', '1');
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
      await stage.click({ position: { x: 6, y: 6 } });
      await expect(imageFirstView).toBeHidden();
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
