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

async function categoryCounts(page: Page) {
  return page.locator(`${PANEL} .row-group-facet-value`).evaluateAll(labels => Object.fromEntries(labels.map(label => [
    (label.querySelector('input') as HTMLInputElement).dataset.rowGroupSlug!,
    Number(label.querySelector('.row-group-facet-value__count')!.textContent),
  ])));
}

// This second read-only proof needs a multi-valued heading whose two values have
// different row support, so ANY and ALL can visibly distinguish their counts.
test('WL103: ANY/ALL counts, mode restoration and selectable dimmed values', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(!/^[a-z][a-z0-9_]{0,62}$/.test(DATASET), 'Set FILTEREST_E2E_CATEGORY_DATASET to an existing categorized dataset.');
  test.skip(testInfo.project.metadata.cardView === 'big', 'This proof uses shared listing controls.');
  await page.addInitScript(() => {
    localStorage.setItem('chosen_language', 'fi');
    localStorage.setItem('theme', 'light');
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`/${DATASET}?view=card`);
  await waitForCategories(page);
  const more = page.locator(`${PANEL} [data-row-group-focus="more"]`);
  if (await more.count() && await more.getAttribute('aria-expanded') === 'false') await more.click();
  const headings = await page.locator(`${PANEL} [data-heading-id]`).evaluateAll(buttons =>
    buttons.map(button => (button as HTMLElement).dataset.headingId!));
  let chosenHeading = '';
  let slugs: string[] = [];
  let anyCounts: Record<string, number> = {};
  let allCounts: Record<string, number> = {};
  // Try readable values only. A taxonomy with identical co-occurrence cannot
  // prove count changes; the fixture requirement is reported without editing it.
  for (const heading of headings) {
    await page.goto(`/${DATASET}?view=card`);
    await waitForCategories(page);
    const showMore = page.locator(`${PANEL} [data-row-group-focus="more"]`);
    if (await showMore.count() && await showMore.getAttribute('aria-expanded') === 'false') await showMore.click();
    await page.locator(`${PANEL} [data-heading-id="${heading}"]`).click();
    if (!await page.locator(`${PANEL} input[type="radio"][value="all"]`).count()
      || await positiveCheckboxes(page).count() < 2) continue;
    await expect(page.locator(`${PANEL} input[type="radio"][value="any"]`)).toBeChecked();
    const first = await selectValue(page, positiveCheckboxes(page).first());
    const second = await selectValue(page, positiveCheckboxes(page).first());
    anyCounts = await categoryCounts(page);
    const listing = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/get-results' && url.searchParams.get('row_group_mode')?.includes(':all') === true;
    });
    await page.locator(`${PANEL} input[type="radio"][value="all"]`).check();
    expect((await listing).status()).toBe(200);
    await waitForCategories(page);
    const headingID = heading === 'legacy' ? '0' : heading;
    await expect.poll(() => new URL(page.url()).searchParams.get('row_group_mode')).toBe(`${headingID}:all`);
    allCounts = await categoryCounts(page);
    if (Object.keys(anyCounts).some(slug => allCounts[slug] < anyCounts[slug])) {
      chosenHeading = heading; slugs = [first, second]; break;
    }
  }
  expect(chosenHeading, 'Provide a multi-valued heading with two values whose readable row supports differ.').toBeTruthy();
  for (const slug of Object.keys(anyCounts)) expect(allCounts[slug]).toBeLessThanOrEqual(anyCounts[slug]);
  const headingID = chosenHeading === 'legacy' ? '0' : chosenHeading;
  await expect(page.locator('.active-filter-item[data-row-group-slug]')).toHaveCount(2);
  await expect(page.locator(`${PANEL} input[type="radio"][value="all"]`)).toBeFocused();
  const hintID = await page.locator(`${PANEL} fieldset`).getAttribute('aria-describedby');
  await expect(page.locator(`#${hintID}`)).toHaveAttribute('data-lang-key', 'row_group_match_all_hint');
  await page.reload();
  await waitForCategories(page);
  await page.locator(`${PANEL} [data-heading-id="${chosenHeading}"]`).click();
  await expect(page.locator(`${PANEL} input[type="radio"][value="all"]`)).toBeChecked();
  expect(new URL(page.url()).searchParams.get('row_group')?.split(',').sort()).toEqual(slugs.sort());
  expect(await categoryCounts(page)).toEqual(allCounts);

  // A zero-hit value may live under another returned heading. Check the whole
  // readable vocabulary offered by this page before recording fixture absence.
  const showMore = page.locator(`${PANEL} [data-row-group-focus="more"]`);
  if (await showMore.count() && await showMore.getAttribute('aria-expanded') === 'false') await showMore.click();
  const zeroHeadings = await page.locator(`${PANEL} [data-heading-id]`).evaluateAll(buttons =>
    buttons.map(button => (button as HTMLElement).dataset.headingId!));
  let zero: Locator | null = null;
  for (const heading of zeroHeadings) {
    const button = page.locator(`${PANEL} [data-heading-id="${heading}"]`);
    if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
    const candidate = page.locator(`${PANEL} label.is-zero-hit`).filter({ has: page.locator(`${CHECKBOXES}:not(:checked)`) }).locator(CHECKBOXES).first();
    if (await candidate.count()) { zero = candidate; break; }
  }
  if (zero) {
    await expect(zero).toBeEnabled();
    const zeroSlug = await selectValue(page, zero);
    await expect(page.locator(`${PANEL} label.is-zero-hit ${CHECKBOXES}[data-row-group-slug="${zeroSlug}"]`)).toBeChecked();
    await page.locator(`.active-filter-item[data-row-group-slug="${zeroSlug}"] button`).click();
    await waitForCategories(page);
  } else {
    testInfo.annotations.push({ type: 'fixture', description: 'No unselected zero-hit value in returned vocabulary; zero-hit interaction is covered by unit/PostgreSQL proofs.' });
  }
  const selectedHeading = page.locator(`${PANEL} [data-heading-id="${chosenHeading}"]`);
  if (await selectedHeading.getAttribute('aria-expanded') !== 'true') await selectedHeading.click();
  await page.locator(`.active-filter-item[data-row-group-slug="${slugs[0]}"] button`).click();
  await waitForCategories(page);
  expect(new URL(page.url()).searchParams.get('row_group_mode')).toBe(`${headingID}:all`);
  await page.locator(`${PANEL} input[type="radio"][value="any"]`).check();
  await waitForCategories(page);
  await expect.poll(() => new URL(page.url()).searchParams.has('row_group_mode')).toBe(false);
  await page.locator(`${PANEL} input[type="radio"][value="all"]`).check();
  await waitForCategories(page);
  await page.locator('[data-testid="active-filters-clear-all"]').click();
  await waitForCategories(page);
  // Clearing updates the address a moment after the click; the panel is not busy in between.
  await expect.poll(() => new URL(page.url()).searchParams.has('row_group_mode')).toBe(false);
  await expect.poll(() => new URL(page.url()).searchParams.has('row_group')).toBe(false);
  // The open heading stays open through the clearing re-render; a click would close it.
  const clearedHeading = page.locator(`${PANEL} [data-heading-id="${chosenHeading}"]`);
  if (await clearedHeading.getAttribute('aria-expanded') !== 'true') await clearedHeading.click();
  await expect(page.locator(`${PANEL} input[type="radio"][value="any"]`)).toBeChecked();
});
