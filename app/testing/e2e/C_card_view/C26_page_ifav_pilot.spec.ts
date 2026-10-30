// C26_page_ifav_pilot.spec.ts
// Proves the two explicit Page pilot entry paths with disposable rows and media.
// Connects native APIs, real Page history and the existing IFAV denial notice.
// Restores only the article-button setting and account theme, including on failure.
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';
import { isDeepStrictEqual } from 'node:util';
import { deflateSync } from 'node:zlib';
import { login, loadCredentials, loadUserCredentials, readSessionInfo } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, dropTempDataset, openTempDatasetRowArticle,
  fetchCsrfTokenForRequest } from '../helpers/temp-dataset';
import { configureArticleFieldRoles, postJsonWithCsrf } from '../helpers/image-first-article';
import { readDatasetIdentityFromRequest } from '../helpers/test-artifact-dataset-identity-reader';
import { acquireHomeWriter } from '../helpers/home-writer-lock';
import { assertP7ReaderPrecondition } from '../helpers/c17-permission-cleanup';

type Configuration = { schema_version: number; placement: 'below_text' | 'top_row';
  items: Array<{ table_uid: number; row_id: string; enabled: boolean; view?: string }> };
type ArticleSettings = { article_buttons: Configuration; version: string;
  unavailable_items: unknown[]; configuration_error: string };
type Pilot = { dataset: string; uid: number; path: string; pageURL: string; noImageURL: string };
const SETTINGS = '/api/admin/front-page/article-buttons';
const PAGE = '.image_first_page_view';
const restores: Array<() => Promise<void>> = [];

