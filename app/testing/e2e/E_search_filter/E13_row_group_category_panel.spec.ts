// E13_row_group_category_panel.spec.ts
// Verifies category interactions on an existing categorized dataset named by FILTEREST_E2E_CATEGORY_DATASET.
// Bridges shared categories, selected tags, URL restoration and application themes.
// Uses returned values only and never edits classifications or memberships.

import { test, expect, type Page, type Locator } from '@playwright/test';

const DATASET = process.env.FILTEREST_E2E_CATEGORY_DATASET || '';
const PANEL = `#${DATASET}_row_group_facets`;
const CHECKBOXES = '[data-testid="row-group-facet-checkbox"]';

async function waitForCategories(page: Page) {
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator(PANEL)).not.toHaveAttribute('aria-busy', 'true');
}

async function selectValue(page: Page, checkbox: Locator) {
  const slug = await checkbox.getAttribute('data-row-group-slug');
  expect(slug).toBeTruthy();
  await checkbox.check();
  await expect.poll(() => new URL(page.url()).searchParams.get('row_group')?.split(',') || []).toContain(slug);
  await waitForCategories(page);
  await expect(page.locator(`.active-filter-item[data-row-group-slug="${slug}"]`)).toBeVisible();
  return slug!;
}

function positiveCheckboxes(page: Page) {
  return page.locator(`${PANEL} label`).filter({ has: page.locator(`${CHECKBOXES}:not(:checked):not(:disabled)`) })
    .filter({ hasNot: page.locator('.row-group-facet-value__count', { hasText: /^0$/ }) }).locator(CHECKBOXES);
}

async function findHeading(page: Page, minimumValues: number, exclude = '') {
  const more = page.locator(`${PANEL} [data-row-group-focus="more"]`);
  if (await more.count() && await more.getAttribute('aria-expanded') === 'false') await more.click();
  const ids = await page.locator(`${PANEL} [data-heading-id]`).evaluateAll(buttons =>
    buttons.map(button => (button as HTMLElement).dataset.headingId!));
  for (const id of ids.filter(id => id !== exclude)) {
    const heading = page.locator(`${PANEL} [data-heading-id="${id}"]`);
    if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
    if (await positiveCheckboxes(page).count() >= minimumValues) return id;
  }
  throw new Error(`The dataset needs a heading with ${minimumValues} returned positive-hit values for this read-only proof.`);
}

// A signed-in account's saved theme wins over the device choice, so the proof runs as a guest and switches the
// device theme the way the application reads it.
test.use({ storageState: { cookies: [], origins: [] } });

