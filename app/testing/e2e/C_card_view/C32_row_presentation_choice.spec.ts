// C32_row_presentation_choice.spec.ts
// Proves the view picker's Article split button: Article, image-first (IFAV) and Page-sized image-first.
// Connects a disposable dataset, the real first listed row, history, themes and a touch phone context.
// Removes its dataset after each case and previews themes only inside the test page.
import { test as base, expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import { login, loadCredentials, loadUserCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest, openTempDatasetRowArticle } from '../helpers/temp-dataset';
import { closeArticleToCardView, configureArticleFieldRoles, postJsonWithCsrf } from '../helpers/image-first-article';
import { getActiveDatasetContainer } from '../helpers/active-dataset';
import { revealActiveFilterbarSection, waitForActiveFilterbarLayout } from '../helpers/filterbar';
import { listRegisteredTestArtifacts } from '../helpers/test-artifact-run-registry';
import { solidPng } from '../helpers/solid-png';

type Fixture = { dataset: string; listURL: string };
const FIRST = 'Row presentation first';
const SECOND = 'Row presentation second';
const IFAV = '[data-testid="image-first-view"]';
const PAGE = '.image_first_page_view';
const CLOSE = '.image_first_view_modal [data-testid="modal-close-button"]';
const MENU = '[data-testid="row-presentation-menu"]';
const option = (viewKey: string) => `[data-testid="row-presentation-menu-option-${viewKey}"]`;

const test = base.extend<{ fixture: Fixture }>({
  fixture: async ({ page }, use, info) => {
    // R2 is the only phone proof; R1 and R3–R5 run on desktop only; other projects create nothing.
    const projects = info.title.startsWith('R2 ') ? ['mobile-card'] : ['desktop-card'];
    test.skip(!projects.includes(info.project.name), 'Only the requested projects create fixtures');
    await login(page, loadCredentials());
    const dataset = buildTempDatasetName('e2e_row_presentation');
    await createTempDataset(page, { datasetName: dataset, grantUsersRead: true,
      columns: { id: 'SERIAL', title: 'TEXT', description: 'TEXT', e2e_detail_note: 'TEXT' },
      seedRows: [{ title: FIRST, description: 'Has a photo', e2e_detail_note: 'First details' },
        { title: SECOND, description: 'Text only', e2e_detail_note: 'Second details' }] });
    try {
      await configureArticleFieldRoles(page, dataset, 'e2e_detail_note');
      const enabled = await postJsonWithCsrf(page, '/api/asset-linking/images/enable', { parent_table: dataset, max_file_size_mb: 10 });
      expect(enabled.status, enabled.body).toBe(201);
      await openTempDatasetRowArticle(page, dataset, 1);
      await page.locator('.big_card_image_gallery input[type="file"]').first()
        .setInputFiles({ name: 'row-presentation.png', mimeType: 'image/png', buffer: solidPng(480, 320) });
      await expect(page.locator('[data-testid^="big-card-image-thumb-"]').first()).toBeVisible();
      expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('user_permissions') || '[]')),
        'The administrator must hold the global Page right, as in production').toContain('/ui/view/image_first_page_view');
      const articleURL = new URL(page.url());
      const path = articleURL.origin + articleURL.pathname.replace(/\/1(?:-[^/]*)?\/?$/, '');
      await closeClassicArticle(page, info.project.name === 'mobile-card');
      // An explicit order makes "the first listed row" deterministic.
      await use({ dataset, listURL: `${path}?view=card&sort_column=id&sort_order=asc` });
    } finally {
      await cleanupDatasetViaRequest(page.request, dataset);
      const child = dataset + '_assets';
      if (listRegisteredTestArtifacts().some(item => item.kind === 'dataset' && item.name === child && item.status === 'confirmed')) {
        await cleanupDatasetViaRequest(page.request, child);
      }
    }
  },
});
test.describe.configure({ timeout: 180_000 });

