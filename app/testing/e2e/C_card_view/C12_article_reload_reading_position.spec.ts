/**
 * C12_article_reload_reading_position.spec.ts
 *
 * Verifies that pressing F5 on an open article's own row address keeps the
 * related tab the reader chose and the article's scroll position, and that a
 * page load which does not name that row forgets both.
 * Bridges this tab's open-row state (table_state_store.js), the page-load
 * forgetting (table_loader_handler.js) and the article's restore
 * (row_article_view_restore_state.js) in a real browser.
 * Exists because this reading position is a long-lived product contract that
 * already regressed once, when every page load forgot it (WL136, fixed in WL137).
 */

import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import {
  buildTempDatasetName,
  createTempDataset,
  dropTempDataset,
  openTempDatasetRowArticle,
} from '../helpers/temp-dataset';

const ARTICLE_CONTENT = '.content_div:not(.hidden) .row_article_container.active_row_article > .row_article_content';
const LONG_DESCRIPTION = Array.from({ length: 300 }, (_, index) =>
  `Sentence ${index + 1} keeps this article long enough to scroll.`).join(' ');

type ReadingPosition = {
  activeTabKey: string | null;
  tabKeys: string[];
  scrollTop: number;
  scrollRange: number;
};

function runsOnThisProject(project: TestInfo['project']): boolean {
  return project.metadata?.screenWidth === 'desktop' && project.metadata?.cardView === 'normal';
}

/** What the open article shows: its related tabs and how far it is scrolled. */
async function readReadingPosition(page: Page): Promise<ReadingPosition> {
  return page.evaluate((selector) => {
    const content = document.querySelector<HTMLElement>(selector);
    const buttons = [...(content?.querySelectorAll<HTMLElement>('.related_tab_button') ?? [])];
    return {
      activeTabKey: buttons.find((button) => button.classList.contains('active'))?.dataset.tabKey ?? null,
      tabKeys: buttons.map((button) => button.dataset.tabKey ?? ''),
      scrollTop: content ? Math.round(content.scrollTop) : -1,
      scrollRange: content ? content.scrollHeight - content.clientHeight : -1,
    };
  }, ARTICLE_CONTENT);
}

/**
 * Waits until the article has its related tabs and stops changing size and
 * position. Its related rows open with an animation and load afterwards, and
 * while that runs the browser moves the scroll position to keep the visible
 * content in place; a position read earlier is not yet the one the page keeps.
 */
async function waitForSettledArticle(page: Page): Promise<ReadingPosition> {
  let previous = '';
  await expect.poll(async () => {
    const shown = await readReadingPosition(page);
    const current = `${shown.activeTabKey}/${shown.scrollTop}/${shown.scrollRange}`;
    const settled = shown.tabKeys.length >= 2 && current === previous;
    previous = current;
    return settled;
  }, { timeout: 20_000, intervals: [500] }).toBe(true);
  return readReadingPosition(page);
}

test.describe("C12 — F5 keeps an open article's reading position", () => {
  let credentials: TestCredentials;
  const parent = buildTempDatasetName('e2e_reading_parent');
  const children = [buildTempDatasetName('e2e_reading_child_a'), buildTempDatasetName('e2e_reading_child_b')];
  const created: string[] = [];

  test.beforeAll(async ({ browser }, workerInfo) => {
    credentials = loadCredentials();
    if (!runsOnThisProject(workerInfo.project)) return;
    // Signing in and creating three datasets with 25 seeded rows can outlast the default 30 s on a busy machine.
    test.setTimeout(90_000);
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      await login(page, credentials);
      // A parent row long enough to scroll, with two related-row tabs.
      await createTempDataset(page, {
        datasetName: parent,
        columns: { id: 'SERIAL', title: 'TEXT', description: 'TEXT' },
        seedRows: [{ title: 'Reading position', description: LONG_DESCRIPTION }],
      });
      created.push(parent);
      for (const child of children) {
        await createTempDataset(page, {
          datasetName: child,
          columns: { id: 'SERIAL', name: 'TEXT', parent_ref: 'INTEGER' },
          foreignKeys: [{ referencing_column: 'parent_ref', referenced_dataset: parent, referenced_column: 'id' }],
          seedRows: Array.from({ length: 12 }, (_, index) => ({ name: `Related row ${index + 1}`, parent_ref: 1 })),
        });
        created.push(child);
      }
    } finally {
      await context.close();
    }
  });

  test.afterAll(async ({ browser }) => {
    if (created.length === 0) return;
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    try {
      await login(page, credentials);
      for (const name of [...created].reverse()) {
        await dropTempDataset(page, name);
      }
    } finally {
      await context.close();
    }
  });

  test('the same row address restores both; a load without the row forgets them', async ({ page }, testInfo) => {
    test.skip(!runsOnThisProject(testInfo.project), 'One desktop project proves this per-tab contract.');
    test.setTimeout(90_000);
    await login(page, credentials);
    // The scroll position is kept in pixels, so the article needs the same
    // width in both page loads. A dataset created moments ago can show its
    // filter bar on the first visit and not after the reload; the person's own
    // stored choice holds in both.
    await page.evaluate((dataset) => localStorage.setItem(`${dataset}_filterbar_visible`, 'false'), parent);

    await openTempDatasetRowArticle(page, parent, 1);
    const opened = await waitForSettledArticle(page);
    const otherTab = opened.tabKeys.find((key) => key !== opened.activeTabKey);
    expect(otherTab, 'the article needs a second related tab').toBeTruthy();
    expect(opened.scrollRange, 'the article must be long enough to scroll').toBeGreaterThan(1000);

    // Choose the other related tab, then scroll back up into the article.
    await page.locator(`${ARTICLE_CONTENT} .related_tab_button[data-tab-key="${otherTab}"]`).click();
    await waitForSettledArticle(page);
    const box = await page.locator(ARTICLE_CONTENT).boundingBox();
    if (!box) throw new Error('The article content has no box to scroll.');
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300));
    await page.mouse.wheel(0, -1500);
    const before = await waitForSettledArticle(page);
    expect(before.activeTabKey).toBe(otherTab);
    expect(before.scrollTop, 'a position inside the article, not its top').toBeGreaterThan(500);
    expect(before.scrollTop, 'a position inside the article, not its end').toBeLessThan(before.scrollRange - 100);
    const rowAddress = page.url();

    // F5 on the same row address.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid="big-card-container"]:visible').first()).toBeVisible({ timeout: 20_000 });
    const after = await waitForSettledArticle(page);
    expect(page.url()).toBe(rowAddress);
    expect(after.scrollRange, 'the article keeps its size across the reload').toBe(before.scrollRange);
    expect(after.activeTabKey).toBe(otherTab);
    expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThanOrEqual(2);

    // A page load that names no row forgets both: the article opens afresh.
    await openTempDatasetRowArticle(page, parent, 1);
    const reopened = await waitForSettledArticle(page);
    expect(reopened.activeTabKey).toBe(opened.activeTabKey);
    expect(reopened.scrollTop).toBeLessThanOrEqual(2);
  });
});
