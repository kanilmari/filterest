// T15_view_field_assignments.spec.ts
// Verifies the group/site field-assignment administrator without changing saved assignments.
// Covers real navigation, dataset loading, localization, and explicit light/dark theme overrides.

import { expect, test, type Page } from '@playwright/test';
import { expandAdminTreeFolder, openAdminTreeButton } from '../helpers/admin-navigation';
import { loadCredentials, login } from '../helpers/auth';
import { waitForAppReady } from '../helpers/navigation';

async function ensureNavbarVisible(page: Page): Promise<void> {
  await page.evaluate(() => {
    const navbar = document.getElementById('navbar');
    if (navbar?.classList.contains('collapsed')) {
      document.getElementById('showMenuButton')?.click();
    }
  });
  await page.waitForFunction(() => !document.getElementById('navbar')?.classList.contains('collapsed'));
}

async function openViewFieldAssignments(page: Page): Promise<void> {
  await ensureNavbarVisible(page);
  await expandAdminTreeFolder(page, 'table_tools');
  await openAdminTreeButton(page, 'view_field_assignments');
  await expect(page.locator('[data-testid="view-field-assignments"]')).toBeVisible();
}

async function selectFirstDataset(page: Page): Promise<void> {
  const selected = await page.evaluate(() => {
    const tree = document.getElementById('view_field_assignments_dataset_tree');
    const leaf = tree?.querySelector('.node[data-is-folder="false"][data-table-uid]');
    const input = leaf?.querySelector('input[type="radio"], input[type="checkbox"]');
    if (!(input instanceof HTMLInputElement)) return false;
    if (input.checked) input.checked = false;
    input.click();
    return true;
  });
  expect(selected).toBe(true);
  await expect(page.locator('[data-testid="view-field-assignments-field-list"] > li').first())
    .toBeVisible({ timeout: 15000 });
}

async function mockMixedGroupAssignments(page: Page): Promise<void> {
  await page.route('**/api/view-field-sets?*', async (route) => {
    const requestURL = new URL(route.request().url());
    const dataset = requestURL.searchParams.get('dataset') || 'app_service_catalog';
    const viewKey = requestURL.searchParams.get('view_key') || 'card';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      json: {
        dataset,
        view_key: viewKey,
        effective_scope: 'site',
        site_default_field_set_id: 20,
        available_columns: ['id', 'title'],
        available_column_details: [
          { column_uid: 1, column_name: 'id' },
          { column_uid: 2, column_name: 'title' },
        ],
        metadata_visible_columns: ['id', 'title'],
        visible_columns: ['id', 'title'],
        field_sets: [
          { id: 20, name: 'Site', scope: 'shared', visible_columns: ['id', 'title'] },
          { id: 30, name: 'Editors', scope: 'shared', visible_columns: ['id'] },
          { id: 31, name: 'Guests', scope: 'shared', visible_columns: ['id', 'title'] },
        ],
        group_assignments: [
          { group_id: 2, group_name: 'Editors', field_set_id: 30, group_priority: 7 },
          { group_id: 4, group_name: 'Guests', field_set_id: 31, group_priority: 7 },
          { group_id: 9, group_name: 'Reviewers', field_set_id: 20, group_priority: 5 },
        ],
        can_edit_personal: true,
        can_edit_site_default: true,
      },
    });
  });
}

