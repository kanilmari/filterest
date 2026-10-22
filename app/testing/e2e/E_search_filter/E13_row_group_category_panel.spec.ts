// E13_row_group_category_panel.spec.ts
// Verifies category interactions on an existing categorized dataset named by FILTEREST_E2E_CATEGORY_DATASET.
// Bridges shared categories, selected tags, URL restoration and application themes.
// Uses returned values only and never edits classifications or memberships.

import { test, expect, type Page, type Locator } from '@playwright/test';
import { waitForActiveFilterbarLayout } from '../helpers/filterbar';
import { openActiveDatasetSearch } from '../helpers/dataset-search';
import { waitForVisiblePageReady } from '../../../server_tools/lib/browser_view_readiness.mjs';

const DATASET = process.env.FILTEREST_E2E_CATEGORY_DATASET || '';
const PANEL = `#${DATASET}_row_group_facets`;
const OPTIONS = '[role="option"]';

async function waitForCategories(page: Page) {
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator(PANEL)).not.toHaveAttribute('aria-busy', 'true');
}

// Resolve the current dialog through its stable heading rather than its portal ancestry.
async function categoryPopup(page: Page) {
  const heading = page.locator(`${PANEL} [data-heading-id][aria-expanded="true"]`);
  const popupID = await heading.getAttribute('aria-controls');
  expect(popupID).toBeTruthy();
  const popup = page.locator(`#${popupID}`);
  await expect(popup).toBeVisible();
  await expect(popup).toHaveAttribute('role', 'dialog');
  await expect(popup).toHaveAttribute('aria-modal', 'false');
  return popup;
}

async function openCategorySettings(page: Page) {
  const gear = (await categoryPopup(page)).locator('.msd-popup-settings-toggle');
  await expect(gear).toBeVisible();
  if (await gear.getAttribute('aria-expanded') === 'false') await gear.click();
}

async function selectValue(page: Page, option: Locator) {
  const slug = await option.getAttribute('data-option-value');
  expect(slug).toBeTruthy();
  const popup = await categoryPopup(page);
  const popupID = await popup.getAttribute('id');
  const query = await popup.locator('input[type="search"]').inputValue();
  await option.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('row_group')?.split(',') || []).toContain(slug);
  await waitForCategories(page);
  await expect(page.locator(`.active-filter-item[data-row-group-slug="${slug}"]`)).toBeVisible();
  expect(await (await categoryPopup(page)).getAttribute('id')).toBe(popupID);
  await expect(popup.locator('input[type="search"]')).toHaveValue(query);
  await expect(popup.locator(`[data-option-value="${slug}"]`)).toHaveAttribute('aria-selected', 'true');
  return slug!;
}

async function positiveCheckboxes(page: Page) {
  return (await categoryPopup(page)).locator(`${OPTIONS}[aria-selected="false"]:not([aria-disabled="true"])`)
    .filter({ hasNot: page.locator('.msd-option-count', { hasText: /^0$/ }) });
}

async function listingGeometry(page: Page) {
  return page.locator(PANEL).evaluate((host, dataset) => {
    const controls = document.getElementById(`${dataset}_card_top_controls`)!;
    const result = controls.nextElementSibling!;
    const card = host.getBoundingClientRect();
    const box = result.getBoundingClientRect();
    const scrollHost = controls.closest('.scrollable_content') || controls.parentElement!;
    // Attribute any remaining shift to the in-flow controls or hero rather
    // than guessing that the popup's out-of-flow focus ring resized the list.
    const hero = scrollHost.querySelector('.filterbar-inline-hero');
    return { height: card.height, resultTop: box.top, resultBottom: box.bottom, resultWidth: box.width,
      controlsHeight: controls.getBoundingClientRect().height,
      controlChildHeights: [...controls.children].map(child => ({
        id: child.id || child.tagName, height: child.getBoundingClientRect().height,
      })),
      heroHeight: hero?.getBoundingClientRect().height || 0,
      searchHeight: hero?.querySelector('.dataset-search-input-row')?.getBoundingClientRect().height || 0,
      pageScroll: document.scrollingElement!.scrollTop, resultScroll: scrollHost.scrollTop };
  }, DATASET);
}

// Two early equal readings do not prove that saved layout, webfonts or the
// 0.7 s shell transitions have finished. Await those concrete dependencies,
// then poll the full geometry; a persistent popup-induced shift still fails
// the exact before/open/closed comparisons below. Never return on exhaustion.
async function settledGeometry(page: Page) {
  await waitForActiveFilterbarLayout(page);
  await waitForVisiblePageReady(page);
  let previous = await listingGeometry(page);
  await expect.poll(async () => {
    await waitForVisiblePageReady(page);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    const current = await listingGeometry(page);
    const equal = JSON.stringify(current) === JSON.stringify(previous);
    previous = current;
    return equal;
  }, { timeout: 15000, message: 'Category and listing geometry settle after shell, font and transition readiness' }).toBe(true);
  return previous;
}

