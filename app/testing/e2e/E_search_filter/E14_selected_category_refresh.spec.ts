// E14_selected_category_refresh.spec.ts
// Verifies centred selected chips and one populated result update per category change.
// Connects native category responses, DOM commits, keyboard removal and explicit themes.
// Delays read-only listing replies to prove pending and superseded refresh behaviour.

import { test, expect, type Page, type Route } from '@playwright/test';

const DATASET = process.env.FILTEREST_E2E_CATEGORY_DATASET || '';
const LANGUAGES = (process.env.FILTEREST_E2E_CATEGORY_LANGUAGES || 'fi,en').split(',');
const PANEL = `#${DATASET}_row_group_facets`;
const CONTAINER = `#${DATASET}_card_view_container`;
test.use({ storageState: { cookies: [], origins: [] } });

function firstPage(url: string) {
  const parsed = new URL(url);
  return parsed.pathname === '/api/get-results' && parsed.searchParams.get('dataset') === DATASET
    && Number(parsed.searchParams.get('offset') || 0) === 0;
}

async function waitForCategories(page: Page) {
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator(PANEL)).not.toHaveAttribute('aria-busy', 'true');
}

async function openValues(page: Page) {
  const headings = page.locator(`${PANEL} [data-heading-id]`);
  for (let index = 0; index < await headings.count(); index += 1) {
    if (!await headings.nth(index).isVisible()) continue;
    await headings.nth(index).click();
    const id = await headings.nth(index).getAttribute('aria-controls');
    const values = page.locator(`#${id} [role="option"][aria-selected="false"]:not([aria-disabled="true"])`);
    if (await values.count() >= 2) return { values, popup: page.locator(`#${id}`) };
    await headings.nth(index).click();
  }
  throw new Error('The category fixture needs a visible heading with two readable values.');
}

