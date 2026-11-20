// C34_visitor_row_address_image_first.spec.ts
// Proves a signed-out visitor who follows a plain article address reads that article when the dataset opens its rows
// image-first: the production case behind search results, the sitemap, the plain article index and shared links (WL175).
// Connects a disposable visitor-readable dataset, its row-opening setting, a saved default sort and the browser address.
// Reads the site's browsing policy without changing it, and removes its dataset whether the case passes or fails.
import { test, expect, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest } from '../helpers/temp-dataset';
import { saveSiteSortDefault, setRowOpeningOverride } from '../helpers/row-opening-override';

test.use({ storageState: { cookies: [], origins: [] } });

const FIRST = 'Aurora cabin';
const SECOND = 'Birch sauna';
const PAGE = '.image_first_page_view';
const CLOSE = '.image_first_view_modal [data-testid="modal-close-button"]';
const PAGE_VIEW_RIGHT = '/ui/view/image_first_page_view';

/** The open page-sized article shows this row, in the address as well as on screen. */
async function expectArticle(page: Page, title: string, rowId: number) {
  await expect(page.locator(`${PAGE} .image_first_view_article_content`)).toContainText(title);
  await expect(page).toHaveURL(new RegExp(`/${rowId}(?:-[^/?]*)?\\?(?:.*&)?view=image_first_page_view`));
  // The browser tab, and what a search engine reads after rendering, name the article.
  await expect(page).toHaveTitle(new RegExp(`^${title}`));
}

test('a visitor who follows a plain article address reads that article and closes it onto the list', async ({ page, browser, playwright }, info) => {
  test.setTimeout(180_000);
  const modes = await (await page.request.get('/api/auth-modes')).json();
  test.skip(Boolean(modes.login_required_for_browse), 'Visitors cannot browse this installation; this proof never changes that.');
  test.skip(!(modes.guest_ui_endpoints || []).includes(PAGE_VIEW_RIGHT), 'Visitors may not open the page-sized article on this installation.');
  // A new context does not take the project's size by itself: the next visitor reads at this project's width too.
  const fresh = { baseURL: info.project.use.baseURL, ignoreHTTPSErrors: true, extraHTTPHeaders: info.project.use.extraHTTPHeaders,
    viewport: info.project.use.viewport, storageState: { cookies: [], origins: [] } };
  const owner = await browser.newContext(fresh);
  const dataset = buildTempDatasetName('e2e_visitor_row');
  let cleanupRequest: APIRequestContext | undefined;
  let nextVisitor: BrowserContext | undefined;
  let created = false;
  try {
    const ownerPage = await owner.newPage();
    await login(ownerPage, loadCredentials());
    cleanupRequest = await playwright.request.newContext({ ...fresh, storageState: await owner.storageState() });
    await createTempDataset(ownerPage, {
      datasetName: dataset, grantGuestsRead: true, grantUsersRead: false,
      columns: { id: 'SERIAL', title: 'TEXT', description: 'TEXT' },
      seedRows: [{ title: FIRST, description: 'The older row' }, { title: SECOND, description: 'The newer row' }],
    });
    created = true;
    await setRowOpeningOverride(ownerPage, dataset, 'image_first_page_view');
    // Newest first is the list's own order; only the saved default (oldest first) lists the first row first.
    await saveSiteSortDefault(ownerPage, dataset, '__newest:ASC');

    // A plain row address, as a search result or a shared link gives it. The list behind the article used to put
    // its own address in its place (its settled view, the saved sort), and the visitor got the list (9.6.12).
    await page.goto(`/${dataset}/1`);
    await expectArticle(page, FIRST, 1);
    // The server's plain copy of the article stays in the page for readers without the application, out of sight.
    expect(await page.evaluate(() => {
      const copy = document.querySelector('[data-server-article]') as HTMLElement | null;
      return !copy || getComputedStyle(copy).display === 'none';
    })).toBe(true);

    // The address a visitor copies from the open article opens the same article for the next first-time visitor.
    const copied = page.url();
    nextVisitor = await browser.newContext(fresh);
    const shared = await nextVisitor.newPage();
    await shared.goto(copied);
    await expectArticle(shared, FIRST, 1);

    // The sitemap names a language in each address; it opens the same way and keeps the language.
    await page.goto(`/${dataset}/2?lang=fi`);
    await expectArticle(page, SECOND, 2);
    await expect(page).toHaveURL(/[?&]lang=fi(?:&|$)/);

    // Closing returns to the list, which now gets the sort the site saved for it. The language stays in the
    // address as the page's own setting; it is not a filter of the rows, and the list shows none.
    await page.locator(CLOSE).click();
    await expect(page.locator(PAGE)).toHaveCount(0);
    await expect(page).toHaveURL(/\?(?=.*lang=fi)(?=.*view=card)(?=.*sort_column=__newest)(?=.*sort_order=ASC)/);
    await expect(page).not.toHaveURL(/\/2(?:-[^/?]*)?\?/);
    await expect(page.locator('[data-testid="active-filter-item"]')).toHaveCount(0);
    await expect.poll(() => page.locator('[data-testid="card-item-header"]:visible').allTextContents()).toEqual([FIRST, SECOND]);
    await expect(page).not.toHaveTitle(new RegExp(`^${SECOND}`));
  } finally {
    try {
      if (created && cleanupRequest) await cleanupDatasetViaRequest(cleanupRequest, dataset);
    } finally {
      await cleanupRequest?.dispose();
      await nextVisitor?.close();
      await owner.close();
    }
  }
});