// An open popup lies over the selected-filters row; close it through its own heading before using that row.
async function closeCategoryPopup(page: Page) {
  const open = page.locator(`${PANEL} [data-heading-id][aria-expanded="true"]`);
  if (await open.count()) await open.first().click();
  await expect(page.locator('[role="dialog"].msd-dropdown-list--rich:visible')).toHaveCount(0);
}

// The geometry proof activates the heading and the close button with the elements' own click: Playwright's pointer
// click may first scroll a container to reach an element (for example past a notice toast), which would move the
// listing for reasons outside the popup. Every other step of these tests uses pointer clicks.
async function activate(locator: Locator) {
  await locator.evaluate(element => (element as HTMLElement).click());
}

// The focused element matches the selector, belongs to the popup and lies inside both the popup's box and the view.
async function focusedInView(popup: Locator, selector: string) {
  return popup.evaluate((element, wanted) => {
    const focused = document.activeElement as HTMLElement;
    const box = focused.getBoundingClientRect();
    const frame = element.getBoundingClientRect();
    return element.contains(focused) && focused.matches(wanted) && box.top >= frame.top - 1
      && box.bottom <= frame.bottom + 1 && box.top >= -1 && box.bottom <= window.innerHeight + 1;
  }, selector);
}

// Read the real opening geometry before any search changes the per-opening option budget. The placement rule
// budgets fixed controls plus three values (or the shorter list), rather than the full scrollable vocabulary.
async function popupPlacementGeometry(popup: Locator) {
  return popup.evaluate(element => {
    const frame = element.getBoundingClientRect();
    const trigger = document.querySelector(`[aria-controls="${element.id}"]`)!.getBoundingClientRect();
    const list = element.querySelector<HTMLElement>('[role="listbox"]')!;
    const rows = [...list.querySelectorAll('[role="option"]')].slice(0, 3);
    const first = rows[0].getBoundingClientRect();
    const last = rows.at(-1)!.getBoundingClientRect();
    const style = getComputedStyle(element);
    const pixels = (value: string) => Number.parseFloat(value) || 0;
    let fixedHeight = pixels(style.borderTopWidth) + pixels(style.borderBottomWidth)
      + pixels(style.paddingTop) + pixels(style.paddingBottom);
    for (const child of element.children) {
      const childStyle = getComputedStyle(child);
      if (child === list || child.classList.contains('msd-no-results') || childStyle.display === 'none') continue;
      fixedHeight += child.getBoundingClientRect().height + pixels(childStyle.marginTop) + pixels(childStyle.marginBottom);
    }
    const requiredHeight = Math.min(600, fixedHeight + last.bottom - list.getBoundingClientRect().top + list.scrollTop);
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const right = left + (viewport?.width || window.innerWidth);
    const bottom = top + (viewport?.height || window.innerHeight);
    const margin = right - left <= 700 ? 16 : 8;
    const below = Math.max(0, bottom - trigger.bottom - margin - 4);
    const above = Math.max(0, trigger.top - top - margin - 4);
    const preferUpward = below < requiredHeight && above > below;
    const shortScreen = Math.min(preferUpward ? above : below, bottom - top - 2 * margin) < Math.min(requiredHeight, fixedHeight + 44)
      || trigger.bottom <= top || trigger.top >= bottom;
    const stack = document.elementsFromPoint(frame.left + frame.width / 2, frame.top + frame.height / 2);
    const listFrame = list.getBoundingClientRect();
    return { above, below, fixedHeight, requiredHeight, popupTop: frame.top, popupBottom: frame.bottom,
      firstValueTop: first.top, firstValueBottom: first.bottom, expectedUpward: preferUpward && !shortScreen,
      actualUpward: element.classList.contains('msd-dropdown-list--open-upward'),
      inViewport: frame.left >= left && frame.right <= right && frame.top >= top && frame.bottom <= bottom,
      firstValueVisible: first.height >= 44 && first.top >= Math.max(frame.top, listFrame.top, top)
        && first.bottom <= Math.min(frame.bottom, listFrame.bottom, bottom),
      firstValueOnTop: rows[0].contains(document.elementFromPoint(first.left + first.width / 2, first.top + first.height / 2)),
      popupOnTop: element.contains(stack[0]), contentBeneath: stack.some(layer => !element.contains(layer)),
      aboveTrigger: frame.bottom <= trigger.top - 3 };
  });
}