test('WL103: multi-heading categories, search, reload, removal and clear-all', async ({ page }, testInfo) => {
  test.skip(!/^[a-z][a-z0-9_]{0,62}$/.test(DATASET), 'Set FILTEREST_E2E_CATEGORY_DATASET to an existing categorized dataset.');
  test.skip(testInfo.project.metadata.cardView === 'big', 'This proof uses the shared listing controls.');
  await page.addInitScript(() => {
    localStorage.setItem('chosen_language', 'fi');
    if (!localStorage.getItem('theme')) localStorage.setItem('theme', 'light');
  });
  // The explicit light choice must win over the operating system's dark preference.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`/${DATASET}?view=card`);
  await waitForCategories(page);
  await expect(page.locator('body')).toHaveClass(/\blight-mode\b/);
  const clear = page.locator('[data-testid="active-filters-clear-all"]');
  if (await clear.isVisible()) {
    await clear.click();
    await expect(clear).toHaveCount(0);
    await waitForCategories(page);
  }
  const firstHeading = await findHeading(page, 2);
  const firstSlug = await selectValue(page, positiveCheckboxes(page).first());
  const secondSlug = await selectValue(page, positiveCheckboxes(page).first());
  await expect(page.locator(`${PANEL} [data-heading-id="${firstHeading}"] .row-group-facet-heading__badge`)).toHaveText('2');
  const secondHeading = await findHeading(page, 1, firstHeading);
  const thirdSlug = await selectValue(page, positiveCheckboxes(page).first());
  await expect(page.locator('.active-filters-lead')).toHaveText('Valitut:');
  await expect(clear).toHaveText('Tyhjennä kaikki');

  // A fresh load proves URL restoration rather than reusing the page's state.
  await page.reload();
  await waitForCategories(page);
  expect(new URL(page.url()).searchParams.get('row_group')?.split(',').sort()).toEqual([firstSlug, secondSlug, thirdSlug].sort());
  await expect(page.locator('.active-filter-item[data-row-group-slug]')).toHaveCount(3);
  await page.locator(`${PANEL} [data-heading-id="${secondHeading}"]`).click();
  const selected = page.locator(`${PANEL} [data-row-group-slug="${thirdSlug}"]`);
  await expect(selected).toBeChecked();
  const name = await selected.locator('..').locator('.row-group-facet-value__name').textContent();
  const localSearch = page.locator(`${PANEL} [data-testid="row-group-facet-search"]`);
  await localSearch.fill(name!.trim());
  await expect(selected).toBeVisible();
  expect(new URL(page.url()).searchParams.has('search')).toBe(false);
  await localSearch.fill('zzqqxx-local-name-no-match');
  await expect(page.locator(`${PANEL} [data-lang-key="row_group_no_name_matches"]`)).toBeVisible();
  await localSearch.fill('');
  await localSearch.press('Escape');
  await expect(page.locator(`${PANEL} [data-heading-id="${secondHeading}"]`)).toBeFocused();

  // Each application theme is shown against the opposite operating-system preference, which it must override.
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => localStorage.setItem('theme', theme), theme);
    await page.emulateMedia({ colorScheme: theme === 'dark' ? 'light' : 'dark' });
    await page.reload();
    await waitForCategories(page);
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
    await page.locator(`${PANEL} [data-heading-id="${secondHeading}"]`).click();
    for (const width of [1440, 768, 375, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const geometry = await page.locator(PANEL).evaluate(host => {
        const box = host.getBoundingClientRect();
        const controls = [...host.querySelectorAll('button, input[type="search"], label')]
          .filter(control => (control as HTMLElement).offsetHeight > 0);
        return { left: box.left, right: box.right, width: box.width,
          shortestTarget: Math.min(...controls.map(control => control.getBoundingClientRect().height)),
          overflow: getComputedStyle(host.querySelector('ul')!).overflowY,
          maxHeight: getComputedStyle(host.querySelector('ul')!).maxHeight };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(width);
      expect(geometry.width).toBeLessThanOrEqual(550);
      expect(geometry.shortestTarget).toBeGreaterThanOrEqual(44);
      expect(geometry.overflow).toBe('auto');
      expect(geometry.maxHeight).toBe('340px');
      if (width !== 320) await page.screenshot({ path: testInfo.outputPath(`wl103-${width}-${theme}.png`), fullPage: true });
    }
  }

  const datasetSearch = page.locator(`[data-dataset-search-input="${DATASET}"]:visible`).first();
  if (!await datasetSearch.count()) await page.locator(`#${DATASET}_card_top_controls .card_search_filter_button`).click();
  await expect(datasetSearch).toBeVisible();
  await datasetSearch.fill('zzqqxx-no-such-category-row');
  await datasetSearch.locator('xpath=ancestor::*[@data-dataset-search-variant][1]')
    .locator('[data-testid^="dataset-search-submit"]').click();
  await expect.poll(() => new URL(page.url()).searchParams.get('search')).toBe('zzqqxx-no-such-category-row');
  await expect(page.locator('.active-filter-item').filter({ hasText: 'zzqqxx-no-such-category-row' })).toBeVisible();
  await page.locator(`.active-filter-item[data-row-group-slug="${firstSlug}"] button`).click();
  await expect(page.locator('.active-filter-item[data-row-group-slug]')).toHaveCount(2);
  await clear.click();
  await expect(page.locator('.active-filter-item')).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.has('row_group') || new URL(page.url()).searchParams.has('search')).toBe(false);
  await expect(datasetSearch).toHaveValue('');
});
