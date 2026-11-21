// C35_card_links.spec.ts
// Proves a signed-out visitor's card list links each row's article with a real link: the title and the footer's
// "show more" name the article's readable address, so search engines follow them and a person can open one in a new
// tab, while an ordinary click still opens the article in place without loading a new page (WL175).
// Connects a disposable visitor-readable dataset, the card list, the server's article address check and new tabs.
// Reads the site's browsing policy without changing it, and removes its dataset whether the case passes or fails.
import { test, expect, type APIRequestContext } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest } from '../helpers/temp-dataset';

test.use({ storageState: { cookies: [], origins: [] } });

const ROWS = [
  { title: 'Aurora cabin', words: 'aurora-cabin' },
  { title: 'Birch sauna', words: 'birch-sauna' },
];
const ARTICLE_VIEW_RIGHT = '/ui/view/article_view';

test('a visitor\'s card titles and show-more links are real links to the article, opened in place on a click', async ({ page, browser, playwright }, info) => {
  test.setTimeout(180_000);
  const modes = await (await page.request.get('/api/auth-modes')).json();
  test.skip(Boolean(modes.login_required_for_browse), 'Visitors cannot browse this installation; this proof never changes that.');
  test.skip(!(modes.guest_ui_endpoints || []).includes(ARTICLE_VIEW_RIGHT), 'Visitors may not open articles on this installation.');
  const fresh = { baseURL: info.project.use.baseURL, ignoreHTTPSErrors: true, extraHTTPHeaders: info.project.use.extraHTTPHeaders,
    viewport: info.project.use.viewport, storageState: { cookies: [], origins: [] } };
  const owner = await browser.newContext(fresh);
  const dataset = buildTempDatasetName('e2e_card_links');
  let cleanupRequest: APIRequestContext | undefined;
  let created = false;
  try {
    const ownerPage = await owner.newPage();
    await login(ownerPage, loadCredentials());
    cleanupRequest = await playwright.request.newContext({ ...fresh, storageState: await owner.storageState() });
    await createTempDataset(ownerPage, {
      datasetName: dataset, grantGuestsRead: true, grantUsersRead: false,
      columns: { id: 'SERIAL', title: 'TEXT', description: 'TEXT' },
      seedRows: ROWS.map(row => ({ title: row.title, description: `About ${row.title}` })),
    });
    created = true;

    await page.goto(`/${dataset}?view=card`);
    const titles = page.locator(`#${dataset}_card_view_container .card [data-testid="card-item-header"]`);
    await expect(titles).toHaveCount(ROWS.length, { timeout: 30_000 });

    // Each title and footer link names the article's readable address: the dataset, the row and the title's words,
    // without the list's view, filters or a pinned presentation (the plain address opens the default one).
    const addresses = new Map<string, string>();
    for (const [index, row] of ROWS.entries()) {
      const card = page.locator(`#${dataset}_card_view_container .card[data-id="${index + 1}"]`);
      const title = card.locator('[data-testid="card-item-header"]');
      await expect(title).toHaveText(row.title);
      expect(await title.evaluate(element => element.tagName)).toBe('A');
      const href = await title.getAttribute('href');
      expect(href).toBe(`/${dataset}/${index + 1}-${row.words}`);
      await expect(card.locator('.card_footer > a.card_footer_show_more')).toHaveAttribute('href', href!);
      addresses.set(row.title, href!);
    }

    // The server takes each link address as the article's own: no redirect to another address.
    for (const href of addresses.values()) {
      const answer = await page.request.get(href, { maxRedirects: 0 });
      expect(answer.status(), href).toBe(200);
    }

    // The dataset tabs above the list, where this installation shows them, are links to the datasets too.
    for (const tab of await page.locator('.hero-dataset-tabs__button[data-dataset]').all()) {
      expect(await tab.evaluate(element => element.tagName)).toBe('A');
      await expect(tab).toHaveAttribute('href', /^\/[^/?#]+$/);
    }

    // Ctrl+click leaves the link to the browser: the article opens in a new tab and this page stays on the list.
    const listAddress = page.url();
    const [newTab] = await Promise.all([
      page.context().waitForEvent('page'),
      titles.filter({ hasText: ROWS[1].title }).click({ modifiers: ['Control'] }),
    ]);
    // A new tab starts blank and then loads the link's address.
    await newTab.waitForURL(url => url.pathname === addresses.get(ROWS[1].title), { timeout: 30_000 });
    await newTab.close();
    expect(page.url()).toBe(listAddress);
    await expect(page.locator('[data-testid="big-card-container"]:visible')).toHaveCount(0);

    // An ordinary click opens the article in the same document: nothing reloads.
    await page.evaluate(() => { (window as unknown as { __c35SameDocument: boolean }).__c35SameDocument = true; });
    await titles.filter({ hasText: ROWS[0].title }).click();
    await expect(page.locator('[data-testid="big-card-container"]:visible').first()).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`/${dataset}/1(?:[-?#]|$)`));
    expect(await page.evaluate(() => (window as unknown as { __c35SameDocument?: boolean }).__c35SameDocument)).toBe(true);

    // A page opened in an explicit language keeps it in the links it writes, when the site offers that language.
    await page.goto(`/${dataset}?view=card&lang=en`);
    await expect(titles).toHaveCount(ROWS.length, { timeout: 30_000 });
    if ((await page.evaluate(() => document.documentElement.lang)).startsWith('en')) {
      await expect(page.locator(`#${dataset}_card_view_container .card[data-id="1"] [data-testid="card-item-header"]`))
        .toHaveAttribute('href', `/${dataset}/1-${ROWS[0].words}?lang=en`);
    } else {
      info.annotations.push({ type: 'skip-part', description: 'English is not an enabled language here.' });
    }
  } finally {
    try {
      if (created && cleanupRequest) await cleanupDatasetViaRequest(cleanupRequest, dataset);
    } finally {
      await cleanupRequest?.dispose();
      await owner.close();
    }
  }
});