async function provePopupGeometryAndFocus(page: Page, headingID: string, width: number) {
  const heading = page.locator(`${PANEL} [data-heading-id="${headingID}"]`);
  if (await heading.getAttribute('aria-expanded') === 'true') await activate(heading);
  await heading.scrollIntoViewIfNeeded();
  const before = await settledGeometry(page);
  await activate(heading);
  const popup = await categoryPopup(page);
  const open = await settledGeometry(page);
  expect(open).toEqual(before);
  const geometry = await popup.evaluate(element => {
    const box = element.getBoundingClientRect();
    const controls = [...element.querySelectorAll('button, input[type="search"], label, [role="option"]')]
      .filter(control => (control as HTMLElement).offsetHeight > 0);
    return { left: box.left, right: box.right, width: box.width, top: box.top, bottom: box.bottom,
      shortestTarget: Math.min(...controls.map(control => control.getBoundingClientRect().height)),
      overflow: getComputedStyle(element.querySelector('[role="listbox"]')!).overflowY };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(width);
  if (width <= 700) expect(geometry.width).toBe(width - 32);
  else expect(geometry.width).toBeGreaterThanOrEqual(360);
  expect(geometry.shortestTarget).toBeGreaterThanOrEqual(44);
  expect(geometry.overflow).toBe('auto');
  // Upward placement can cover the hero or page background. Prove the popup stays above that content, inside the
  // viewport with its first value usable, while the unchanged listing geometry above proves it is out of flow.
  const placement = await popupPlacementGeometry(popup);
  await test.info().attach(`popup-placement-${width}`, { body: JSON.stringify(placement, null, 2), contentType: 'application/json' });
  expect(placement.actualUpward, JSON.stringify(placement)).toBe(placement.expectedUpward);
  expect(placement).toMatchObject({ inViewport: true, firstValueVisible: true, firstValueOnTop: true,
    popupOnTop: true, contentBeneath: true });
  const counts = await popup.locator(OPTIONS).evaluateAll(options => options.map(option => ({
    label: option.getAttribute('aria-label'), count: option.querySelector('.msd-option-count')!.textContent,
  })));
  counts.forEach(({ label, count }) => expect(label).toMatch(new RegExp(`: ${count}$`)));
  await popup.locator('input[type="search"]').press('Escape');
  await expect(heading).toBeFocused(); expect(await settledGeometry(page)).toEqual(before);
  await activate(heading);
  await activate((await categoryPopup(page)).locator('.msd-popup-close'));
  await expect(heading).toBeFocused(); expect(await settledGeometry(page)).toEqual(before);
  await activate(heading);
}

async function findHeading(page: Page, minimumValues: number, exclude = '') {
  const more = page.locator(`${PANEL} [data-row-group-focus="more"]`);
  if (await more.isVisible() && await more.getAttribute('aria-expanded') === 'false') await more.click();
  const ids = await page.locator(`${PANEL} [data-heading-id]`).evaluateAll(buttons =>
    buttons.map(button => (button as HTMLElement).dataset.headingId!));
  for (const id of ids.filter(id => id !== exclude)) {
    const heading = page.locator(`${PANEL} [data-heading-id="${id}"]`);
    if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
    if (await (await positiveCheckboxes(page)).count() >= minimumValues) return id;
  }
  throw new Error(`The dataset needs a heading with ${minimumValues} returned positive-hit values for this read-only proof.`);
}

// The guest proof controls the explicit application choice and the OS preference independently.
// This keeps saved account preferences from overriding the requested theme matrix.
test.use({ storageState: { cookies: [], origins: [] } });

for (const [language, theme, osTheme] of [['fi', 'light', 'dark'], ['en', 'dark', 'light']] as const) {
  test(`WL103: category popup opens upward near viewport bottom (${language}, ${theme})`, async ({ page }, testInfo) => {
    test.skip(!/^[a-z][a-z0-9_]{0,62}$/.test(DATASET), 'Set FILTEREST_E2E_CATEGORY_DATASET to an existing categorized dataset.');
    test.skip(testInfo.project.metadata.cardView === 'big', 'This proof uses shared listing controls.');
    await page.addInitScript(({ language, theme }) => {
      localStorage.setItem('chosen_language', language);
      localStorage.setItem('theme', theme);
    }, { language, theme });
    await page.emulateMedia({ colorScheme: osTheme });
    await page.goto(`/${DATASET}?view=card`);
    await waitForCategories(page);
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
    const more = page.locator(`${PANEL} [data-row-group-focus="more"]`);
    if (await more.isVisible() && await more.getAttribute('aria-expanded') === 'false') await more.click();
    const ids = await page.locator(`${PANEL} [data-heading-id]`).evaluateAll(buttons =>
      buttons.map(button => (button as HTMLElement).dataset.headingId!));
    let chosenHeading = '';
    for (const id of ids) {
      await activate(page.locator(`${PANEL} [data-heading-id="${id}"]`));
      const popup = await categoryPopup(page);
      if (await popup.locator('fieldset:not([hidden])').count() && await popup.locator(OPTIONS).count() >= 3) {
        chosenHeading = id;
        break;
      }
    }
    expect(chosenHeading, 'Needs a multi-valued heading with at least three returned values.').not.toBe('');
    await closeCategoryPopup(page);
    const heading = page.locator(`${PANEL} [data-heading-id="${chosenHeading}"]`);
    const viewport = page.viewportSize()!;
    const margin = viewport.width <= 700 ? 16 : 8;
    const targetBelow = 220;
    // Some datasets put every heading near the top. A temporary DOM spacer supplies scroll distance without
    // changing the dataset or moving the heading out of its real owner. Use the actual listing's scroll container.
    await page.locator(PANEL).evaluate(host => {
      const spacer = document.createElement('div');
      spacer.style.height = spacer.style.minHeight = `${window.innerHeight * 2}px`;
      spacer.style.flex = 'none';
      host.before(spacer);
    });
    await heading.evaluate(element => element.scrollIntoView({ block: 'end', inline: 'nearest' }));
    await heading.evaluate((element, { targetBelow, margin }) => {
      const scrollHost = element.closest('.scrollable_content') || document.scrollingElement!;
      scrollHost.scrollTop += element.getBoundingClientRect().bottom - (window.innerHeight - targetBelow - margin - 4);
    }, { targetBelow, margin });
    const before = await settledGeometry(page);
    await activate(heading);
    const popup = await categoryPopup(page);
    expect(await settledGeometry(page)).toEqual(before);
    // Scrolling can clamp or settle at a different distance on the real page. Prove the decision for that geometry,
    // not an exact scroll target: the content cannot fit below, the larger space is above, and the first value fits.
    const placement = await popupPlacementGeometry(popup);
    await testInfo.attach('upward-placement', { body: JSON.stringify(placement, null, 2), contentType: 'application/json' });
    await expect(popup).toHaveClass(/\bmsd-dropdown-list--open-upward\b/);
    expect(placement.below, JSON.stringify(placement)).toBeLessThan(placement.requiredHeight);
    expect(placement.above).toBeGreaterThan(placement.below);
    expect(placement).toMatchObject({ expectedUpward: true, actualUpward: true, aboveTrigger: true,
      inViewport: true, firstValueVisible: true, firstValueOnTop: true, popupOnTop: true, contentBeneath: true });
    await expect(popup.locator(OPTIONS).first()).toBeInViewport({ ratio: 1 });
    const originalBottom = await popup.evaluate(element => element.getBoundingClientRect().bottom);
    await popup.locator('input[type="search"]').fill('zzqqxx-local-name-no-match');
    await expect(popup.locator('.msd-no-results')).toBeVisible();
    await expect(popup).toHaveClass(/\bmsd-dropdown-list--open-upward\b/);
    await expect.poll(async () => popup.evaluate(element => element.getBoundingClientRect().bottom)).toBeCloseTo(originalBottom, 0);
    await popup.locator('input[type="search"]').fill('');
    await expect(popup.locator(OPTIONS).first()).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath(`wl103-upward-${language}-${theme}.png`) });
    await popup.locator('input[type="search"]').press('Escape');
    await expect(heading).toBeFocused();
  });
}