// Observe actual result-surface replacements and sample frames during delayed replies.
// Later-page appends belong to endless scrolling and are not first-page refreshes.
async function startResultProbe(page: Page) {
  await page.locator(CONTAINER).evaluate(container => {
    const probe = { commits: 0, emptyFrames: 0, running: true };
    const observer = new MutationObserver(records => {
      probe.commits += records.filter(record => record.target === container
        && [...record.addedNodes].some(node => (node as HTMLElement).classList?.contains('dataset-results-surface'))).length;
    });
    observer.observe(container, { childList: true });
    const sample = () => {
      if (!probe.running) return;
      if (!container.querySelector('.card_view_wrapper')) probe.emptyFrames += 1;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    (window as any).__categoryRefreshProbe = { probe, observer };
  });
}

async function finishResultProbe(page: Page) {
  return page.evaluate(() => {
    const { probe, observer } = (window as any).__categoryRefreshProbe;
    probe.running = false; observer.disconnect();
    return { commits: probe.commits, emptyFrames: probe.emptyFrames };
  });
}

async function assertCentredChips(page: Page) {
  await expect.poll(async () => page.locator(PANEL).evaluate(panel => {
    const controls = panel.parentElement!;
    const tags = controls.querySelector('.active_filters')!;
    const box = panel.getBoundingClientRect();
    const row = tags.getBoundingClientRect();
    const parent = controls.getBoundingClientRect();
    const inside = [...tags.children].every(child => {
      const chip = child.getBoundingClientRect();
      return chip.left >= row.left - 1 && chip.right <= row.right + 1;
    });
    return Math.abs(row.width - box.width) <= 1 && Math.abs(row.left - box.left) <= 1
      && Math.abs(row.left + row.width / 2 - parent.left - parent.width / 2) <= 1 && inside
      && row.right <= window.innerWidth + 1;
  })).toBe(true);
  const touch = await page.evaluate(() => innerWidth <= 600 || matchMedia('(any-pointer: coarse)').matches);
  for (const button of await page.locator(`${CONTAINER} .active_filters button`).all()) {
    const size = await button.boundingBox();
    expect(size).toBeTruthy();
    if (touch) { expect(size!.width).toBeGreaterThanOrEqual(44); expect(size!.height).toBeGreaterThanOrEqual(44); }
    else if (await button.getAttribute('data-testid') === 'active-filter-remove') {
      expect(size!.width).toBe(24); expect(size!.height).toBe(24);
    }
  }
}

for (const language of LANGUAGES) for (const theme of ['light', 'dark'] as const) {
  test(`WL103 polish: centred chips and latest category refresh (${language}, ${theme})`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    test.skip(!/^[a-z][a-z0-9_]{0,62}$/.test(DATASET), 'Set FILTEREST_E2E_CATEGORY_DATASET to an existing readable categorized dataset.');
    test.skip(testInfo.project.metadata.cardView === 'big', 'Uses the shared listing controls.');
    await page.addInitScript(({ language, theme }) => {
      localStorage.setItem('chosen_language', language); localStorage.setItem('theme', theme);
    }, { language, theme });
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    await page.goto(`/${DATASET}?view=card`);
    await waitForCategories(page);
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
    const clear = page.locator(`${CONTAINER} .active-filters-clear-all`);
    if (await clear.isVisible()) { await clear.click(); await waitForCategories(page); }
    const { values, popup } = await openValues(page);
    const slugs = await values.evaluateAll(options => options.slice(0, 2).map(option => (option as HTMLElement).dataset.optionValue!));
    const replies: { route: Route; release: () => void; done: Promise<void> }[] = [];
    let requests = 0;
    const holdFirstPageReply = async (route: Route) => {
      if (!firstPage(route.request().url())) { await route.continue(); return; }
      requests += 1;
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      let complete!: () => void;
      const done = new Promise<void>(resolve => { complete = resolve; });
      replies.push({ route, release, done });
      const response = await route.fetch();
      await gate; await route.fulfill({ response }); complete();
    };
    await page.route('**/api/get-results?**', holdFirstPageReply);
    await startResultProbe(page);
    await popup.locator(`[data-option-value="${slugs[0]}"]`).click();
    await expect.poll(() => replies.length).toBe(1);
    await page.waitForTimeout(200);
    await expect(page.locator(`${CONTAINER} .card_view_wrapper`)).toBeVisible();
    replies[0].release(); await replies[0].done; await waitForCategories(page);
    await page.waitForTimeout(200);
    expect(requests).toBe(1);
    expect(await finishResultProbe(page)).toEqual({ commits: 1, emptyFrames: 0 });

    // Toggle a second value, then remove it before its first reply arrives.
    // Deliver the newer reply first; the earlier reply must never redraw results.
    await startResultProbe(page);
    await popup.locator(`[data-option-value="${slugs[1]}"]`).click();
    await expect.poll(() => replies.length).toBe(2);
    await popup.locator(`[data-option-value="${slugs[1]}"]`).click();
    await expect.poll(() => replies.length).toBe(3);
    replies[2].release(); await replies[2].done;
    await expect.poll(async () => page.evaluate(() => (window as any).__categoryRefreshProbe.probe.commits)).toBe(1);
    replies[1].release(); await replies[1].done; await waitForCategories(page);
    await page.waitForTimeout(200);
    expect(requests).toBe(3);
    expect(await finishResultProbe(page)).toEqual({ commits: 1, emptyFrames: 0 });
    await expect(page.locator(`${CONTAINER} [data-row-group-slug="${slugs[1]}"]`)).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('row_group')?.split(',')).toEqual([slugs[0]]);
    await page.unroute('**/api/get-results?**');

    await popup.locator('.msd-popup-close').click();
    // Two chips demonstrate wrapping inside the same column at narrow widths.
    await page.locator(`${PANEL} [data-heading-id][aria-controls="${await popup.getAttribute('id')}"]`).click();
    await popup.locator(`[data-option-value="${slugs[1]}"]`).click(); await waitForCategories(page);
    await popup.locator('.msd-popup-close').click();
    await assertCentredChips(page);
    await page.screenshot({ path: testInfo.outputPath(`selected-categories-${language}-${theme}.png`), fullPage: true });
    // Settle the chip-removal refresh between Clear all's focus and Enter.
    // Its panel is not busy for tag removal, so control identity must survive.
    replies.length = 0;
    await page.route('**/api/get-results?**', holdFirstPageReply);
    await startResultProbe(page);
    const remove = page.locator(`${CONTAINER} [data-row-group-slug="${slugs[1]}"] button`);
    await remove.focus(); await remove.press('Enter'); await waitForCategories(page);
    await expect(page.locator(`${CONTAINER} [data-row-group-slug="${slugs[1]}"]`)).toHaveCount(0);
    await expect.poll(() => replies.length).toBe(1);
    await clear.focus();
    replies[0].release(); await replies[0].done;
    await expect.poll(() => page.evaluate(() => (window as any).__categoryRefreshProbe.probe.commits)).toBe(1);
    expect(await finishResultProbe(page)).toEqual({ commits: 1, emptyFrames: 0 });
    await expect(clear).toBeFocused();
    await page.unroute('**/api/get-results?**');
    await clear.press('Enter'); await waitForCategories(page);
    await expect(page.locator(`${CONTAINER} .active_filters`)).toBeHidden();
  });
}