test('field-assignment administrator loads in Finnish and English across explicit themes', async ({ page }, testInfo) => {
  await login(page, loadCredentials());

  const renderedBackgrounds: string[] = [];
  for (const preferences of [
    { language: 'fi', theme: 'light', systemTheme: 'dark' as const, title: /Näkymien kenttäkohdistukset/ },
    { language: 'en', theme: 'dark', systemTheme: 'light' as const, title: /View field assignments/ },
  ]) {
    await page.emulateMedia({ colorScheme: preferences.systemTheme });
    await page.evaluate(({ language, theme }) => {
      localStorage.setItem('chosen_language', language);
      localStorage.setItem('theme', theme);
    }, preferences);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    await openViewFieldAssignments(page);
    await selectFirstDataset(page);

    await expect(page.locator('.view-field-assignments__title')).toHaveText(preferences.title);
    await expect(page.locator('body')).toHaveClass(new RegExp(`${preferences.theme}-mode`));
    await expect(page.locator('[data-testid="view-field-assignments-groups"]')).toBeVisible();
    await expect(page.locator('[data-testid="view-field-assignments-view"] option[value="article"]'))
      .toHaveCount(0);
    await expect(page.locator('[data-testid="view-field-assignments-priority"]')).toBeHidden();

    const fieldListScrollStyle = await page.locator(
      '[data-testid="view-field-assignments-field-list"]'
    ).evaluate((element) => ({
      maxHeight: getComputedStyle(element).maxHeight,
      overflowY: getComputedStyle(element).overflowY,
    }));
    expect(fieldListScrollStyle).toEqual({ maxHeight: 'none', overflowY: 'visible' });

    const rectangularTab = page.locator(
      '#navbar #navmenu .navtablinks[data-tab-presentation^="button"]'
    ).first();
    await expect(rectangularTab).toBeVisible();
    const rectangularEdge = await rectangularTab.evaluate((element) => {
      const navbar = document.getElementById('navbar');
      if (!navbar) return null;
      const tabStyles = getComputedStyle(element);
      const probe = document.createElement('span');
      probe.style.borderColor = 'var(--border_color)';
      document.body.appendChild(probe);
      const result = {
        distanceFromNavbarEdge: Math.abs(
          navbar.getBoundingClientRect().right - element.getBoundingClientRect().right
        ),
        borderRightWidth: tabStyles.borderRightWidth,
        borderRightColor: tabStyles.borderRightColor,
        expectedBorderColor: getComputedStyle(probe).borderRightColor,
      };
      probe.remove();
      return result;
    });
    expect(rectangularEdge).toEqual({
      distanceFromNavbarEdge: expect.any(Number),
      borderRightWidth: '2px',
      borderRightColor: expect.any(String),
      expectedBorderColor: expect.any(String),
    });
    expect(rectangularEdge?.distanceFromNavbarEdge).toBeLessThanOrEqual(0.5);
    expect(rectangularEdge?.borderRightColor).toBe(rectangularEdge?.expectedBorderColor);

    renderedBackgrounds.push(await page.locator('.view-field-assignments__editor').evaluate((element) => (
      getComputedStyle(element).backgroundColor
    )));
    await page.screenshot({
      path: testInfo.outputPath(`view-field-assignments-${preferences.language}-${preferences.theme}.png`),
      fullPage: true,
    });
  }

  expect(renderedBackgrounds[0]).not.toBe('rgba(0, 0, 0, 0)');
  expect(renderedBackgrounds[1]).not.toBe('rgba(0, 0, 0, 0)');
  expect(renderedBackgrounds[0]).not.toBe(renderedBackgrounds[1]);
});

test('keeps an exact group target across view changes and closes its portal on navigation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-card', 'Desktop lifecycle and width proof.');
  await login(page, loadCredentials());
  await page.evaluate(() => {
    localStorage.setItem('chosen_language', 'en');
    localStorage.setItem('theme', 'dark');
    sessionStorage.removeItem('view_field_assignments_admin_session_v1');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await openViewFieldAssignments(page);
  const selectedCatalog = await page.evaluate(() => {
    const label = document.querySelector(
      '#view_field_assignments_dataset_tree [data-lang-key="app_service_catalog"]'
    );
    const input = label?.closest('.node')?.querySelector('input[type="radio"], input[type="checkbox"]');
    if (!(input instanceof HTMLInputElement)) return false;
    input.click();
    return true;
  });
  expect(selectedCatalog).toBe(true);
  await expect(page.locator('[data-testid="view-field-assignments-field-list"] > li').first())
    .toBeVisible({ timeout: 15000 });

  const selectedGroup = await page.evaluate(() => {
    const host = document.getElementById('view_field_assignments_group_picker');
    const dropdown = (host as HTMLElement & {
      __dropdown?: {
        open: () => void;
        close: () => void;
        setValue: (value: { includeValues: string[]; excludeValues: string[] }, notify: boolean) => void;
      };
    })?.__dropdown;
    dropdown?.open();
    const options = Array.from(document.querySelectorAll('.msd-option'));
    const selectedOption = options.find((option) => (
      option.querySelector('.msd-option-label')?.textContent?.trim().toLowerCase() === 'admins'
    )) || options[0];
    const value = (selectedOption as HTMLElement | undefined)?.dataset.optionValue || '';
    const label = selectedOption?.querySelector('.msd-option-label')?.textContent?.trim() || '';
    if (value) dropdown?.setValue({ includeValues: [value], excludeValues: [] }, true);
    dropdown?.close();
    return { value, label };
  });
  expect(selectedGroup.value).not.toBe('');

  const groupInput = page.locator('#view_field_assignments_group_picker .msd-dropdown-input');
  await expect(groupInput).toHaveValue(selectedGroup.label);
  await expect(page.locator('[data-testid="view-field-assignments-priority"]')).toBeVisible();
  await page.locator('[data-testid="view-field-assignments-priority-help-button"]').click();
  await expect(page.locator('[data-testid="view-field-assignments-priority-help"]'))
    .toContainText('larger number wins');

  const editorWidth = await page.locator('.view-field-assignments__editor').evaluate(
    (element) => element.getBoundingClientRect().width
  );
  expect(editorWidth).toBeLessThanOrEqual(1200.5);

  const viewSelect = page.locator('[data-testid="view-field-assignments-view"]');
  const nextView = await viewSelect.locator('option').evaluateAll((options, currentValue) => (
    options.map((option) => (option as HTMLOptionElement).value)
      .find((value) => value !== currentValue) || ''
  ), await viewSelect.inputValue());
  expect(nextView).not.toBe('');
  await viewSelect.selectOption(nextView);
  await expect(page.locator('[data-testid="view-field-assignments-field-list"] > li').first())
    .toBeVisible({ timeout: 15000 });
  await expect(groupInput).toHaveValue(selectedGroup.label);

  await groupInput.click();
  const openedList = page.locator('.msd-dropdown-list:visible');
  await expect(openedList).toHaveCount(1);
  const openedListID = await openedList.getAttribute('id');
  expect(openedListID).not.toBeNull();
  await openAdminTreeButton(page, 'permissions');
  await expect(page.locator('#permissions_container')).toBeVisible();
  await expect(page.locator(`#${openedListID}`)).toBeHidden();

  await openViewFieldAssignments(page);
  await expect(page.locator('[data-testid="view-field-assignments-field-list"] > li').first())
    .toBeVisible({ timeout: 15000 });
  await expect(page.locator('#view_field_assignments_group_picker .msd-dropdown-input'))
    .toHaveValue(selectedGroup.label);
  await page.locator('#view_field_assignments_group_picker .msd-dropdown-input').click();
  await expect(page.locator(`#${openedListID}`)).toBeVisible();
});