function crc32(data: Buffer) {
  let crc = ~0;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return ~crc >>> 0;
}
function pngChunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
/** A solid 8-bit RGB PNG. The upload path refuses SVG (d260: "unsupported file extension: svg"). */
function solidPng(width: number, height: number) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x5a)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header), pngChunk('IDAT', pixels), pngChunk('IEND', Buffer.alloc(0))]);
}
async function read<T>(request: APIRequestContext, url: string): Promise<T> {
  const response = await request.get(url);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<T>;
}
async function saveButtons(request: APIRequestContext, article_buttons: Configuration, version: string) {
  const response = await request.post(SETTINGS, { headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(request) },
    data: { article_buttons, version } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).version as string;
}
async function pageVisible(page: Page) {
  await expect(page.locator(PAGE)).toBeVisible();
  await expect(page.locator(`${PAGE} .image_first_view_article_content`)).toContainText('Page pilot');
  await expect(page.locator(`${PAGE} .row_article_image_first_stage`)).toHaveCount(0);
}
async function containedImage(page: Page) {
  const image = page.locator(`${PAGE} .row_article_page_image img`);
  await expect(image).toBeVisible();
  const geometry = await image.evaluate((node: HTMLImageElement) => {
    const box = node.getBoundingClientRect();
    const panel = node.closest('.image_first_view_article_content')!.getBoundingClientRect();
    return { height: box.height, left: box.left, right: box.right, panelLeft: panel.left, panelRight: panel.right,
      limit: innerWidth <= 700 ? Math.min(innerHeight * 0.4, 360) : innerHeight * 0.8, fit: getComputedStyle(node).objectFit,
      width: node.naturalWidth, naturalHeight: node.naturalHeight };
  });
  expect(geometry.height).toBeGreaterThan(0);
  expect(geometry.height).toBeLessThanOrEqual(geometry.limit + 1);
  expect(geometry.fit).toBe('contain');
  expect(geometry.width).toBeGreaterThan(0); expect(geometry.naturalHeight).toBeGreaterThan(0);
  expect(geometry.left).toBeGreaterThanOrEqual(geometry.panelLeft - 1);
  expect(geometry.right).toBeLessThanOrEqual(geometry.panelRight + 1);
}
async function home(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
}
const test = base.extend<{ pilot: Pilot; homeButton: void }>({
  pilot: async ({ page }, use, info) => {
    const project = info.project.name;
    const enabled = info.title.startsWith('P3 ') ? project === 'mobile-card'
      : info.title.startsWith('P6 ') ? ['desktop-card', 'mobile-card'].includes(project) : desktop(project);
    test.skip(!enabled, 'Only the design’s requested projects create fixtures');
    await login(page, loadCredentials());
    const dataset = buildTempDatasetName('e2e_page_ifav');
    await createTempDataset(page, { datasetName: dataset, grantUsersRead: true,
      columns: { id: 'SERIAL', title: 'TEXT', description: 'TEXT', detail_note: 'TEXT' },
      seedRows: [{ title: 'Page pilot with image', description: 'Contained image article', detail_note: 'Page details' },
        { title: 'Page pilot without image', description: 'Text only article', detail_note: 'Page details' }] });
    try {
      await configureArticleFieldRoles(page, dataset);
      const enabled = await postJsonWithCsrf(page, '/api/asset-linking/images/enable', { parent_table: dataset, max_file_size_mb: 10 });
      expect(enabled.status, enabled.body).toBe(201);
      await openTempDatasetRowArticle(page, dataset, 1);
      const input = page.locator('.big_card_image_gallery input[type="file"]').first();
      await input.setInputFiles({ name: 'page-pilot.png', mimeType: 'image/png', buffer: solidPng(320, 640) });
      await expect(page.locator('[data-testid^="big-card-image-thumb-"]').first()).toBeVisible();
      const identity = await readDatasetIdentityFromRequest(page.request, dataset);
      expect(identity).not.toBeNull();
      const uid = identity!.tableUID;
      // F1: Page is tableless and granted GLOBALLY on 8082 (groups 1, 4, 116, 134), the production shape. The pilot
      // relies on that existing grant plus this dataset's get-results (grantUsersRead) and writes no rights itself.
      expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('user_permissions') || '[]')),
        'The administrator must hold the global Page right, as in production').toContain('/ui/view/image_first_page_view');
      // The ordinary article already uses the server's preferred dataset address.
      const path = new URL(page.url()).pathname.replace(/\/1(?:-[^/]*)?\/?$/, '');
      await use({ dataset, uid, path, pageURL: `${path}/1?view=image_first_page_view`, noImageURL: `${path}/2?view=image_first_page_view` });
    } finally {
      // Also runs when setup, an assertion or the body fails.
      await dropTempDataset(page, dataset);
    }
  },
  homeButton: async ({ page, pilot }, use, testInfo) => {
    const lease = acquireHomeWriter(page.url(), testInfo.title);
    let restore: (() => Promise<void>) | undefined;
    try {
      const original = await read<ArticleSettings>(page.request, SETTINGS);
      expect(original.configuration_error, 'Invalid configurations cannot be restored through the strict API').toBe('');
      expect(original.unavailable_items, 'Unavailable original targets cannot be restored through the strict API').toEqual([]);
      // Generic deletion is intentionally forbidden. Refuse an absent key before
      // writing because an empty list would not restore absence EXACTLY.
      expect(original.version, 'This exact-restore browser fixture requires an existing key; Go proves fresh-key creation').not.toBe('none');
      const replacement: Configuration = { schema_version: 1, placement: 'top_row',
        items: [{ table_uid: pilot.uid, row_id: '1', enabled: true, view: 'image_first_page_view' }] };
      let restored = false;
      restore = async () => {
        if (restored) return;
        const current = await read<ArticleSettings>(page.request, SETTINGS);
        if (!isDeepStrictEqual(current.article_buttons, original.article_buttons)) {
          expect(current.article_buttons).toEqual(replacement);
          await saveButtons(page.request, original.article_buttons, current.version);
        }
        const verified = await read<ArticleSettings>(page.request, SETTINGS);
        expect(verified.article_buttons).toEqual(original.article_buttons);
        expect(verified.configuration_error).toBe(original.configuration_error);
        expect(verified.unavailable_items).toEqual(original.unavailable_items);
        restored = true;
      };
      const backstopLease = lease.retain();
      restores.push(async () => {
        try { await restore!(); } finally { backstopLease.release(); }
      }); // Armed before POST; ownership spans body cleanup and the failure hook.
      await saveButtons(page.request, replacement, original.version);
      await page.reload({ waitUntil: 'domcontentloaded' }); // API fixture must hydrate before assertions.
      await use();
    } finally {
      try { await restore?.(); } finally { lease.release(); }
    }
  },
});
test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.afterEach(async () => {
  // A body failure/timeout still gets a fresh hook budget before fixture teardown.
  const failures: unknown[] = [];
  for (const restore of restores.splice(0).reverse()) { try { await restore(); } catch (error) { failures.push(error); } }
  if (failures.length) throw new AggregateError(failures, 'Page pilot exact restoration failed');
});
function desktop(project: string) { return project === 'desktop-card'; }

