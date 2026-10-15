/**
 * T16_workline_observatory_scroll.spec.ts
 * Proves desktop scroll ownership, sticky headings and unchanged phone layout.
 * Connects the real observatory shell with copies of existing board fixture rows.
 * Uses GET response fixtures only; no dataset, workline or account preference is saved.
 */
import { test, expect, type Page } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';

const accountTheme = (url: URL) => url.pathname === '/api/user-visual-preference';

/** Expand existing fixture rows in the response only, independently of T13's mutations. */
async function overflowExistingBoard(page: Page) {
  await page.route('**/api/app/workline-observatory/board*', async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const snapshot = await response.json();
    expect(snapshot.worklines.length, 'Native fixture must have an existing workline').toBeGreaterThan(0);
    const worklines = Array.from({ length: 64 }, (_, index) => ({
      ...snapshot.worklines[index % snapshot.worklines.length], id: 10_000_000 + index,
    }));
    await route.fulfill({ response, json: { ...snapshot, worklines, total_count: 64, filtered_count: 64 } });
  });
}

async function expectContentScrollers(page: Page, width: number) {
  const owners = await page.locator('.tab-content-area').filter({
    has: page.locator('.workline-observatory__board'),
  }).evaluate((area) => {
    const candidates: Element[] = [...area.querySelectorAll('*')];
    for (let ancestor: Element | null = area; ancestor; ancestor = ancestor.parentElement) candidates.push(ancestor);
    return candidates.filter((element) => {
      const style = getComputedStyle(element);
      return element.clientHeight > 0 && element.clientWidth > 0
        && /^(auto|scroll)$/.test(style.overflowY)
        && element.scrollHeight > element.clientHeight + 1;
    }).map((element) => element.className);
  });
  expect(owners).toEqual(width > 900
    ? ['scrollable_content']
    : ['scrollable_content', 'workline-observatory__board']);
  expect(await page.evaluate(() => {
    const root = document.scrollingElement!;
    return root.scrollHeight - root.clientHeight;
  })).toBeLessThanOrEqual(1);
}

for (const theme of ['light', 'dark'] as const) {
  // Each viewport is a separate test: native loading uses the ordinary timeout.
  for (let size = 0; size < 9; size += 1) {
    test(`WO13 ${theme}, viewport case ${size + 1}`, async ({ page }, testInfo) => {
      const band = testInfo.project.metadata.screenWidth;
      const widths = band === 'mobile' ? [375, 390, 600] : band === 'tablet' ? [768, 900, 1024] : [1280, 1920, 2560];
      const heights = band === 'mobile' ? [667, 844, 900] : [700, 1080, 1440];
      const width = widths[size % 3];
      const height = heights[Math.floor(size / 3)];
      const screenshotSize = (width === 1920 && height === 1080) || (width === 390 && height === 844);
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await page.route(accountTheme, async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        await route.fulfill({ json: { theme_mode: theme, revision: 1, configured: true } });
      });
      await login(page, loadCredentials());
      const originalLanguage = await page.evaluate(() => localStorage.getItem('chosen_language'));
      try {
        await page.evaluate(() => localStorage.setItem('chosen_language', 'fi'));
        await overflowExistingBoard(page);
        await page.goto('/admin/workline_observatory?workline_observatory_status=active', { waitUntil: 'domcontentloaded' });
        const board = page.locator('.workline-observatory__board');
        const view = page.locator('.workline-observatory-view');
        const scroller = page.locator('.tab-content-body > .scrollable_content').filter({ has: view });
        const toolbar = page.locator('.workline-observatory__status-toolbar');
        const heading = page.locator('.workline-observatory__board-heading');
        await expect(board).toBeVisible();
        await expect(page.locator('.workline-observatory__workline-row')).toHaveCount(64);
        await expect(page.locator('body')).toHaveClass(new RegExp(`${theme}-mode`));
        await expect(page.locator('.workline-observatory__priority-heading')).toHaveText('Prioriteetti');
        expect(await scroller.evaluate((element) => element.scrollHeight > element.clientHeight + 1)).toBe(true);
        await expectContentScrollers(page, width);
        if (screenshotSize) await page.screenshot({ path: testInfo.outputPath(`workline-${theme}-${width}x${height}-top.png`) });

        await scroller.evaluate((element, desktop) => {
          if (!desktop) { element.scrollTop = 500; return; }
          // The shared scrollport includes the hero/search header. Scroll past
          // the actual heading so translated copy cannot leave it below sticky.
          const phaseHeading = element.querySelector('.workline-observatory__board-heading')!;
          element.scrollTop += phaseHeading.getBoundingClientRect().top
            - element.getBoundingClientRect().top - element.clientTop;
        }, width > 900);
        if (width > 900) {
          await expect(toolbar).toHaveAttribute('data-compact', 'true');
          await expect(heading).toHaveCSS('position', 'sticky');
          await expect.poll(() => toolbar.evaluate((element) => {
            const owner = element.closest('.scrollable_content')!;
            return Math.abs(element.getBoundingClientRect().top - owner.getBoundingClientRect().top - owner.clientTop);
          })).toBeLessThanOrEqual(1);
          await expect.poll(() => heading.evaluate((element) => {
            const controls = document.querySelector('.workline-observatory__status-toolbar')!;
            return Math.abs(element.getBoundingClientRect().top - controls.getBoundingClientRect().bottom);
          })).toBeLessThanOrEqual(1);
          await expect(view).toHaveCSS('overflow-y', 'visible');
          await expect(board).toHaveCSS('overflow-y', 'visible');
        } else {
          // Preserve the original <=900px geometry and nested board scrollport.
          await expect(view).toHaveCSS('overflow-x', 'auto');
          await expect(board).toHaveCSS('overflow-x', 'auto');
          await expect(board).toHaveCSS('overflow-y', 'auto');
          await expect(toolbar).toHaveCSS('top', '-20px');
          await expect(heading).toHaveCSS('position', 'static');
          expect(await view.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
          expect(await board.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeGreaterThan(1);
        }
        if (screenshotSize) await page.screenshot({ path: testInfo.outputPath(`workline-${theme}-${width}x${height}-scrolled.png`) });

        const lastTitle = page.locator('.workline-observatory__workline-title').last();
        await lastTitle.focus();
        await expect(lastTitle).toBeInViewport();
        await expect(lastTitle).toBeFocused();
        // Narrow screens may consume PageUp in either original content owner.
        // Above 900px this remains the shared scroller's scrollTop assertion.
        const scrollPosition = async () => await scroller.evaluate((element) => element.scrollTop)
          + (width <= 900 ? await board.evaluate((element) => element.scrollTop) : 0);
        const bottom = await scrollPosition();
        await page.keyboard.press('PageUp');
        await expect.poll(scrollPosition).toBeLessThan(bottom);
        await page.locator('.workline-observatory__target-row').last().scrollIntoViewIfNeeded();
        await expect(page.locator('.workline-observatory__target-row').last()).toBeInViewport();
        await expectContentScrollers(page, width);
        if (width > 900) {
          await scroller.evaluate((element) => { element.scrollLeft = 0; });
          await expect(page.locator('.workline-observatory__status-action').first()).toBeInViewport();
        }
      } finally {
        await page.evaluate((language) => {
          if (language === null) localStorage.removeItem('chosen_language');
          else localStorage.setItem('chosen_language', language);
        }, originalLanguage);
        await page.unroute(accountTheme);
        await page.unroute('**/api/app/workline-observatory/board*');
      }
    });
  }
}