test('shows and cycles a deterministic mixed group field without saving', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-card', 'Desktop mixed-field proof.');
  await login(page, loadCredentials());
  await page.evaluate(() => {
    localStorage.setItem('chosen_language', 'en');
    sessionStorage.removeItem('view_field_assignments_admin_session_v1');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await openViewFieldAssignments(page);
  await mockMixedGroupAssignments(page);
  const selectedCatalog = await page.evaluate(() => {
    const label = document.querySelector(
      '#view_field_assignments_dataset_tree [data-lang-key="app_service_catalog"]'
    );
    const input = label?.closest('.node')?.querySelector('input[type="radio"], input[type="checkbox"]');
    if (!(input instanceof HTMLInputElement)) return false;
    input.click();
    return true;
  });
  expect(selectedCatalog).toBe(true);
  await expect(page.locator('[data-testid="view-field-assignments-field-list"] > li').first())
    .toBeVisible({ timeout: 15000 });

  // Selecting every group may change the eventual write target to the site
  // layer, but it must not erase a real difference between those groups.
  await expect(page.locator('[data-testid="view-field-assignments-mixed"]')).toBeVisible();
  const hasIntermediateField = await page.locator(
    '[data-testid="view-field-assignment-visible"]'
  ).evaluateAll((checkboxes) => checkboxes.some((checkbox) => (
    (checkbox as HTMLInputElement).indeterminate
  )));
  expect(hasIntermediateField).toBe(true);

  const mixedTarget = await page.evaluate(async () => {
    const selectedNode = document.querySelector(
      '#view_field_assignments_dataset_tree input:checked'
    )?.closest('.node');
    const dataset = selectedNode
      ?.querySelector('span[data-lang-key], button[data-lang-key]')
      ?.getAttribute('data-lang-key') || '';
    const viewKey = (document.querySelector(
      '[data-testid="view-field-assignments-view"]'
    ) as HTMLSelectElement | null)?.value || '';
    const response = await fetch(
      `/api/view-field-sets?dataset=${encodeURIComponent(dataset)}&view_key=${encodeURIComponent(viewKey)}`
    );
    if (!response.ok) return null;
    const body = await response.json();
    const fieldSets = new Map((body.field_sets || []).map((fieldSet: {
      id: number;
      visible_columns: string[];
    }) => [Number(fieldSet.id), fieldSet.visible_columns || []]));
    const fallback = fieldSets.get(Number(body.site_default_field_set_id))
      || body.metadata_visible_columns
      || [];
    const variants = (body.group_assignments || []).map((assignment: {
      group_id: number;
      field_set_id?: number;
    }) => ({
      groupID: Number(assignment.group_id),
      visibleColumns: fieldSets.get(Number(assignment.field_set_id)) || fallback,
    }));
    let pair: typeof variants = [];
    let fieldName = '';
    for (let left = 0; left < variants.length && !fieldName; left += 1) {
      for (let right = left + 1; right < variants.length && !fieldName; right += 1) {
        const names = new Set([
          ...variants[left].visibleColumns,
          ...variants[right].visibleColumns,
        ]);
        fieldName = Array.from(names).find((name) => (
          variants[left].visibleColumns.includes(name)
          !== variants[right].visibleColumns.includes(name)
        )) || '';
        if (fieldName) pair = [variants[left], variants[right]];
      }
    }
    if (!fieldName || pair.length !== 2 || pair.length === variants.length) return null;

    const host = document.getElementById('view_field_assignments_group_picker') as HTMLElement & {
      __dropdown?: {
        setValue: (value: { includeValues: string[]; excludeValues: string[] }, notify: boolean) => void;
      };
    };
    host.__dropdown?.setValue({
      includeValues: pair.map((variant) => String(variant.groupID)),
      excludeValues: [],
    }, true);
    return { fieldName };
  });
  expect(mixedTarget, 'The controlled response must contain a mixed group pair').not.toBeNull();

  const checkbox = page.locator(
    `.view-field-assignments__field-row[data-field-name="${mixedTarget?.fieldName}"] input[type="checkbox"]`
  );
  await expect(checkbox).toHaveJSProperty('indeterminate', true);
  await expect(checkbox).toHaveAttribute('aria-checked', 'mixed');
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toHaveJSProperty('indeterminate', false);
  await checkbox.click();
  await expect(checkbox).not.toBeChecked();
  await checkbox.click();
  await expect(checkbox).toHaveJSProperty('indeterminate', true);
  await expect(checkbox).toHaveAttribute('aria-checked', 'mixed');
});

test('frames the complete application shell only when an ultra-wide viewport leaves spare space', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-card', 'Ultra-wide application-shell proof.');
  await page.setViewportSize({ width: 2800, height: 1000 });
  await login(page, loadCredentials());
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);

  const readShellStyles = () => page.evaluate(() => {
    const wrapper = document.querySelector('.body_wrapper');
    const shell = document.querySelector('.body_content');
    if (!(wrapper instanceof HTMLElement) || !(shell instanceof HTMLElement)) return null;

    const probe = document.createElement('span');
    probe.style.backgroundColor = 'var(--bg_color_extreme)';
    probe.style.borderColor = 'var(--border_color)';
    document.body.appendChild(probe);
    const result = {
      wrapperBackground: getComputedStyle(wrapper).backgroundColor,
      expectedBackground: getComputedStyle(probe).backgroundColor,
      borderWidths: [
        getComputedStyle(shell).borderTopWidth,
        getComputedStyle(shell).borderRightWidth,
        getComputedStyle(shell).borderBottomWidth,
        getComputedStyle(shell).borderLeftWidth,
      ],
      borderColor: getComputedStyle(shell).borderTopColor,
      expectedBorderColor: getComputedStyle(probe).borderTopColor,
    };
    probe.remove();
    return result;
  });

  expect(await readShellStyles()).toEqual({
    wrapperBackground: expect.any(String),
    expectedBackground: expect.any(String),
    borderWidths: ['1px', '1px', '1px', '1px'],
    borderColor: expect.any(String),
    expectedBorderColor: expect.any(String),
  });
  const wideStyles = await readShellStyles();
  expect(wideStyles?.wrapperBackground).toBe(wideStyles?.expectedBackground);
  expect(wideStyles?.borderColor).toBe(wideStyles?.expectedBorderColor);

  await ensureNavbarVisible(page);
  await page.locator('#hideMenuButton').click();
  await page.waitForFunction(() => document.getElementById('navbar')?.classList.contains('collapsed'));
  expect((await readShellStyles())?.borderWidths).toEqual(['1px', '1px', '1px', '1px']);

  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await expect(page.locator('body')).toHaveClass(/light-mode/);
  const lightStyles = await readShellStyles();
  expect(lightStyles?.wrapperBackground).toBe(lightStyles?.expectedBackground);
  expect(lightStyles?.borderWidths).toEqual(['1px', '1px', '1px', '1px']);
  expect(lightStyles?.borderColor).toBe(lightStyles?.expectedBorderColor);

  await page.setViewportSize({ width: 2400, height: 1000 });
  expect((await readShellStyles())?.borderWidths).toEqual(['0px', '0px', '0px', '0px']);
});