/** The phone returns through history; its compact bar has no desktop article close (C29). */
async function closeClassicArticle(page: Page, phone: boolean) {
  if (!phone) return closeArticleToCardView(page);
  await page.goBack();
  await expect(page.locator('[data-testid="big-card-container"]:visible')).toHaveCount(0, { timeout: 10_000 });
}

/** Reveals the Views section (opening the phone panel when needed) and returns the split's halves. */
async function split(page: Page) {
  const parts = await getActiveDatasetContainer(page);
  await revealActiveFilterbarSection(page, 'views', parts);
  const primary = parts.locator('[data-testid="view-btn-article_view"]:visible').first();
  const toggle = parts.locator('[data-testid="row-presentation-toggle"]:visible').first();
  await expect(primary).toBeVisible(); await expect(toggle).toBeVisible();
  return { primary, toggle };
}
async function press(locator: Locator, touch: boolean) {
  if (touch) await locator.tap(); else await locator.click();
}
/** Chooses a presentation and proves the caption, the check mark and their shared label. */
async function choose(page: Page, viewKey: string, touch: boolean, info?: TestInfo, shot = '') {
  const { primary, toggle } = await split(page);
  await press(toggle, touch);
  const menu = page.locator(MENU);
  await expect(menu).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const box = await menu.boundingBox(); const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
  for (const item of await menu.locator('[role="menuitemradio"]').all()) {
    expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  }
  if (info && shot) await page.screenshot({ path: info.outputPath(`${shot}-menu.png`) });
  const label = (await page.locator(`${option(viewKey)} .anchored-action-menu__label`).textContent())!.trim();
  await press(page.locator(option(viewKey)), touch);
  await expect(menu).toHaveCount(0);
  await expect(primary).toHaveAttribute('data-presentation', viewKey);
  await expect(primary).toHaveText(label);
  return { primary, label };
}
async function expectChecked(page: Page, viewKey: string, touch: boolean) {
  const { toggle } = await split(page);
  await press(toggle, touch);
  await expect(page.locator(`${MENU} [aria-checked="true"]`)).toHaveCount(1);
  await expect(page.locator(option(viewKey))).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator(MENU)).toHaveCount(0);
}
async function expectOpen(page: Page, selector: string, title: string, rowId: number, view: string) {
  await expect(page.locator(selector)).toBeVisible();
  await expect(page.locator(`${selector} .image_first_view_article_content`)).toContainText(title);
  await expect(page).toHaveURL(new RegExp(`/${rowId}(?:-[^/?]*)?\\?.*view=${view}`));
}

/** The three presentations on the first listed row, with Close, Escape, Back, Forward and reload. */
async function provePresentations(page: Page, fixture: Fixture, touch: boolean, info: TestInfo) {
  await page.goto(fixture.listURL, { waitUntil: 'domcontentloaded' });
  const { primary } = await split(page);
  await expect(primary).toHaveAttribute('data-presentation', 'article_view');
  await expectChecked(page, 'article_view', touch);

  await choose(page, 'image_first_view', touch, info, `${info.project.name}-ifav`);
  await expectOpen(page, IFAV, FIRST, 1, 'image_first_view');
  await expect(page.locator(`${IFAV} .row_article_image_first_stage`)).toBeVisible();
  await page.screenshot({ path: info.outputPath(`${info.project.name}-ifav.png`) });
  await press(page.locator(CLOSE), touch);
  await expect(page.locator(IFAV)).toHaveCount(0);
  await expect(page).toHaveURL(/view=card/);
  // The modal returns focus to the split's primary button, which was focused when the choice was made.
  if (!touch) await expect.soft(page.locator('[data-testid="view-btn-article_view"]:visible').first()).toBeFocused();
  await expectChecked(page, 'image_first_view', touch);

  // The primary now opens the chosen presentation; history keeps it.
  await press((await split(page)).primary, touch);
  await expectOpen(page, IFAV, FIRST, 1, 'image_first_view');
  await page.goBack(); await expect(page.locator(IFAV)).toHaveCount(0);
  await page.goForward(); await expectOpen(page, IFAV, FIRST, 1, 'image_first_view');
  await page.reload(); await expectOpen(page, IFAV, FIRST, 1, 'image_first_view');
  await page.keyboard.press('Escape'); await expect(page.locator(IFAV)).toHaveCount(0);

  await choose(page, 'image_first_page_view', touch, info, `${info.project.name}-page`);
  await expectOpen(page, PAGE, FIRST, 1, 'image_first_page_view');
  await page.screenshot({ path: info.outputPath(`${info.project.name}-page.png`) });
  await page.goBack(); await expect(page.locator(PAGE)).toHaveCount(0);

  await choose(page, 'article_view', touch);
  const article = page.locator('[data-testid="big-card-container"]:visible').first();
  await expect(article).toContainText(FIRST);
  await page.screenshot({ path: info.outputPath(`${info.project.name}-article.png`) });
  await closeClassicArticle(page, touch);
  if (touch) await expect(page).toHaveURL(/view=card/);
}

