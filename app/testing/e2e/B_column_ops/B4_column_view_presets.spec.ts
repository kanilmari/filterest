/**
 * B4_column_view_presets.spec.ts
 *
 * Tests the column-view preset ("kenttäjoukko") feature:
 *   - Preset selector appears in the filter bar
 *   - Shared field picker opens upward near the viewport bottom
 *   - Save a new preset from current column visibility
 *   - Apply a preset from the dropdown
 *   - Delete a preset
 *
 * Tests run sequentially (test.describe.serial) because they share
 * a preset created in the save test and deleted in the delete test.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDataset,
} from '../helpers/temp-dataset';
import { openActiveFilterbarIfCollapsed, openActiveFilterbarSection } from '../helpers/filterbar';

test.describe.serial('B4 — Column View Presets (kenttäjoukot)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  let credentials: TestCredentials;
  const datasetName = buildTempDatasetName('e2e_column_presets');
  const presetName = `E2E_test_preset_${Date.now().toString(36)}`;

  test.beforeAll(async ({ browser }) => {
    credentials = loadCredentials();

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    try {
      await login(page, credentials);
      await createTempDataset(page, {
        datasetName,
        columns: {
          id: 'SERIAL',
          title: 'TEXT',
          status: 'TEXT',
          category: 'TEXT',
        },
        seedRows: [
          {
            title: 'preset-row',
            status: 'draft',
            category: 'news',
          },
        ],
      });
    } finally {
      await context.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    try {
      await login(page, credentials);
      await dropTempDataset(page, datasetName);
    } finally {
      await context.close();
    }
  });

  test.beforeEach(async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log(`BROWSER ERROR: ${msg.text()}`);
    });
    await login(page, credentials);
    await openTempDataset(page, datasetName, 'table');
    await openActiveFilterbarIfCollapsed(page);
  });

  test('preset selector row is visible in the filter bar', async ({ page }) => {
    const presetRow = page.locator(
      `#${datasetName}_filterBar_panelBody [data-testid="column-view-preset-selector"]`,
    );
    await expect(presetRow).toBeVisible({ timeout: 5000 });

    const select = presetRow.locator('.column-preset-select');
    await expect(select).toBeVisible();
  });

  test('WL103: field picker opens upward near viewport bottom with first value visible', async ({ page }, testInfo) => {
    const presetRow = await openActiveFilterbarSection(page, 'field_sets');
    const trigger = presetRow.locator('.column-preset-field-picker [role="combobox"]');
    await expect(trigger).toBeVisible();
    // Supply scroll distance without replacing the real picker or its filterbar owner.
    await presetRow.evaluate(element => {
      const spacer = document.createElement('div');
      spacer.style.height = spacer.style.minHeight = `${window.innerHeight * 2}px`;
      spacer.style.flex = 'none';
      element.before(spacer);
    });
    await trigger.evaluate(element => element.scrollIntoView({ block: 'end', inline: 'nearest' }));
    await trigger.evaluate(element => {
      const anchor = element.closest('.msd-dropdown-input-row')!;
      const scrollHost = element.closest('.filterbar-panel-body')!;
      const viewport = window.visualViewport;
      const bottom = (viewport?.offsetTop || 0) + (viewport?.height || window.innerHeight);
      scrollHost.scrollTop += anchor.getBoundingClientRect().bottom - (bottom - 120 - 8 - 4);
    });
    // Scroll targets can clamp in the actual filterbar. Require the achieved geometry to need upward placement.
    let previousPosition = '';
    await expect.poll(async () => {
      const position = await trigger.evaluate(element => {
        const anchor = element.closest('.msd-dropdown-input-row')!.getBoundingClientRect();
        const viewport = window.visualViewport;
        const top = viewport?.offsetTop || 0;
        const bottom = top + (viewport?.height || window.innerHeight);
        return { below: bottom - anchor.bottom - 8 - 4, above: anchor.top - top - 8 - 4,
          scrollTop: element.closest('.filterbar-panel-body')!.scrollTop };
      });
      const stable = previousPosition === JSON.stringify(position);
      previousPosition = JSON.stringify(position);
      return stable && position.below >= 0 && position.below < 220 && position.above > position.below;
    }, { intervals: [150] }).toBe(true);
    const scrollBefore = await presetRow.evaluate(element => element.closest('.filterbar-panel-body')!.scrollTop);
    // Native activation avoids Playwright scrolling the carefully positioned anchor before opening it.
    await trigger.evaluate(element => (element as HTMLElement).click());
    const listID = await trigger.getAttribute('aria-controls');
    expect(listID).toBeTruthy();
    const list = page.locator(`#${listID}`);
    const popup = page.locator('.msd-dropdown-list').filter({ has: list });
    await expect(popup).toBeVisible();
    await expect(popup).toHaveClass(/\bmsd-dropdown-list--open-upward\b/);
    const first = list.locator('[role="option"]').first();
    await expect(first).toBeInViewport({ ratio: 1 });
    const placement = await popup.evaluate(element => {
      const frame = element.getBoundingClientRect();
      const options = element.querySelector<HTMLElement>('[role="listbox"]')!;
      const listFrame = options.getBoundingClientRect();
      const rows = [...options.querySelectorAll('[role="option"]')].slice(0, 3);
      const first = rows[0].getBoundingClientRect();
      const trigger = document.querySelector(`[aria-controls="${options.id}"]`)!;
      const anchor = trigger.closest('.msd-dropdown-input-row')!.getBoundingClientRect();
      const pixels = (value: string) => Number.parseFloat(value) || 0;
      const style = getComputedStyle(element);
      let fixedHeight = pixels(style.borderTopWidth) + pixels(style.borderBottomWidth)
        + pixels(style.paddingTop) + pixels(style.paddingBottom);
      for (const child of element.children) {
        const childStyle = getComputedStyle(child);
        if (child === options || child.classList.contains('msd-no-results') || childStyle.display === 'none') continue;
        fixedHeight += child.getBoundingClientRect().height + pixels(childStyle.marginTop) + pixels(childStyle.marginBottom);
      }
      const requiredHeight = Math.min(400, Math.max(220,
        fixedHeight + rows.at(-1)!.getBoundingClientRect().bottom - listFrame.top + options.scrollTop));
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft || 0;
      const top = viewport?.offsetTop || 0;
      const right = left + (viewport?.width || window.innerWidth);
      const bottom = top + (viewport?.height || window.innerHeight);
      return { requiredHeight, below: Math.max(0, bottom - anchor.bottom - 8 - 4),
        above: Math.max(0, anchor.top - top - 8 - 4), popupTop: frame.top, popupBottom: frame.bottom,
        firstValueTop: first.top, firstValueBottom: first.bottom, aboveTrigger: frame.bottom <= anchor.top - 3,
        inViewport: frame.left >= left && frame.right <= right && frame.top >= top && frame.bottom <= bottom,
        firstValueVisible: first.height > 0 && first.top >= Math.max(frame.top, listFrame.top, top)
          && first.bottom <= Math.min(frame.bottom, listFrame.bottom, bottom),
        firstValueOnTop: rows[0].contains(document.elementFromPoint(first.left + first.width / 2, first.top + first.height / 2)),
        filterbarScroll: trigger.closest('.filterbar-panel-body')!.scrollTop };
    });
    await testInfo.attach('field-picker-upward-placement', { body: JSON.stringify(placement, null, 2), contentType: 'application/json' });
    expect(placement.below, JSON.stringify(placement)).toBeLessThan(placement.requiredHeight);
    expect(placement.above).toBeGreaterThan(placement.below);
    expect(placement).toMatchObject({ aboveTrigger: true, inViewport: true, firstValueVisible: true, firstValueOnTop: true });
    expect(placement.filterbarScroll).toBeCloseTo(scrollBefore, 0);
    await page.screenshot({ path: testInfo.outputPath('wl103-field-picker-upward.png') });
    await popup.locator('.msd-dropdown-search-input').press('Escape');
    await expect(popup).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('can save a new preset and it appears in the dropdown', async ({ page }) => {
    const presetRow = page.locator(
      `#${datasetName}_filterBar_panelBody [data-testid="column-view-preset-selector"]`,
    );
    await expect(presetRow).toBeVisible({ timeout: 5000 });

    const saveBtn = presetRow.locator('[data-lang-key="save_field_set"]');
    await expect(saveBtn).toBeVisible({ timeout: 3000 });

    await saveBtn.click();
    const nameInput = page.locator('[data-testid="input-modal-input"]:visible').first();
    await expect(nameInput).toBeVisible({ timeout: 3000 });
    await nameInput.fill(presetName);
    const confirmSave = page
      .locator('[data-testid="input-modal-confirm-button"]:visible')
      .first();
    await expect(confirmSave).toBeVisible({ timeout: 3000 });
    await confirmSave.click();

    const select = presetRow.locator('.column-preset-select');
    await expect(select.locator('option').filter({ hasText: presetName })).toHaveCount(1, {
      timeout: 10000,
    });
  });

  test('can apply a saved preset from dropdown', async ({ page }) => {
    const presetRow = page.locator(
      `#${datasetName}_filterBar_panelBody [data-testid="column-view-preset-selector"]`,
    );
    await expect(presetRow).toBeVisible({ timeout: 5000 });

    const select = presetRow.locator('.column-preset-select');
    await select.focus();

    const targetOption = select.locator(`option:has-text("${presetName}")`);
    await expect(targetOption).toHaveCount(1, { timeout: 10000 });

    const value = await targetOption.getAttribute('value');
    await select.selectOption(value!);
    await page.waitForTimeout(500);

    const updateBtn = presetRow.locator('[data-lang-key="update_field_set"]');
    await expect(updateBtn).toBeVisible({ timeout: 3000 });

    const resetBtn = presetRow.locator('[data-testid="field-set-reset-inheritance"]');
    await expect(resetBtn).toBeVisible({ timeout: 3000 });
  });

  test('can delete a preset', async ({ page }) => {
    const presetRow = page.locator(
      `#${datasetName}_filterBar_panelBody [data-testid="column-view-preset-selector"]`,
    );
    await expect(presetRow).toBeVisible({ timeout: 5000 });

    const select = presetRow.locator('.column-preset-select');
    await select.focus();

    const targetOption = select.locator(`option:has-text("${presetName}")`);
    await expect(targetOption).toHaveCount(1, { timeout: 10000 });

    const value = await targetOption.getAttribute('value');
    await select.selectOption(value!);
    await page.waitForTimeout(500);

    // The preset row renders Delete directly beside Save, Update and the reset action (no "more actions" menu).
    const deleteBtn = presetRow.locator('[data-lang-key="delete_field_set"]');
    await expect(deleteBtn).toBeVisible({ timeout: 3000 });
    await deleteBtn.click();
    await page.waitForTimeout(300);

    const confirmModal = page.locator('[data-testid="modal-container"]');
    await expect(confirmModal).toBeVisible({ timeout: 3000 });

    const confirmBtn = confirmModal.locator('[data-testid="confirm-modal-confirm-button"]').first();
    await expect(confirmBtn).toBeVisible({ timeout: 3000 });
    await confirmBtn.click();
    await page.waitForTimeout(1500);

    const optionsAfter = await select.locator('option').allTextContents();
    expect(optionsAfter.some((text) => text.includes(presetName))).toBe(false);
  });
});