test('P1 cold direct link opens Page with the complete contained image', async ({ page, pilot }, info) => {
  test.skip(!desktop(info.project.name), 'Desktop proof');
  await page.goto(pilot.pageURL, { waitUntil: 'domcontentloaded' }); await pageVisible(page); await containedImage(page);
});
test('P2 a row without an image has no image box or placeholder; failed images disappear', async ({ page, pilot }, info) => {
  test.skip(!desktop(info.project.name), 'Desktop proof');
  await page.goto(pilot.noImageURL, { waitUntil: 'domcontentloaded' }); await pageVisible(page);
  await expect(page.locator(`${PAGE} img, ${PAGE} .row_article_page_image, ${PAGE} .big_card_image`)).toHaveCount(0);
  await page.route('**/*', route => route.request().resourceType() === 'image' ? route.abort() : route.continue());
  await page.goto(pilot.pageURL, { waitUntil: 'domcontentloaded' }); await pageVisible(page);
  await expect(page.locator(`${PAGE} .row_article_page_image`)).toHaveCount(0);
});
test('P3 phone 375×812 has one column and no horizontal scroll', async ({ page, pilot }, info) => {
  test.skip(info.project.name !== 'mobile-card', 'Phone proof');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(pilot.pageURL, { waitUntil: 'domcontentloaded' }); await pageVisible(page); await containedImage(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator(PAGE).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});
test('P4 light and dark use theme tokens with opposing system themes', async ({ page, pilot }, info) => {
  test.skip(!desktop(info.project.name), 'Desktop screenshots');
  type Theme = { configured: boolean; theme_mode: string };
  const original = await read<Theme>(page.request, '/api/user-visual-preference');
  let done = false;
  const restore = async () => {
    if (done) return;
    const headers = { 'X-CSRF-Token': await fetchCsrfTokenForRequest(page.request) };
    const result = original.configured
      ? await page.request.patch('/api/user-visual-preference', { headers, data: { theme_mode: original.theme_mode } })
      : await page.request.delete('/api/user-visual-preference', { headers });
    expect(result.ok(), await result.text()).toBe(true);
    // `revision` is a server counter that rises with every write, so only the preference itself is restorable
    // (d260r 20.10.: expected revision 2851, received 2854). Read it back and compare those fields.
    const semantic = (value: Theme) => ({ configured: value.configured, theme_mode: value.theme_mode });
    expect(semantic(await read<Theme>(page.request, '/api/user-visual-preference'))).toEqual(semantic(original));
    done = true;
  };
  restores.push(restore);
  try {
    for (const theme of ['light', 'dark'] as const) {
      const result = await page.request.patch('/api/user-visual-preference', {
        headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(page.request) }, data: { theme_mode: theme } });
      expect(result.ok(), await result.text()).toBe(true);
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light', reducedMotion: 'reduce' });
      await page.goto(pilot.pageURL, { waitUntil: 'domcontentloaded' }); await pageVisible(page); await containedImage(page);
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
      const colors = await page.locator(`${PAGE} .image_first_view_article_content`).evaluate(node => {
        const style = getComputedStyle(node);
        const token = style.getPropertyValue('--text_color').trim();
        return { token, color: style.color, background: style.backgroundColor };
      });
      expect(colors.token).not.toBe(''); expect(colors.color).not.toBe(colors.background);
      await page.screenshot({ path: info.outputPath(`P4-page-${theme}.png`), fullPage: true });
    }
  } finally { await restore(); }
});
test('P5 close, Back, Forward, reload and a new tab keep the row and origin', async ({ page, pilot, context, homeButton: _homeButton }, info) => {
  test.skip(!desktop(info.project.name), 'Desktop history proof');
  await home(page);
  await page.locator('.front-page-article-button').filter({ hasText: 'Page pilot with image' }).click();
  await pageVisible(page); await page.reload(); await pageVisible(page);
  const tab = await context.newPage();
  try { await tab.goto(pilot.pageURL); await pageVisible(tab); } finally { await tab.close(); }
  await page.goBack(); await expect(page.locator(PAGE)).toHaveCount(0);
  await page.goForward(); await pageVisible(page);
  await page.locator('.image_first_view_modal [data-testid="modal-close-button"]').click();
  await expect(page.locator(PAGE)).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
});
test('P6 top-row Home Page button sits after tabs, opens Page, and returns Home', async ({ page, pilot, homeButton: _homeButton }, info) => {
  test.skip(!['desktop-card', 'mobile-card'].includes(info.project.name), 'Desktop and phone proof');
  await home(page);
  const rowHost = page.viewportSize()!.width <= 700 ? '.front-page-scroller > .front-page-top-row' : '.front-page > .front-page-top-row';
  const link = page.locator(`${rowHost} .front-page-article-button`).filter({ hasText: 'Page pilot with image' });
  await expect(link).toHaveAttribute('href', pilot.pageURL);
  const tabs = await page.locator('#front_page_container .hero-dataset-tabs').boundingBox();
  const button = await link.boundingBox(); expect(tabs).not.toBeNull(); expect(button).not.toBeNull();
  if (desktop(info.project.name)) expect(button!.x).toBeGreaterThanOrEqual(tabs!.x + tabs!.width - 1);
  else expect(await link.evaluate(node => Boolean(node.closest('.front-page-scroller > .front-page-top-row')))).toBe(true);
  await link.click(); await pageVisible(page); await containedImage(page);
  await page.goBack(); await expect(page).toHaveURL(/\/$/); await expect(page.locator(PAGE)).toHaveCount(0);
  await page.goForward(); await pageVisible(page);
  await page.keyboard.press('Escape'); await expect(page).toHaveURL(/\/$/);
  await link.click(); await pageVisible(page);
  await page.locator('.image_first_view_modal [data-testid="modal-close-button"]').click(); await expect(page).toHaveURL(/\/$/);
});
test('P7 an ungranted user sees no Home button and gets the IFAV denial notice', async ({ page, browser, pilot, homeButton: _homeButton }, info) => {
  test.skip(!desktop(info.project.name), 'Desktop permission proof');
  const context = await browser.newContext({ ignoreHTTPSErrors: true, storageState: { cookies: [], origins: [] } });
  let reader: Page | undefined;
  try {
    // The reader's groups (8082's ordinary users) lack the global Page right, while grantUsersRead gives them
    // get-results on this dataset: the design's "user without the Page right" denial.
    reader = await context.newPage(); await login(reader, loadUserCredentials());
    // Additional precondition: a leaked article grant invalidates the denial proof.
    // Only the admin's GET inventory is used to name leftovers; restoration is the owner's decision.
    await assertP7ReaderPrecondition(page.request, (await readSessionInfo(reader)).user_id!,
      await reader.evaluate(() => JSON.parse(sessionStorage.getItem('user_permissions') || '[]')));
    expect(await reader.evaluate(() => JSON.parse(sessionStorage.getItem('user_permissions') || '[]'))).not.toContain('/ui/view/image_first_page_view');
    await home(reader); await expect(reader.locator(`a[href="${pilot.pageURL}"]`)).toHaveCount(0);
    const denial = reader.locator('[data-lang-key="article_view_permission_missing"]');
    await reader.goto(pilot.pageURL);
    // Both direct routes boot the app and load the dataset before showing the
    // denial. Check content absence only after that positive readiness signal.
    await expect(denial).toBeVisible({ timeout: 15_000 });
    const pageDenial = await denial.textContent();
    expect(pageDenial?.trim()).toBeTruthy();
    await expect(reader.locator(PAGE)).toHaveCount(0);
    await expect(reader.locator('.image_first_view_article_content')).toHaveCount(0);
    await reader.goto(`${pilot.path}/1?view=image_first_view`);
    await expect(denial).toHaveText(pageDenial!, { timeout: 15_000 });
    await expect(denial).toBeVisible();
    await expect(reader.locator('.image_first_view_article_content')).toHaveCount(0);
  } catch (error) {
    // The fixture's automatic snapshot is the admin page; preserve the actual
    // reader failure before closing its separate context, without masking it.
    if (reader) {
      await info.attach('P7-reader-url', { body: reader.url(), contentType: 'text/plain' })
        .catch(attachmentError => console.error('P7 reader URL attachment failed', attachmentError));
      await reader.screenshot({ fullPage: true, timeout: 5_000 })
        .then(body => info.attach('P7-reader-screenshot', { body, contentType: 'image/png' }))
        .catch(attachmentError => console.error('P7 reader screenshot attachment failed', attachmentError));
    }
    throw error;
  } finally { await context.close(); }
});