test('R1 desktop: Article, IFAV and Page open the first listed row and return', async ({ page, fixture }, info) => {
  test.skip(info.project.name !== 'desktop-card', 'Desktop proof');
  await provePresentations(page, fixture, false, info);
  // Keyboard: Enter opens the menu, arrows move, Escape returns focus to the chevron.
  const { toggle } = await split(page);
  await toggle.focus(); await page.keyboard.press('ArrowDown');
  await expect(page.locator(option('article_view'))).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(page.locator(option('image_first_view'))).toBeFocused();
  await page.keyboard.press('Escape'); await expect(toggle).toBeFocused();
});

test('R2 phone with touch: the same three presentations by tapping', async ({ browser, page, fixture }, info) => {
  test.skip(info.project.name !== 'mobile-card', 'Phone proof');
  const context = await browser.newContext({ baseURL: fixture.listURL, ignoreHTTPSErrors: true, hasTouch: true, isMobile: true,
    viewport: { width: 375, height: 667 }, storageState: await page.context().storageState() });
  try {
    const phone = await context.newPage();
    await provePresentations(phone, fixture, true, info);
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); }
});

test('R3 the open article row wins; a photo-less row opens text-only IFAV through reload and Forward', async ({ page, fixture }, info) => {
  test.skip(info.project.name !== 'desktop-card', 'Desktop history proof');
  await page.goto(fixture.listURL, { waitUntil: 'domcontentloaded' });
  const cards = page.locator(`#${fixture.dataset}_card_view_container .card:visible`);
  await expect(cards.first()).toContainText(FIRST);
  // A search alone leaves no article open and can still return row 1. Open row 2
  // through its real card header before asking either presentation to keep it.
  await cards.locator('[data-testid="card-item-header"]').filter({ hasText: SECOND }).click();
  const article = page.locator(`#${fixture.dataset}_article_view_container [data-testid="big-card-container"]:visible`);
  await expect(article).toContainText(SECOND);
  await expect(page).toHaveURL(/\/2(?:-[^/?]*)?\?.*view=article_view/);
  await choose(page, 'image_first_view', false);
  await expectOpen(page, IFAV, SECOND, 2, 'image_first_view');
  await expect(page.locator(`${IFAV}.image_first_view--text-only`)).toBeVisible();
  await expect(page.locator(`${IFAV} img, ${IFAV} .row_article_image_first_stage`)).toHaveCount(0);
  await page.reload(); await expect(page.locator(`${IFAV}.image_first_view--text-only`)).toContainText(SECOND);
  await page.goBack(); await expect(page.locator(IFAV)).toHaveCount(0);
  await page.goForward(); await expect(page.locator(`${IFAV}.image_first_view--text-only`)).toContainText(SECOND);
  await page.locator(CLOSE).click(); await expect(page.locator(IFAV)).toHaveCount(0);

  // With row 2's classic article open, the menu opens that row, not the listing's first.
  await openTempDatasetRowArticle(page, fixture.dataset, 2);
  await choose(page, 'image_first_page_view', false);
  await expectOpen(page, PAGE, SECOND, 2, 'image_first_page_view');
  await page.locator(CLOSE).click(); await expect(page.locator(PAGE)).toHaveCount(0);
  await expect(page.locator('[data-testid="big-card-container"]:visible').first()).toContainText(SECOND);
});

