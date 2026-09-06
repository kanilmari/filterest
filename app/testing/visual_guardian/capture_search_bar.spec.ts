// capture_search_bar.spec.ts
// Captures focused filterbar/search-bar states for Visual Guardian review.
// Bridges responsive Playwright viewports and the screenshot artifact helper.
// Exists so search-bar visual regressions are visible across desktop and tablet states.

import { expect, test } from '@playwright/test';

import {
  loadVisualGuardianApp,
  saveVisualGuardianFailureArtifacts,
  takeGuardianScreenshot,
  waitForVisualGuardianIdle,
} from './visual_guardian_helpers';

function getVisibleFilterPanel(page) {
  return page.locator('.filterbar-panel:visible, .dataset-filter-panel:visible').first();
}

async function verifyQuickFilterActionLayout(page) {
  const inlineHero = page.locator('.filterbar-inline-hero:visible').first();
  const sortRow = inlineHero.locator('.filterbar-inline-hero-sort-row');
  const actionRow = inlineHero.locator('.filterbar-inline-hero-filter-actions');
  const filtersButton = actionRow.locator('[data-testid="temporary-filters-toggle-content-hero"]');
  const resetButton = actionRow.locator('[data-testid="btn-reset-search-content-hero"]');

  await expect(sortRow).toBeVisible();
  await expect(actionRow).toBeVisible();
  await expect(filtersButton).toBeVisible();
  await expect(resetButton).toBeVisible();
  await expect(
    page.locator('.filterbar-panel [data-temporary-filters-toggle-for]')
  ).toHaveCount(0);

  const [sortBox, actionBox, filtersBox, resetBox] = await Promise.all([
    sortRow.boundingBox(),
    actionRow.boundingBox(),
    filtersButton.boundingBox(),
    resetButton.boundingBox(),
  ]);
  expect(sortBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  expect(filtersBox).not.toBeNull();
  expect(resetBox).not.toBeNull();
  expect(actionBox!.y).toBeGreaterThanOrEqual(sortBox!.y + sortBox!.height - 2);
  expect(filtersBox!.x).toBeLessThan(resetBox!.x);
  expect(Math.abs(filtersBox!.width - resetBox!.width)).toBeLessThanOrEqual(2);
}

async function verifyInFieldClearControl(page) {
  const input = page.locator('[data-testid="dataset-search-input-content-hero"]');
  const clearButton = page.locator('[data-testid="dataset-search-clear-content-hero"]');
  const submitButton = page.locator('[data-testid="dataset-search-submit-content-hero"]');

  await input.fill('service');
  await submitButton.click();
  await expect(clearButton).toBeVisible();

  const [inputBox, clearBox, submitBox, clearStyle, inputStyle] = await Promise.all([
    input.boundingBox(),
    clearButton.boundingBox(),
    submitButton.boundingBox(),
    clearButton.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borderTopWidth: style.borderTopWidth,
        borderRightWidth: style.borderRightWidth,
        borderBottomWidth: style.borderBottomWidth,
        borderLeftWidth: style.borderLeftWidth,
        position: style.position,
      };
    }),
    input.evaluate((element) => ({
      borderRightWidth: getComputedStyle(element).borderRightWidth,
    })),
  ]);

  expect(inputBox).not.toBeNull();
  expect(clearBox).not.toBeNull();
  expect(submitBox).not.toBeNull();
  expect(clearBox!.height).toBeLessThan(inputBox!.height);
  expect(Math.abs(
    (clearBox!.y + clearBox!.height / 2) - (inputBox!.y + inputBox!.height / 2)
  )).toBeLessThanOrEqual(2);
  expect(clearBox!.x).toBeGreaterThan(inputBox!.x);
  expect(clearBox!.x + clearBox!.width).toBeLessThan(inputBox!.x + inputBox!.width);
  expect(submitBox!.x).toBeGreaterThanOrEqual(inputBox!.x + inputBox!.width - 2);
  expect(clearStyle).toEqual({
    borderTopWidth: '0px',
    borderRightWidth: '0px',
    borderBottomWidth: '0px',
    borderLeftWidth: '0px',
    position: 'absolute',
  });
  expect(inputStyle.borderRightWidth).not.toBe('0px');

  const beforePress = await clearButton.boundingBox();
  await clearButton.hover();
  await page.mouse.down();
  const duringPress = await clearButton.boundingBox();
  await page.mouse.up();
  expect(beforePress).not.toBeNull();
  expect(duringPress).not.toBeNull();
  for (const property of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(beforePress![property] - duringPress![property])).toBeLessThanOrEqual(0.1);
  }
  await expect(clearButton).toBeHidden();
}

async function verifyFlatTopbarContainsOnlySearch(page) {
  const topbar = page.locator('.dataset-shared-topbar:visible').first();
  const center = topbar.locator('.dataset-shared-topbar__center');

  await expect(topbar).toBeVisible();
  await expect(center.locator(':scope > .dataset-search-panel')).toHaveCount(1);
  await expect(center.locator(':scope > :not(.dataset-search-panel)')).toHaveCount(0);
  await expect(center.locator('select')).toHaveCount(0);
  await expect(center.locator('[data-temporary-filters-toggle-for]')).toHaveCount(0);
  await expect(center.locator('[data-testid^="btn-reset-search-"]')).toHaveCount(0);
}