test('WL103: multi-heading categories, search, reload, removal and clear-all', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  test.skip(!/^[a-z][a-z0-9_]{0,62}$/.test(DATASET), 'Set FILTEREST_E2E_CATEGORY_DATASET to an existing categorized dataset.');
  test.skip(testInfo.project.metadata.cardView === 'big', 'This proof uses the shared listing controls.');
  await page.addInitScript(() => {
    if (!localStorage.getItem('chosen_language')) localStorage.setItem('chosen_language', 'fi');
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
  const firstSlug = await selectValue(page, (await positiveCheckboxes(page)).first());
  const secondSlug = await selectValue(page, (await positiveCheckboxes(page)).first());
  await expect(page.locator(`${PANEL} [data-heading-id="${firstHeading}"] .row-group-facet-heading__badge`)).toHaveText('2');
  const secondHeading = await findHeading(page, 1, firstHeading);
  const thirdSlug = await selectValue(page, (await positiveCheckboxes(page)).first());
  await expect(page.locator('.active-filters-lead')).toHaveText('Valitut:');
  await expect(clear).toHaveText('Tyhjennä kaikki');

  // A fresh load proves URL restoration rather than reusing the page's state.
  await page.reload();
  await waitForCategories(page);
  expect(new URL(page.url()).searchParams.get('row_group')?.split(',').sort()).toEqual([firstSlug, secondSlug, thirdSlug].sort());
  await expect(page.locator('.active-filter-item[data-row-group-slug]')).toHaveCount(3);
  await page.locator(`${PANEL} [data-heading-id="${secondHeading}"]`).click();
  const selected = (await categoryPopup(page)).locator(`[data-option-value="${thirdSlug}"]`);
  await expect(selected).toHaveAttribute('aria-selected', 'true');
  const name = await selected.locator('.msd-option-label').textContent();
  const localSearch = (await categoryPopup(page)).locator('input[type="search"]');
  await localSearch.fill(name!.trim());
  await expect(selected).toBeVisible();
  expect(new URL(page.url()).searchParams.has('search')).toBe(false);
  await localSearch.fill('zzqqxx-local-name-no-match');
  await expect((await categoryPopup(page)).locator('.msd-no-results')).toBeVisible();
  await localSearch.fill('');
  await localSearch.press('Escape');
  await expect(page.locator(`${PANEL} [data-heading-id="${secondHeading}"]`)).toBeFocused();

  // Explicit application themes must win over the OS choice, in both supported languages.
  for (const [theme, osTheme] of [['light', 'light'], ['dark', 'light'], ['light', 'dark']] as const) {
    for (const language of ['fi', 'en']) {
      await page.evaluate(({ theme, language }) => {
        localStorage.setItem('theme', theme); localStorage.setItem('chosen_language', language);
      }, { theme, language });
      await page.emulateMedia({ colorScheme: osTheme });
      await page.reload(); await waitForCategories(page);
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
      for (const width of [1440, 601, 600, 375, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await provePopupGeometryAndFocus(page, secondHeading, width);
        const popup = await categoryPopup(page);
        await expect(popup.locator('.msd-popup-close')).toHaveAttribute('aria-label', language === 'fi' ? 'Sulje' : 'Close');
        await page.screenshot({ path: testInfo.outputPath(`wl103-${width}-${theme}-os-${osTheme}-${language}.png`), fullPage: true });
      }
      await page.setViewportSize({ width: 375, height: 350 });
      const popup = await categoryPopup(page);
      await expect.poll(async () => popup.evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(334);
      await expect(popup.locator('.msd-popup-close')).toBeVisible();
      // Only the options scroll, including on short screens. Search and match-mode controls remain in the shell.
      expect(await popup.evaluate(element => getComputedStyle(element).overflowY)).toBe('hidden');
      const searchTop = (await popup.locator('input[type="search"]').boundingBox())!.y;
      const heading = page.locator(`${PANEL} [data-heading-id="${secondHeading}"]`);
      const search = popup.locator('input[type="search"]');
      const toLastOption = async () => {
        await search.press('ArrowDown');
        await popup.locator(`${OPTIONS}:focus`).press('End');
        expect(await focusedInView(popup, OPTIONS)).toBe(true);
      };
      await search.focus();
      await toLastOption();
      expect((await search.boundingBox())!.y).toBe(searchTop);
      expect(await popup.evaluate(element => element.scrollTop)).toBe(0);
      await page.keyboard.press('Escape');
      await expect(heading).toBeFocused();
      await heading.press('ArrowDown');
      await expect(search).toBeFocused();
      expect(await focusedInView(popup, 'input[type="search"]')).toBe(true);
      await toLastOption();
      await heading.evaluate(element => (element as HTMLElement).focus({ preventScroll: true }));
      await heading.press('ArrowDown');
      await expect(search).toBeFocused();
      expect(await focusedInView(popup, 'input[type="search"]')).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`wl103-short-${theme}-os-${osTheme}-${language}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await (await categoryPopup(page)).locator('.msd-popup-close').click();

  const datasetSearch = page.locator(`[data-dataset-search-input="${DATASET}"]:visible`).first();
  for (const width of [375, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    // The filter bar re-lays out after a width change; a late re-layout collapses an already opened phone search.
    await waitForActiveFilterbarLayout(page);
    const showSearch = page.getByTestId('mobile-search-toggle');
    if (width === 375) {
      await expect(datasetSearch).toHaveCount(0);
      await expect(showSearch).toBeVisible();
      await expect(showSearch).toHaveAccessibleName(/^(Näytä haku|Show search)$/);
    } else {
      await expect(showSearch).toBeHidden();
    }
    const query = width === 375 ? 'zzqqxx-phone-no-such-category-row' : 'zzqqxx-no-such-category-row';
    // A late re-layout after the width change can collapse the phone search; reopen it as a user would.
    await expect(async () => {
      const input = await openActiveDatasetSearch(page);
      await expect(input).toHaveAttribute('data-dataset-search-input', DATASET);
      if (width === 375) await expect(showSearch).toHaveAttribute('aria-expanded', 'true');
      await input.fill(query);
      // The builder pairs input/submit test IDs by variant, even when the hero is rehosted.
      const inputTestID = await input.getAttribute('data-testid');
      const submit = page.getByTestId(inputTestID!.replace('dataset-search-input', 'dataset-search-submit'))
        .filter({ visible: true });
      await submit.click({ timeout: 5000 });
      await expect.poll(() => new URL(page.url()).searchParams.get('search'), { timeout: 5000 }).toBe(query);
    }).toPass({ timeout: 45_000 });
  }
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
  return (await categoryPopup(page)).locator(OPTIONS).evaluateAll(options => Object.fromEntries(options.map(option => [
    (option as HTMLElement).dataset.optionValue!,
    Number(option.querySelector('.msd-option-count')!.textContent),
  ])));
}

for (const language of ['fi', 'en'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`WO26: matching labels, tags and keyboard help (${language}, ${theme})`, async ({ page }, testInfo) => {
      test.setTimeout(120_000);
      test.skip(!/^[a-z][a-z0-9_]{0,62}$/.test(DATASET), 'Set FILTEREST_E2E_CATEGORY_DATASET to an existing categorized dataset.');
      test.skip(testInfo.project.metadata.cardView === 'big', 'This proof uses shared listing controls.');
      await page.addInitScript(({ language, theme }) => {
        localStorage.setItem('chosen_language', language); localStorage.setItem('theme', theme);
      }, { language, theme });
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await page.goto(`/${DATASET}?view=card`);
      await waitForCategories(page);
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
      const more = page.locator(`${PANEL} [data-row-group-focus="more"]`);
      if (await more.isVisible() && await more.getAttribute('aria-expanded') === 'false') await more.click();
      const ids = await page.locator(`${PANEL} [data-heading-id]`).evaluateAll(buttons =>
        buttons.map(button => (button as HTMLElement).dataset.headingId!));
      let chosenHeading = '';
      for (const id of ids) {
        await activate(page.locator(`${PANEL} [data-heading-id="${id}"]`));
        if (await (await categoryPopup(page)).locator('fieldset:not([hidden])').count()) { chosenHeading = id; break; }
      }
      expect(chosenHeading, 'Needs a multi-valued heading with at least two returned values.').not.toBe('');
      const popup = await categoryPopup(page);
      await openCategorySettings(page);
      const any = popup.locator('input[type="radio"][value="any"]');
      const all = popup.locator('input[type="radio"][value="all"]');
      await expect(popup.locator('fieldset')).toHaveAccessibleName(language === 'fi' ? 'Kun valitset useita' : 'When you select several');
      await expect(any).toHaveAccessibleName(language === 'fi' ? 'Mikä tahansa käy Enemmän tuloksia' : 'Accept any More results');
      await expect(all).toHaveAccessibleName(language === 'fi' ? 'Kaikki vaaditaan Vähemmän tuloksia' : 'Require all Fewer results');
      await expect(any).toBeChecked();
      const button = popup.locator('.row-group-facet-mode__help-button');
      await expect(button).toHaveAccessibleName(language === 'fi' ? 'Selitä valintojen yhdistäminen' : 'Explain how selections combine');
      const help = popup.locator(`#${await button.getAttribute('aria-controls')}`);
      for (const width of [1440, 375, 320]) {
        await page.setViewportSize({ width, height: 1000 });
        await expect(popup.locator('.row-group-facet-mode__tag')).toHaveText(language === 'fi'
          ? ['Enemmän tuloksia', 'Vähemmän tuloksia'] : ['More results', 'Fewer results']);
        await expect(button).toHaveAttribute('aria-expanded', 'false');
        await expect(help).toBeHidden();
        await button.focus();
        await button.press('Enter');
        await expect(button).toHaveAttribute('aria-expanded', 'true');
        await expect(help).toBeVisible();
        await expect(help.locator('p')).toHaveText(language === 'fi' ? [
          'Mikä tahansa käy – Näytetään rivit, joissa on jokin valituista arvoista.',
          'Kaikki vaaditaan – Näytetään rivit, joissa on kaikki valitut arvot. Luvut kertovat osumat, kun arvo lisätään valintoihin.',
          'Eri otsikoiden valinnat rajaavat hakua aina yhdessä.',
        ] : [
          'Accept any – Shows rows that have any of the selected values.',
          'Require all – Shows rows that have all selected values. Counts show matches when the value is added to the selection.',
          'Selections under different headings always narrow the search together.',
        ]);
        // Measure actual label targets and the help button, not their decorative radio/icon.
        for (const target of [popup.locator('.row-group-facet-mode__option').nth(0), popup.locator('.row-group-facet-mode__option').nth(1), button]) {
          const box = (await target.boundingBox())!;
          expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
        }
        expect(await popup.evaluate(element => {
          const box = element.getBoundingClientRect();
          const selector = element.querySelector<HTMLElement>('.row-group-facet-mode-block')!;
          return box.left >= 0 && box.right <= window.innerWidth && element.scrollWidth <= element.clientWidth
            && selector.scrollWidth <= selector.clientWidth;
        })).toBe(true);
        await expect(help).toHaveAccessibleName(language === 'fi' ? 'Selitä valintojen yhdistäminen' : 'Explain how selections combine');
        await button.press('Tab');
        await expect(popup.locator('.msd-popup-settings-close')).toBeFocused();
        await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
        await expect(help).toBeFocused();
        await help.press('End');
        await expect.poll(() => help.evaluate(element =>
          element.scrollTop + element.clientHeight >= element.scrollHeight - 1)).toBe(true);
        expect(await focusedInView(popup, '.row-group-facet-mode__help')).toBe(true);
        await help.press('Tab');
        await expect(popup.locator('input[type="search"]')).toBeFocused();
        expect(await focusedInView(popup, 'input[type="search"]')).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`wo26-help-${width}-${language}-${theme}.png`) });
        await button.press('Space');
        await expect(help).toBeHidden();
        await expect(button).toHaveAttribute('aria-expanded', 'false');
        await button.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
        await expect(popup.locator('input[type="search"]')).toBeFocused();
      }
      await any.focus(); await any.press('ArrowRight');
      await waitForCategories(page); await expect(all).toBeChecked(); await expect(all).toBeFocused();
      await all.press('ArrowLeft'); await waitForCategories(page); await expect(any).toBeChecked();
      await button.click(); await button.press('Escape');
      await expect(popup.locator('.msd-popup-settings-toggle')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.locator(`${PANEL} [data-heading-id="${chosenHeading}"]`)).toBeFocused();
      await expect(help).toBeHidden();
    });
  }
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
  if (await more.isVisible() && await more.getAttribute('aria-expanded') === 'false') await more.click();
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
    if (await showMore.isVisible() && await showMore.getAttribute('aria-expanded') === 'false') await showMore.click();
    await page.locator(`${PANEL} [data-heading-id="${heading}"]`).click();
    if (!await (await categoryPopup(page)).locator('fieldset:not([hidden]) input[type="radio"][value="all"]').count()
      || await (await positiveCheckboxes(page)).count() < 2) continue;
    await openCategorySettings(page);
    await expect((await categoryPopup(page)).locator('fieldset:not([hidden]) input[type="radio"][value="any"]')).toBeChecked();
    const first = await selectValue(page, (await positiveCheckboxes(page)).first());
    const second = await selectValue(page, (await positiveCheckboxes(page)).first());
    anyCounts = await categoryCounts(page);
    const popup = await categoryPopup(page);
    const query = (await popup.locator(`[data-option-value="${first}"] .msd-option-label`).textContent())!.trim();
    await popup.locator('input[type="search"]').fill(query);
    await expect(popup.locator('fieldset')).toBeVisible();
    const listing = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/get-results' && url.searchParams.get('row_group_mode')?.includes(':all') === true;
    });
    await (await categoryPopup(page)).locator('fieldset:not([hidden]) input[type="radio"][value="all"]').check();
    expect((await listing).status()).toBe(200);
    await waitForCategories(page);
    const headingID = heading === 'legacy' ? '0' : heading;
    await expect.poll(() => new URL(page.url()).searchParams.get('row_group_mode')).toBe(`${headingID}:all`);
    await expect(popup.locator('input[type="search"]')).toHaveValue(query);
    await expect(popup.locator('fieldset:not([hidden]) input[type="radio"][value="all"]')).toBeFocused();
    await popup.locator('input[type="search"]').fill('');
    // Count inspection restores focus to the radio without toggling its native state.
    await popup.locator('fieldset:not([hidden]) input[type="radio"][value="all"]').focus();
    allCounts = await categoryCounts(page);
    if (Object.keys(anyCounts).some(slug => allCounts[slug] < anyCounts[slug])) {
      chosenHeading = heading; slugs = [first, second]; break;
    }
  }
  expect(chosenHeading, 'Provide a multi-valued heading with two values whose readable row supports differ.').toBeTruthy();
  for (const slug of Object.keys(anyCounts)) expect(allCounts[slug]).toBeLessThanOrEqual(anyCounts[slug]);
  const headingID = chosenHeading === 'legacy' ? '0' : chosenHeading;
  await expect(page.locator('.active-filter-item[data-row-group-slug]')).toHaveCount(2);
  await expect((await categoryPopup(page)).locator('fieldset:not([hidden]) input[type="radio"][value="all"]')).toBeFocused();
  const hintID = await (await categoryPopup(page)).locator('fieldset').getAttribute('aria-describedby');
  await expect(page.locator(`#${hintID}`)).toHaveAttribute('data-lang-key', 'row_group_match_all_hint');
  await page.reload();
  await waitForCategories(page);
  await page.locator(`${PANEL} [data-heading-id="${chosenHeading}"]`).click();
  await openCategorySettings(page);
  await expect((await categoryPopup(page)).locator('fieldset:not([hidden]) input[type="radio"][value="all"]')).toBeChecked();
  expect(new URL(page.url()).searchParams.get('row_group')?.split(',').sort()).toEqual(slugs.sort());
  expect(await categoryCounts(page)).toEqual(allCounts);

  // A zero-hit value may live under another returned heading. Check the whole
  // readable vocabulary offered by this page before recording fixture absence.
  const showMore = page.locator(`${PANEL} [data-row-group-focus="more"]`);
  if (await showMore.isVisible() && await showMore.getAttribute('aria-expanded') === 'false') await showMore.click();
  const zeroHeadings = await page.locator(`${PANEL} [data-heading-id]`).evaluateAll(buttons =>
    buttons.map(button => (button as HTMLElement).dataset.headingId!));
  let zero: Locator | null = null;
  for (const heading of zeroHeadings) {
    const button = page.locator(`${PANEL} [data-heading-id="${heading}"]`);
    if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
    const candidate = (await categoryPopup(page)).locator(`${OPTIONS}.msd-option--dimmed[aria-selected="false"]`).first();
    if (await candidate.count()) { zero = candidate; break; }
  }
  if (zero) {
    await expect(zero).not.toHaveAttribute('aria-disabled', 'true');
    const zeroSlug = await selectValue(page, zero);
    await expect((await categoryPopup(page)).locator(`[data-option-value="${zeroSlug}"]`)).toHaveAttribute('aria-selected', 'true');
    await closeCategoryPopup(page);
    await page.locator(`.active-filter-item[data-row-group-slug="${zeroSlug}"] button`).click();
    await waitForCategories(page);
  } else {
    testInfo.annotations.push({ type: 'fixture', description: 'No unselected zero-hit value in returned vocabulary; zero-hit interaction is covered by unit/PostgreSQL proofs.' });
  }
  const selectedHeading = page.locator(`${PANEL} [data-heading-id="${chosenHeading}"]`);
  await closeCategoryPopup(page);
  await page.locator(`.active-filter-item[data-row-group-slug="${slugs[0]}"] button`).click();
  await waitForCategories(page);
  expect(new URL(page.url()).searchParams.get('row_group_mode')).toBe(`${headingID}:all`);
  if (await selectedHeading.getAttribute('aria-expanded') !== 'true') await selectedHeading.click();
  await openCategorySettings(page);
  await (await categoryPopup(page)).locator('fieldset:not([hidden]) input[type="radio"][value="any"]').check();
  await waitForCategories(page);
  await expect.poll(() => new URL(page.url()).searchParams.has('row_group_mode')).toBe(false);
  await (await categoryPopup(page)).locator('fieldset:not([hidden]) input[type="radio"][value="all"]').check();
  await waitForCategories(page);
  await page.locator('[data-testid="active-filters-clear-all"]').click();
  await waitForCategories(page);
  // Clearing updates the address a moment after the click; the panel is not busy in between.
  await expect.poll(() => new URL(page.url()).searchParams.has('row_group_mode')).toBe(false);
  await expect.poll(() => new URL(page.url()).searchParams.has('row_group')).toBe(false);
  // The open heading stays open through the clearing re-render; a click would close it.
  const clearedHeading = page.locator(`${PANEL} [data-heading-id="${chosenHeading}"]`);
  if (await clearedHeading.getAttribute('aria-expanded') !== 'true') await clearedHeading.click();
  await openCategorySettings(page);
  await expect((await categoryPopup(page)).locator('fieldset:not([hidden]) input[type="radio"][value="any"]')).toBeChecked();
});
