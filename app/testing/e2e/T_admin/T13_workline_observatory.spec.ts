/**
 * T13_workline_observatory.spec.ts
 *
 * Verifies the private V1 board against the canonical native application.
 * Bridges authenticated navigation with aligned workline, phase, and release-target rows.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';

test.describe('T13 — Workline observatory', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
    await page.evaluate(() => {
      window.localStorage.removeItem('easelect.workline-observatory.selection.v1');
    });
  });

  test('aligns every current-phase row with one release-target row', async ({ page }) => {
    await page.goto('/admin/workline_observatory', { waitUntil: 'domcontentloaded' });

    const board = page.locator('.workline-observatory__board');
    await expect(board).toBeVisible();
    const nowHeading = page.locator('.workline-observatory__now');
    await expect(nowHeading).toBeVisible();

    const worklines = page.locator('.workline-observatory__workline-row');
    const tracks = page.locator('.workline-observatory__track');
    const targets = page.locator('.workline-observatory__target-row');
    const worklineCount = await worklines.count();
    const openWorklineCount = await worklines.evaluateAll((rows) => rows.filter((row) => {
      const status = row.getAttribute('data-lifecycle-status');
      return status === 'active' || status === 'paused';
    }).length);

    expect(worklineCount).toBeGreaterThan(0);
    await expect(nowHeading).toHaveText(`NOW (${openWorklineCount})`);
    await expect(tracks).toHaveCount(worklineCount);
    await expect(targets).toHaveCount(worklineCount);
    await expect(page.locator('.workline-observatory__detail')).toBeVisible();
    for (let index = 0; index < worklineCount; index += 1) {
      const phaseNodes = tracks.nth(index).locator('.workline-observatory__phase-node');
      const phaseLabels = await phaseNodes.allTextContents();
      expect(phaseLabels.slice(-6)).toEqual(['1', '2', '3', '4', '5', '6']);
      const lifecycle = await worklines.nth(index).getAttribute('data-lifecycle-status');
      const currentNode = tracks.nth(index).locator('.workline-observatory__phase-node[data-current="true"]');
      if (lifecycle === 'closed' || lifecycle === 'archived') {
        await expect(currentNode).toHaveCount(0);
        await expect(phaseNodes).toHaveCount(6);
        await expect(phaseNodes.nth(0)).toHaveCSS('grid-column-start', '1');
        await expect(phaseNodes.nth(5)).toHaveCSS('grid-column-start', '6');
        expect(await phaseNodes.evaluateAll((nodes) => nodes.every((node) => node.getAttribute('data-state') === 'completed'))).toBe(true);
      } else {
        await expect(currentNode).toHaveCount(1);
        await expect(currentNode).toHaveCSS('grid-column-start', '7');
      }
      await expect(targets.nth(index)).not.toHaveText('');
    }
  });

  test('supports multi-selection, pointer context actions, and a confirmation gate', async ({ page }) => {
    await page.goto('/admin/workline_observatory', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.workline-observatory__board')).toBeVisible();

    const rows = page.locator('.workline-observatory__workline-row');
    const labels = page.locator('.workline-observatory__workline-button');
    const checkboxes = page.locator('.workline-observatory__workline-checkbox');
    expect(await rows.count()).toBeGreaterThan(1);

    const selectionToggle = page.locator('.workline-observatory__selection-toggle');
    await expect(selectionToggle).not.toBeChecked();
    await selectionToggle.click();
    await expect(page.locator('.workline-observatory__selection-count')).toHaveText(`${await rows.count()} selected`);
    await expect(selectionToggle).toBeChecked();
    await selectionToggle.click();
    await expect(page.locator('.workline-observatory__selection-count')).toHaveText('');
    await expect(selectionToggle).not.toBeChecked();

    await page.locator('[data-selection-action="select-all"]').click();
    await expect(selectionToggle).toBeChecked();
    await page.locator('[data-selection-action="deselect-all"]').click();
    await expect(selectionToggle).not.toBeChecked();

    const initialRowBoxes = await rows.evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }));
    const toolbar = page.locator('.workline-observatory__status-toolbar');
    const initialToolbarHeight = await toolbar.evaluate((element) => element.getBoundingClientRect().height);

    const firstTitleBox = await labels.nth(0).locator('.workline-observatory__workline-title').boundingBox();
    const firstCheckboxBox = await checkboxes.nth(0).boundingBox();
    expect(firstTitleBox).not.toBeNull();
    expect(firstCheckboxBox).not.toBeNull();
    await page.mouse.click(
      ((firstTitleBox?.x ?? 0) + (firstTitleBox?.width ?? 0) + (firstCheckboxBox?.x ?? 0)) / 2,
      (firstCheckboxBox?.y ?? 0) + (firstCheckboxBox?.height ?? 0) / 2,
    );
    await expect(checkboxes.nth(0)).toBeChecked();
    const selectedRowBoxes = await rows.evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    }));
    expect(selectedRowBoxes).toEqual(initialRowBoxes);
    expect(await toolbar.evaluate((element) => element.getBoundingClientRect().height)).toBe(initialToolbarHeight);

    const firstTitle = (await labels.nth(0).locator('.workline-observatory__workline-title').textContent())?.trim() ?? '';
    const firstLifecycle = await rows.nth(0).getAttribute('data-lifecycle-status');
    const targetStatus = firstLifecycle === 'paused' ? 'active' : 'paused';
    const targetStateLabel = targetStatus === 'active' ? 'Active' : 'Paused';
    const targetAction = page.locator(`.workline-observatory__status-actions [data-status-action="${targetStatus}"]`);
    await expect(targetAction).toBeEnabled();
    await expect(targetAction).toHaveAttribute('title', `Move “${firstTitle}” to ${targetStateLabel}.`);
    await checkboxes.nth(0).uncheck();

    const firstLabelBox = await labels.nth(0).boundingBox();
    const firstTrackBox = await page.locator('.workline-observatory__track').nth(0).boundingBox();
    await page.mouse.click(
      ((firstLabelBox?.x ?? 0) + (firstLabelBox?.width ?? 0) + (firstTrackBox?.x ?? 0)) / 2,
      (firstTrackBox?.y ?? 0) + (firstTrackBox?.height ?? 0) / 2,
    );
    await expect(checkboxes.nth(0)).toBeChecked();
    await checkboxes.nth(1).check();
    await expect(page.locator('.workline-observatory__selection-count')).toContainText('2');
    await expect(page.locator('.workline-observatory__status-actions [data-status-action="closed"]'))
      .toHaveAttribute('title', /^Move all 2 selected worklines to Done(?:; 1 already have that state)?\.$/);
    const selectionBackground = await rows.nth(0)
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(selectionBackground).not.toBe('rgba(0, 0, 0, 0)');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.workline-observatory__board')).toBeVisible();
    await expect(page.locator('.workline-observatory__workline-checkbox').nth(0)).toBeChecked();
    await expect(page.locator('.workline-observatory__workline-checkbox').nth(1)).toBeChecked();
    await expect(page.locator('.workline-observatory__selection-count')).toContainText('2');

    await page.evaluate(() => {
      document.body.classList.remove('dark-mode');
      document.body.classList.add('light-mode');
    });
    await page.waitForTimeout(180);
    const contextRow = page.locator('.workline-observatory__workline-row').nth(1);
    const contextRowBox = await contextRow.boundingBox();
    expect(contextRowBox).not.toBeNull();
    await contextRow.click({ button: 'right', position: { x: 40, y: 30 } });
    const contextMenu = page.locator('.workline-observatory__context-menu');
    await expect(contextMenu).toBeVisible();
    await expect(contextMenu.locator('[data-status-action]')).toHaveCount(4);
    await expect(page.locator('.workline-observatory__selection-count')).toContainText('2');
    const contextMenuBox = await contextMenu.boundingBox();
    expect(Math.abs((contextMenuBox?.x ?? 0) - ((contextRowBox?.x ?? 0) + 40))).toBeLessThan(3);
    expect(Math.abs((contextMenuBox?.y ?? 0) - ((contextRowBox?.y ?? 0) + 30))).toBeLessThan(3);
    await expect(contextMenu).toHaveCSS('position', 'fixed');
    const lightContextMenuLuminance = await contextMenu.evaluate(readButtonLuminance);
    expect(lightContextMenuLuminance.background).toBeGreaterThan(0.9);
    expect(lightContextMenuLuminance.text).toBeLessThan(0.25);
    const contextGuidance = contextMenu.locator('.workline-observatory__context-guidance');
    await expect(contextGuidance).toHaveCSS('border-top-width', '0px');
    await expect(contextGuidance).toHaveCSS('box-shadow', 'none');

    await page.evaluate(() => {
      document.body.classList.remove('light-mode');
      document.body.classList.add('dark-mode');
    });
    await page.waitForTimeout(180);
    const darkContextMenuLuminance = await contextMenu.evaluate(readButtonLuminance);
    expect(darkContextMenuLuminance.background).toBeLessThan(0.3);
    expect(darkContextMenuLuminance.text).toBeGreaterThan(0.8);

    await page.keyboard.press('Escape');
    await expect(contextMenu).toBeHidden();

    let confirmationSeen = false;
    page.once('dialog', async (dialog) => {
      confirmationSeen = true;
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message().length).toBeGreaterThan(10);
      await dialog.dismiss();
    });
    await page.locator('.workline-observatory__status-actions [data-status-action="closed"]').click();
    await expect.poll(() => confirmationSeen).toBe(true);
  });

  test('compacts the centered action bar when the report content scrolls under it', async ({ page }) => {
    await page.goto('/admin/workline_observatory', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      document.body.classList.remove('dark-mode');
      document.body.classList.add('light-mode');
    });
    const toolbar = page.locator('.workline-observatory__status-toolbar');
    await expect(toolbar).toBeVisible();
    await expect(toolbar).toHaveAttribute('data-compact', 'false');
    await expect(page.locator('.workline-observatory__header p'))
      .toHaveText('Select one or more worklines to change their state.');
    await expect(page.locator('.workline-observatory__status-action-group--before-now button'))
      .toHaveText(['Activate', 'Pause']);
    await expect(page.locator('.workline-observatory__status-action-group--after-now button'))
      .toHaveText(['Mark done', 'Discard']);
    await expect(page.locator('.workline-observatory__status-action').first())
      .toHaveCSS('background-color', 'rgb(255, 255, 255)');
    const lightThemeLuminance = await page.locator('.workline-observatory__status-action').first()
      .evaluate(readButtonLuminance);
    expect(lightThemeLuminance.background).toBeGreaterThan(0.9);
    expect(lightThemeLuminance.text).toBeLessThan(0.2);

    await page.evaluate(() => {
      document.body.classList.remove('light-mode');
      document.body.classList.add('dark-mode');
    });
    await page.waitForTimeout(180);
    const darkThemeLuminance = await page.locator('.workline-observatory__status-action').first()
      .evaluate(readButtonLuminance);
    expect(darkThemeLuminance.background).toBeLessThan(0.3);
    expect(darkThemeLuminance.text).toBeGreaterThan(0.85);

    await page.evaluate(() => {
      document.body.classList.remove('dark-mode');
      document.body.classList.add('light-mode');
    });
    await page.waitForTimeout(180);

    const expandedHeight = await toolbar.evaluate((element) => element.getBoundingClientRect().height);
    const toolbarBackground = await toolbar.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(toolbarBackground).not.toBe('rgba(0, 0, 0, 0)');
    const nowBox = await page.locator('.workline-observatory__now').boundingBox();
    const beforeNowBox = await page.locator('.workline-observatory__status-action-group--before-now').boundingBox();
    const afterNowBox = await page.locator('.workline-observatory__status-action-group--after-now').boundingBox();
    const nowCenter = (nowBox?.x ?? 0) + (nowBox?.width ?? 0) / 2;
    expect((beforeNowBox?.x ?? 0) + (beforeNowBox?.width ?? 0)).toBeLessThan(nowCenter);
    expect(afterNowBox?.x ?? 0).toBeGreaterThan(nowCenter);

    await page.locator('.workline-observatory__detail').scrollIntoViewIfNeeded();
    await expect(toolbar).toHaveAttribute('data-compact', 'true');
    await page.waitForTimeout(220);
    await expect(page.locator('.workline-observatory__selection-count')).toHaveCSS('visibility', 'hidden');
    const compactBox = await toolbar.boundingBox();
    const compactHeight = compactBox?.height ?? expandedHeight;
    expect(compactHeight).toBeLessThan(expandedHeight);
    expect(compactHeight).toBeLessThan(45);
    expect(compactBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(2);

    await page.locator('.workline-observatory__header').scrollIntoViewIfNeeded();
    await expect(toolbar).toHaveAttribute('data-compact', 'false');
    await page.waitForTimeout(220);
    const restoredHeight = await toolbar.evaluate((element) => element.getBoundingClientRect().height);
    expect(Math.abs(restoredHeight - expandedHeight)).toBeLessThan(1);
  });
});

function readButtonLuminance(element: Element) {
  const style = getComputedStyle(element);
  const luminance = (value: string) => {
    const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
    return channels.reduce((sum, channel, index) => sum + (channel / 255) * [0.2126, 0.7152, 0.0722][index], 0);
  };
  return {
    background: luminance(style.backgroundColor),
    text: luminance(style.color),
  };
}