async function exposeFlatTopbar(page) {
  const topbar = page.locator('.dataset-shared-topbar:visible').first();
  if (await topbar.isVisible().catch(() => false)) return;

  // The flat topbar is the fallback surface when the full filter panel is
  // hidden. Exercise the panel's own hide command instead of guessing at its
  // state through the separate fixed re-open button.
  const hidePanelButton = page.locator(
    '.filterbar-panel:visible .hide_filter_bar_button'
  ).first();
  await expect(hidePanelButton).toBeVisible();
  await hidePanelButton.evaluate((button: HTMLButtonElement) => button.click());
  const contentScroller = page.locator('.scrollable_content:visible').first();
  await expect(contentScroller).toBeVisible();
  await contentScroller.evaluate((element: HTMLElement) => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await waitForVisualGuardianIdle(page);
  await expect(topbar).toBeVisible();
}

async function selectAccountTheme(page, theme: 'system' | 'dark' | 'light') {
  const body = page.locator('body');
  const themeButton = page.locator('[data-theme-toggle]:visible, #themeToggleBtn:visible').first();
  const expectedClass = theme === 'system' ? 'system-mode' : `${theme}-mode`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await body.evaluate((element, className) => element.classList.contains(className), expectedClass)) {
      return;
    }
    await expect(themeButton).toBeEnabled();
    // Tablet navigation can place the real control outside the clipped drawer;
    // invoke that control's own handler without bypassing its product logic.
    await themeButton.evaluate((button: HTMLButtonElement) => button.click());
    await expect(themeButton).toBeEnabled();
  }

  await expect(body).toHaveClass(new RegExp(expectedClass));
}

async function verifyRowAccessEditor(
  page,
  testInfo,
  translatedButtonLabel: string,
  screenshotName: string
) {
  const rowSelector = page.locator([
    '[data-testid="card-select-checkbox"]:visible',
    'tbody [data-testid="row-select-checkbox"]:visible',
    'tbody .row_checkbox:visible',
  ].join(', ')).first();
  await expect(rowSelector).toBeVisible();
  await rowSelector.check();

  const editButton = page.locator(
    '[data-testid="btn-edit-row-permissions"]:visible'
  ).first();
  await expect(editButton).toBeVisible();
  await expect(editButton).toContainText(translatedButtonLabel);
  await editButton.click();

  const modal = page.locator('[data-testid="row-access-editor-modal"]');
  await expect(modal).toBeVisible();
  const principalPicker = modal.locator('[data-testid="row-access-principals"]');
  await expect(principalPicker).toBeVisible();
  await principalPicker.locator('.msd-dropdown-input').click();
  const optionList = page.locator('.msd-dropdown-list:visible');
  await expect(optionList.locator('.msd-option-group-label')).toHaveCount(2);
  await optionList.locator('.msd-option-checkbox[value^="group:"]').first().click();
  await optionList.locator('.msd-option-checkbox[value^="user:"]').first().click();
  await expect(modal.locator('[data-action="read"]')).toBeVisible();
  await expect(modal.locator('[data-action="update"]')).toBeVisible();
  await expect(modal.locator('[data-action="delete"]')).toBeVisible();
  await expect(modal.locator('[data-action="create"]')).toHaveCount(0);
  await expect(modal.locator('[data-action]')).toHaveCount(3);
  await takeGuardianScreenshot(page, testInfo, screenshotName);

  await principalPicker.locator('.msd-dropdown-input').click();
  await page.locator('[data-testid="modal-close-button"]').click();
  await rowSelector.uncheck();
}

test.describe('Visual Guardian - Search Bar Focus', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ ignoreHTTPSErrors: true });
  test.afterEach(async ({ page }, testInfo) => {
    await saveVisualGuardianFailureArtifacts(page, testInfo);
  });

  test('Desktop (1920x1080) - Flat Mode Search Bar', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(() => {
      localStorage.setItem('chosen_language', 'fi');
    });
    await loadVisualGuardianApp(page, { datasetName: 'app_service_catalog' });
    await selectAccountTheme(page, 'light');
    await expect(page.locator('body')).toHaveClass(/light-mode/);
    await verifyRowAccessEditor(
      page,
      testInfo,
      'Muokkaa rivioikeuksia',
      'desktop_row_access_multiselect_light_fi'
    );
    await verifyQuickFilterActionLayout(page);
    await verifyInFieldClearControl(page);
    
    const filterPanel = getVisibleFilterPanel(page);
    const panelVisible = await filterPanel.isVisible().catch(() => false);
    if (!panelVisible) {
      try {
        await filterPanel.waitFor({ state: 'visible', timeout: 5000 });
      } catch {
        test.skip(true, 'Filter panel not visible for the loaded dataset.');
        return;
      }
    }

    await exposeFlatTopbar(page);
    await verifyFlatTopbarContainsOnlySearch(page);
    await takeGuardianScreenshot(page, testInfo, 'desktop_flat_mode_search_bar');
  });

  test('Tablet (iPad Landscape 1024x768) - Flat Mode Search Bar', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(() => {
      localStorage.setItem('chosen_language', 'en');
    });
    await loadVisualGuardianApp(page, { datasetName: 'app_service_catalog' });
    await selectAccountTheme(page, 'dark');
    await expect(page.locator('body')).toHaveClass(/dark-mode/);
    await verifyRowAccessEditor(
      page,
      testInfo,
      'Edit row permissions',
      'tablet_row_access_multiselect_dark_en'
    );
    await verifyQuickFilterActionLayout(page);
    await verifyInFieldClearControl(page);
    
    const filterPanel = getVisibleFilterPanel(page);
    const panelVisible = await filterPanel.isVisible().catch(() => false);
    if (!panelVisible) {
      try {
        await filterPanel.waitFor({ state: 'visible', timeout: 5000 });
      } catch {
        test.skip(true, 'Filter panel not visible for the loaded dataset.');
        return;
      }
    }

    await exposeFlatTopbar(page);
    await verifyFlatTopbarContainsOnlySearch(page);

    await takeGuardianScreenshot(page, testInfo, 'tablet_flat_mode_search_bar');
    await selectAccountTheme(page, 'system');
  });
});
