/**
 * G3_tab_reorder.spec.ts
 *
 * Verifies that dragging a tab to a new position performs a reorder without errors.
 */

import { test, expect, type Page, type Response } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { waitForAppReady } from '../helpers/navigation';
import { ensureNavbarVisible } from '../helpers/navbar';

type RelativeDropPosition = 'before' | 'after';

type NativeTabDragResult = {
  updateOrderResponse: Promise<Response | null>;
};

const SHARED_TAB_ORDER_PROJECT = 'desktop-card';

async function readTabOrder(page: Page): Promise<string[]> {
  return page.locator('#navmenu .navtablinks[data-id]').evaluateAll((tabs) =>
    tabs
      .map((tab) => tab.getAttribute('data-id'))
      .filter((tabId): tabId is string => Boolean(tabId)),
  );
}

function moveTabRelativeToTarget(
  order: string[],
  sourceId: string,
  targetId: string,
  position: RelativeDropPosition,
): string[] {
  const reordered = order.filter((tabId) => tabId !== sourceId);
  const targetIndex = reordered.indexOf(targetId);
  if (targetIndex < 0) {
    throw new Error(`Target tab "${targetId}" was not present in the tab order.`);
  }
  reordered.splice(targetIndex + (position === 'after' ? 1 : 0), 0, sourceId);
  return reordered;
}

async function dragTabRelativeToTarget(
  page: Page,
  sourceId: string,
  targetId: string,
  position: RelativeDropPosition,
): Promise<NativeTabDragResult> {
  const source = page
    .locator(`#navmenu .navtablinks[data-id=${JSON.stringify(sourceId)}]:visible`)
    .first();
  const target = page
    .locator(`#navmenu .navtablinks[data-id=${JSON.stringify(targetId)}]:visible`)
    .first();
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  await expect(source).toHaveAttribute('draggable', 'true');
  await expect(target).toHaveAttribute('draggable', 'true');
  await source.scrollIntoViewIfNeeded();
  await expect(source).toBeInViewport();
  await target.scrollIntoViewIfNeeded();
  await expect(target).toBeInViewport();

  const targetBox = await target.boundingBox();
  expect(targetBox, `Target tab "${targetId}" must have a layout box`).not.toBeNull();

  const layout = await target.evaluate((targetTab) => {
    const container = targetTab.closest('#navmenu');
    if (!(container instanceof HTMLElement)) {
      throw new Error('Target tab was not inside #navmenu.');
    }
    const tabs = Array.from(container.querySelectorAll<HTMLElement>('.navtablinks'));
    return {
      vertical: tabs.some((tab) => String(tab.dataset.tabPresentation || '').startsWith('button')),
      rtl: getComputedStyle(container).direction === 'rtl',
    };
  });

  const edgeInset = 1;
  const targetPosition = layout.vertical
    ? {
        x: targetBox!.width / 2,
        y: position === 'after' ? targetBox!.height - edgeInset : edgeInset,
      }
    : {
        x: position === 'after'
          ? (layout.rtl ? edgeInset : targetBox!.width - edgeInset)
          : (layout.rtl ? targetBox!.width - edgeInset : edgeInset),
        y: targetBox!.height / 2,
      };

  const updateOrderResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/update-tab-order') &&
      response.request().method() === 'POST',
    { timeout: 15000 },
  ).catch(() => null);

  await source.dragTo(target, { targetPosition });
  return { updateOrderResponse };
}

async function expectSuccessfulTabOrderUpdate(
  updateOrderResponse: Promise<Response | null>,
  evidenceLabel: string,
): Promise<void> {
  const response = await updateOrderResponse;
  expect(
    response,
    `${evidenceLabel}: DOM order changed but no POST /api/update-tab-order response was observed`,
  ).not.toBeNull();
  expect(
    response!.ok(),
    `${evidenceLabel}: tab order update failed with HTTP ${response!.status()}`,
  ).toBe(true);
}

test.describe('G3 — Tab Reorder', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
    await waitForAppReady(page);
    await ensureNavbarVisible(page);
  });

  test('tab drag-and-drop reorders tabs', async ({ page }) => {
    test.skip(
      test.info().project.name !== SHARED_TAB_ORDER_PROJECT,
      `Shared tab order is mutated only by ${SHARED_TAB_ORDER_PROJECT} to avoid cross-project races.`,
    );

    const tabs = page.locator('#navmenu .navtablinks[draggable="true"][data-testid^="tab-"]:visible:not([data-id="user"]):not([data-id="system_users"]):not([data-id="logout"]):not([data-id="system_about"]):not([data-id="login"]):not([data-id="register"])');
    await expect.poll(
      () => tabs.count(),
      { timeout: 10000, message: 'Need at least two visible draggable data tabs' },
    ).toBeGreaterThanOrEqual(2);

    const originalOrder = await readTabOrder(page);
    const draggableDataTabIds = await tabs.evaluateAll((elements) =>
      elements
        .map((element) => element.getAttribute('data-id'))
        .filter((tabId): tabId is string => Boolean(tabId)),
    );

    const sourceId = draggableDataTabIds[0];
    const targetId = draggableDataTabIds[draggableDataTabIds.length - 1];
    expect(sourceId, 'The first draggable data tab must expose data-id').toBeTruthy();
    expect(targetId, 'The last draggable data tab must expose data-id').toBeTruthy();
    expect(sourceId, 'The reorder drag needs distinct source and target tabs').not.toBe(targetId);

    const sourceOriginalIndex = originalOrder.indexOf(sourceId);
    expect(
      sourceOriginalIndex,
      'The source data tab must be present in the complete tab order',
    ).toBeGreaterThanOrEqual(0);
    const sourceOriginalSuccessorId = originalOrder[sourceOriginalIndex + 1];
    expect(
      sourceOriginalSuccessorId,
      'The first data tab must have an original successor for deterministic restoration',
    ).toBeTruthy();
    const expectedReorderedOrder = moveTabRelativeToTarget(
      originalOrder,
      sourceId,
      targetId,
      'after',
    );

    try {
      const reorder = await dragTabRelativeToTarget(page, sourceId, targetId, 'after');
      expect(
        await readTabOrder(page),
        'Native drag must reorder the DOM immediately before persistence is evaluated',
      ).toEqual(expectedReorderedOrder);
      await expectSuccessfulTabOrderUpdate(reorder.updateOrderResponse, 'Reorder');
    } finally {
      if (!page.isClosed()) {
        const currentOrder = await readTabOrder(page);
        if (JSON.stringify(currentOrder) !== JSON.stringify(originalOrder)) {
          const restoration = await dragTabRelativeToTarget(
            page,
            sourceId,
            sourceOriginalSuccessorId,
            'before',
          );
          expect(
            await readTabOrder(page),
            'The restoring native drag must immediately recover the exact original DOM order',
          ).toEqual(originalOrder);
          await expectSuccessfulTabOrderUpdate(restoration.updateOrderResponse, 'Restoration');
        }
      }
    }
  });
});