test('R4 light and dark themes with the opposite system theme', async ({ page, fixture }, info) => {
  let activeTheme: 'light' | 'dark' = 'light';
  await page.route(url => url.pathname === '/api/user-visual-preference', route =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { configured: true, theme_mode: activeTheme, revision: 1 } })
      : route.continue());
  for (const theme of ['light', 'dark'] as const) {
    activeTheme = theme;
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light', reducedMotion: 'reduce' });
    await page.goto(fixture.listURL, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
    const { toggle } = await split(page);
    await toggle.click();
    const colors = await page.locator(MENU).evaluate(node => {
      const style = getComputedStyle(node); return { color: style.color, background: style.backgroundColor };
    });
    expect(colors.color).not.toBe(colors.background);
    await page.screenshot({ path: info.outputPath(`${info.project.name}-${theme}-menu.png`) });
    await page.locator(option('image_first_page_view')).click();
    await expectOpen(page, PAGE, FIRST, 1, 'image_first_page_view');
    await page.screenshot({ path: info.outputPath(`${info.project.name}-${theme}-page.png`) });
    await page.keyboard.press('Escape'); await expect(page.locator(PAGE)).toHaveCount(0);
  }
});

test('R5 a reader without the Page right is never offered Page', async ({ browser, fixture }, info) => {
  test.skip(info.project.name !== 'desktop-card', 'Desktop permission proof');
  const context = await browser.newContext({ baseURL: fixture.listURL, ignoreHTTPSErrors: true, storageState: { cookies: [], origins: [] } });
  try {
    const reader = await context.newPage(); await login(reader, loadUserCredentials());
    const rights: string[] = await reader.evaluate(() => JSON.parse(sessionStorage.getItem('user_permissions') || '[]'));
    test.skip(rights.includes('/ui/view/image_first_page_view'), 'This installation grants readers Page; no denial to prove');
    await reader.goto(fixture.listURL, { waitUntil: 'domcontentloaded' });
    await expect(reader.locator(`[id$="_tab_parts_container"]:visible`).first()).toBeVisible();
    // Readers without the view-style right have no picker at all; with it, the menu omits Page.
    const parts = await getActiveDatasetContainer(reader);
    await waitForActiveFilterbarLayout(reader, parts, { allowMissingPanel: true });
    const toggle = parts.getByTestId('row-presentation-toggle');
    const grant = await reader.request.get('/api/check-table-right', {
      params: { route: '/ui/table-view-style-buttons', dataset: fixture.dataset },
    });
    expect(grant.ok()).toBe(true);
    const mayChoose = (await grant.json()).allowed && rights.includes('/ui/view/article_view');
    if (mayChoose) {
      await revealActiveFilterbarSection(reader, 'views', parts);
      await toggle.first().click();
      await expect(reader.locator(MENU)).toBeVisible();
      await expect(reader.locator(option('image_first_page_view'))).toHaveCount(0);
    } else {
      await expect(toggle).toHaveCount(0);
    }
    await expect(reader.locator(PAGE)).toHaveCount(0);
    await info.attach('R5-reader-picker', { body: (await toggle.count()) ? 'picker shown without Page' : 'no picker', contentType: 'text/plain' });
  } finally { await context.close(); }
});
