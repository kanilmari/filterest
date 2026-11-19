// G23_readable_article_fallback.spec.ts
// Proves an article can be read without the application: with JavaScript off, when the application cannot start,
// and through the plain index the menu links to (WL175, owner decisions D1 and D4).
// Connects index.html's server fallback, shell_boot_recovery.css/js and router/public_articles_page.go.
// Uses only what a signed-out visitor may read; skips on an installation that requires signing in.
import { test, expect, type Browser, type Page } from '@playwright/test';
import { waitForAppReady } from '../helpers/navigation';

test.use({ storageState: { cookies: [], origins: [] } });

type Catalogue = { datasets: Array<{ dataset_name: string; preferred_name: string;
    is_top_level_in_current_project?: boolean; can_read_rows?: boolean }> };

// A visitor-readable article address in a menu dataset, as the plain index lists it.
async function firstPublishedArticle(page: Page): Promise<{ list: string; article: string } | null> {
    const index = await page.request.get('/articles');
    if (index.status() === 404) return null;
    expect(index.ok(), await index.text()).toBe(true);
    await page.goto('/articles');
    const listLink = page.locator('main h2 a').first();
    const articleLink = page.locator('main li a').first();
    if (await articleLink.count() === 0) return null;
    return { list: (await listLink.getAttribute('href'))!, article: (await articleLink.getAttribute('href'))! };
}

async function fallbackState(page: Page) {
    return page.evaluate(() => {
        const fallback = document.querySelector('[data-server-article]') as HTMLElement | null;
        const notice = document.getElementById('shell-boot-notice');
        return {
            shown: !!fallback && getComputedStyle(fallback).display !== 'none' && fallback.getBoundingClientRect().height > 0,
            heading: fallback?.querySelector('h1')?.textContent?.trim() || '',
            noticeCovers: !!notice && !notice.hidden && getComputedStyle(notice).position === 'fixed',
            scrolls: getComputedStyle(document.body).overflowY !== 'hidden',
        };
    });
}

async function withoutJavaScript(browser: Browser, address: string, run: (page: Page) => Promise<void>) {
    const context = await browser.newContext({ javaScriptEnabled: false, ignoreHTTPSErrors: true, storageState: { cookies: [], origins: [] } });
    try {
        const page = await context.newPage();
        await page.goto(address);
        await run(page);
    } finally {
        await context.close();
    }
}

test('an article is readable without JavaScript, after a failed start, and from the plain index', async ({ page, browser }) => {
    const published = await firstPublishedArticle(page);
    test.skip(!published, 'this installation publishes no article to signed-out visitors');
    const { article } = published!;

    // The plain index and its lists are ordinary documents with no application script.
    expect(await page.locator('script[type="module"]').count()).toBe(0);

    await withoutJavaScript(browser, article, async plain => {
        const state = await fallbackState(plain);
        expect(state.shown).toBe(true);
        expect(state.heading.length).toBeGreaterThan(0);
        expect(state.noticeCovers).toBe(false);
        expect(state.scrolls).toBe(true);
        await expect(plain.locator('.shell-boot-noscript')).toBeVisible();
        await expect(plain.locator('[data-server-article] a[href^="/articles"]')).toBeVisible();
    });

    // A normal start shows the application and keeps the plain copy out of sight.
    await page.goto(article);
    await waitForAppReady(page);
    await page.waitForLoadState('networkidle');
    expect((await fallbackState(page)).shown).toBe(false);
    const menuLink = page.locator('[data-testid="navbar-all-articles"]');
    await expect(menuLink).toHaveAttribute('href', '/articles');

    // When the application's code cannot load, the same article appears under a slim notice.
    const failing = await browser.newContext({ ignoreHTTPSErrors: true, storageState: { cookies: [], origins: [] } });
    try {
        const broken = await failing.newPage();
        await broken.route(/\/frontend\/(main\.js|dist\/main[^/]*\.js)(\?.*)?$/, route => route.abort());
        await broken.route(/^https?:\/\/localhost:5173\//, route => route.abort());
        await broken.goto(article);
        await expect.poll(async () => (await fallbackState(broken)).shown, { timeout: 15000 }).toBe(true);
        const state = await fallbackState(broken);
        expect(state.noticeCovers).toBe(false);
        expect(state.scrolls).toBe(true);
        await expect(broken.locator('#shell-boot-reload')).toBeVisible();
    } finally {
        await failing.close();
    }
});
