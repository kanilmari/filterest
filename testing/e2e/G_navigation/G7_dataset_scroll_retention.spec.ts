/**
 * G7_dataset_scroll_retention.spec.ts
 *
 * Verifies that switching between already-mounted dataset tabs preserves both
 * the infinite-scroll result set and the user's logical viewport anchor.
 */

import { expect, test, type Page } from '@playwright/test';
import { login } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { switchToView } from '../helpers/view-switch';

type DatasetViewportSnapshot = {
  cardCount: number;
  scrollTop: number;
  anchorId: string;
  anchorOffset: number;
};

async function readServiceCatalogViewport(page: Page): Promise<DatasetViewportSnapshot> {
  return page.evaluate(() => {
    const container = document.getElementById('app_service_catalog_card_view_container');
    if (!(container instanceof HTMLElement)) {
      throw new Error('Service catalog card scroll container is missing.');
    }

    const containerTop = container.getBoundingClientRect().top;
    const cards = Array.from(container.querySelectorAll('.card[data-id]'))
      .filter((candidate): candidate is HTMLElement => candidate instanceof HTMLElement);
    const anchor = cards.find((card) => card.getBoundingClientRect().bottom > containerTop + 1);
    if (!anchor?.dataset.id) {
      throw new Error('Could not resolve the top visible service catalog card.');
    }

    return {
      cardCount: cards.length,
      scrollTop: container.scrollTop,
      anchorId: anchor.dataset.id,
      anchorOffset: anchor.getBoundingClientRect().top - containerTop,
    };
  });
}

test.describe('G7 — Dataset tab scroll retention', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('keeps loaded cards and the logical viewport anchor across dataset tabs', async ({ page }, testInfo) => {
    test.skip(!['desktop-card', 'firefox'].includes(testInfo.project.name));
    await page.setViewportSize({ width: 2200, height: 1200 });

    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');
    await switchToView(page, 'card');

    const serviceContainer = page.locator('#app_service_catalog_card_view_container');
    await expect(serviceContainer).toBeVisible({ timeout: 10_000 });

    const initialCardCount = await serviceContainer.locator('.card[data-id]').count();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await serviceContainer.hover();
      await page.mouse.wheel(0, 4_000);
      if (await serviceContainer.locator('.card[data-id]').count() > initialCardCount) {
        break;
      }
      await page.waitForTimeout(600);
    }
    await expect.poll(
      () => serviceContainer.locator('.card[data-id]').count(),
      { timeout: 10_000 },
    ).toBeGreaterThanOrEqual(initialCardCount);
    await expect.poll(
      () => serviceContainer.evaluate((element) => element.scrollTop),
      { timeout: 5_000 },
    ).toBeGreaterThan(0);

    const beforeSwitch = await readServiceCatalogViewport(page);
    const retainedNodeCount = await serviceContainer.locator('.card[data-id]').evaluateAll((cards) => {
      cards.forEach((card, index) => {
        Object.defineProperty(card, '__datasetScrollRetentionProof', {
          configurable: true,
          value: `retained-${index}`,
        });
      });
      return cards.length;
    });

    await page.locator('[data-testid="tab-system_users"]:visible').first().click();
    await waitForDataLoaded(page, 'system_users');
    await expect(page.locator('#system_users_container')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="tab-app_service_catalog"]:visible').first().click();
    await expect(serviceContainer).toBeVisible({ timeout: 10_000 });

    const afterSwitch = await readServiceCatalogViewport(page);
    const retainedNodesAfterSwitch = await serviceContainer.locator('.card[data-id]').evaluateAll((cards) => (
      cards.filter((card, index) => (
        (card as HTMLElement & { __datasetScrollRetentionProof?: string })
          .__datasetScrollRetentionProof === `retained-${index}`
      )).length
    ));
    expect(afterSwitch.cardCount).toBe(beforeSwitch.cardCount);
    expect(retainedNodesAfterSwitch).toBe(retainedNodeCount);
    expect(afterSwitch.anchorId).toBe(beforeSwitch.anchorId);
    expect(afterSwitch.anchorOffset).toBeCloseTo(beforeSwitch.anchorOffset, 0);
    expect(afterSwitch.scrollTop).toBeCloseTo(beforeSwitch.scrollTop, 0);
  });
});
