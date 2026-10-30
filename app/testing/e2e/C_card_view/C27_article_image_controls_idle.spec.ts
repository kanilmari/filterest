// C27_article_image_controls_idle.spec.ts
// Proves shared idle controls and disabled alpha using owned one/two-image rows.
// Connects classic/IFAV controls and the Page pilot's existing close control.
// Page currently has no gallery arrows or record bar; that matrix gap is explicit.
import { test as base, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest,
  fetchCsrfTokenForRequest, openTempDatasetRowArticle } from '../helpers/temp-dataset';
import { configureArticleFieldRoles, postJsonWithCsrf } from '../helpers/image-first-article';
import { recordTestDatasetOwnershipFromRequest } from '../helpers/test-artifact-dataset-column-recorder';
import { listRegisteredTestArtifacts } from '../helpers/test-artifact-run-registry';

type Presentation = 'classic' | 'ifav' | 'page';
type Fixture = { dataset: string; request: APIRequestContext | null };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const test = base.extend<{ ownedImages: Fixture }>({
  ownedImages: [async ({ playwright, page, baseURL, extraHTTPHeaders, ignoreHTTPSErrors }, use, info) => {
    test.skip(!['desktop-card', 'mobile-card'].includes(info.project.name), 'WO93 desktop and phone widths');
    await login(page, loadCredentials());
    const fixture: Fixture = { dataset: buildTempDatasetName('e2e_wo93_idle'), request: null };
    fixture.request = await playwright.request.newContext({ baseURL, extraHTTPHeaders, ignoreHTTPSErrors,
      storageState: await page.context().storageState(), timeout: 30_000 });
    const request = fixture.request;
    try {
      await createTempDataset(page, { datasetName: fixture.dataset,
        columns: { id: 'SERIAL', title: 'TEXT', description: 'TEXT', detail_note: 'TEXT' },
        seedRows: [1, 2].map(count => ({ title: `WO93 ${count} image`, description: 'Idle controls', detail_note: 'Temporary' })) });
      await recordTestDatasetOwnershipFromRequest(request, fixture.dataset);
      const enable = await postJsonWithCsrf(page, '/api/asset-linking/images/enable',
        { parent_table: fixture.dataset, max_file_size_mb: 10 });
      expect(enable.status, enable.body).toBe(201);
      const status = await request.get(`/api/asset-linking/status?table=${encodeURIComponent(fixture.dataset)}`);
      expect(status.ok(), await status.text()).toBe(true);
      const relations = (await status.json()).image_asset_linkings;
      expect(relations).toHaveLength(1);
      const relation = relations[0];
      const csrf = await fetchCsrfTokenForRequest(request);
      for (const count of [1, 2]) for (let index = 0; index < count; index++) {
        const name = `wo93-${count}-${index}.png`;
        const response = await request.post(`/api/add-row-multipart?dataset=${encodeURIComponent(relation.child_table)}`, {
          headers: { 'X-CSRF-Token': csrf }, multipart: {
            jsonPayload: JSON.stringify({ [relation.foreign_key_column]: count, asset_kind: 'image',
              original_name: name, mime_type: 'image/png', size_bytes: PNG.length, title: name }),
            file_child_0: { name, mimeType: 'image/png', buffer: PNG },
          },
        });
        expect(response.status(), await response.text()).toBe(201);
      }
      await configureArticleFieldRoles(page, fixture.dataset);
      await use(fixture);
    } finally {
      // Independent request context survives a timed-out page; confirmed ownership only.
      // Cleanup outlives a slow drop under load.
      try {
        const owned = (name: string) => listRegisteredTestArtifacts().some(artifact =>
          artifact.kind === 'dataset' && artifact.name === name && artifact.status === 'confirmed');
        if (owned(fixture.dataset)) {
          await recordTestDatasetOwnershipFromRequest(request, fixture.dataset);
          await cleanupDatasetViaRequest(request, fixture.dataset);
        }
        if (owned(`${fixture.dataset}_assets`)) await cleanupDatasetViaRequest(request, `${fixture.dataset}_assets`);
      } finally { await request.dispose(); }
    }
  }, { timeout: 90_000 }],
});
test.use({ actionTimeout: 10_000, navigationTimeout: 20_000 });

async function explicitTheme(page: Page, theme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
  await page.route(url => url.pathname === '/api/user-visual-preference', route =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { configured: true, theme_mode: theme, revision: 1 } }) : route.continue());
  await page.addInitScript(value => localStorage.setItem('theme', value), theme);
}

async function openSurface(page: Page, dataset: string, count: number, presentation: Presentation) {
  await openTempDatasetRowArticle(page, dataset, count);
  const article = page.locator('[data-testid="big-card-container"]');
  if (presentation === 'classic') {
    const media = article.locator('[data-testid="row-article-inline-media"]').first();
    await expect(media).toBeVisible();
    return { root: media, image: media.locator('img').first() };
  }
  if (presentation === 'ifav') {
    await article.locator('[data-testid="big-card-image-thumb-0"]').press('Enter');
  } else {
    const url = new URL(page.url());
    url.searchParams.set('view', 'image_first_page_view');
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  }
  const root = page.locator('.image_first_view_overlay');
  const image = root.locator(presentation === 'ifav'
    ? '.row_article_image_first_media img' : '.row_article_page_image img').first();
  // The overlay can arrive after 5 s under load (nightly 30.10.).
  await expect(image).toBeVisible({ timeout: 15_000 });
  return { root, image };
}

/** Includes ancestor opacity, because classic record buttons fade as one bar. */
async function effectiveOpacity(control: Locator) {
  return control.evaluate(element => {
    let alpha = 1;
    for (let node: Element | null = element; node; node = node.parentElement) {
      alpha *= Number(getComputedStyle(node).opacity);
    }
    return alpha;
  });
}
// Default polling (100/250/500/1000 ms) takes its last sample at ~0.85 s of a 1.8 s timeout, before the 1.2 s
// idle deadline can pass; a 50 ms interval keeps the 1.8 s bound observable (b561's first native run, 26.10.).
// A fresh array per call: Playwright pop()s the intervals it is given (timeoutRunner.js pollAgainstDeadline), so one
// shared array was emptied by the first poll and every later poll fell back to 1 s steps, giving up at ~1.0 s of the
// 1.8 s bound (diag d561h, 29.10.: each test's second deadline failed, the first one passed).
const idlePoll = () => ({ intervals: [50] });
// Fully hidden = the 1.2 s idle deadline + the fade: 160 ms inline (row_article_inline_media.css:72), 0.5 s in the
// modal (modals.css:442), measured at 1.38 s / 1.68–1.89 s by trace d561r (29.10.).
async function alpha(control: Locator, value: number, timeout = 2_400) {
  await expect.poll(() => effectiveOpacity(control), { ...idlePoll(), timeout }).toBeCloseTo(value, 2);
}
async function inactive(root: Locator, activeClass: string) {
  try {
    await expect.poll(() => root.evaluate((element, name) => element.classList.contains(name), activeClass),
      { ...idlePoll(), timeout: 1_800 }).toBe(false);
  } catch (error) {
    // Name what could be holding the group (focus or a hovered control) for the next reader of a failure.
    const state = await root.evaluate(element => ({ focus: document.activeElement?.className || document.activeElement?.tagName,
      hover: [...element.querySelectorAll(':hover')].map(node => node.className).slice(-3) }));
    throw new Error(`${(error as Error).message}\nstate at the deadline: ${JSON.stringify(state)}`);
  }
}
async function keyboardReveal(page: Page, control: Locator) {
  await expect(control).toBeEnabled();
  // Place the real Tab sequence immediately before the target, then press Tab.
  const before = await control.evaluateHandle(element => {
    const button = document.createElement('button');
    button.setAttribute('aria-label', 'Temporary keyboard entry');
    element.before(button); button.focus(); return button;
  });
  try {
    await page.keyboard.press('Tab');
    await expect(control).toBeFocused();
  } finally { await before.evaluate(node => node.remove()); await before.dispose(); }
}

for (const touch of [false, true]) test.describe(touch ? 'WO93 coarse pointer' : 'WO93 fine pointer', () => {
  // Both widths exercise the timer with a fine pointer, and retain real coarse-input coverage.
  test.use({ hasTouch: touch });
  for (const presentation of ['classic', 'ifav', 'page'] as const) {
    for (const theme of ['light', 'dark'] as const) test(`${presentation} ${theme}: one/two images`,
      async ({ page, ownedImages }, info) => {
        test.setTimeout(120_000);
        await explicitTheme(page, theme);
        for (const count of [1, 2]) await test.step(`${count} image row`, async () => {
          const { root, image } = await openSurface(page, ownedImages.dataset, count, presentation);
          await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
          const activeClass = presentation === 'classic' ? 'article-image-controls-active' : 'image-modal-controls-active';
          const previous = root.locator('[data-testid="row-article-image-previous"]');
          const next = root.locator('[data-testid="row-article-image-next"]');
          const navigation = root.locator('.row_article_row_navigation_button');
          const controls = presentation === 'page'
            ? [root.locator('[data-testid="modal-close-button"]')] : [previous, next, ...await navigation.all()];
          if (presentation === 'page') {
            info.annotations.push({ type: 'WO93 matrix gap',
              description: 'Page pilot omits image arrows and row navigation; owner decision required before adding visible controls.' });
            await expect(previous).toHaveCount(0); await expect(next).toHaveCount(0);
            await expect(navigation).toHaveCount(0);
          } else {
            await expect(previous).toBeDisabled();
            if (count === 1) await expect(next).toBeDisabled(); else await expect(next).toBeEnabled();
            await expect(navigation).toHaveCount(2);
            await expect(root.locator('[data-testid="row-article-image-position"]')).toHaveText(`1 / ${count}`);
          }
          // Remove opener focus so :focus-within does not intentionally hold classic controls.
          await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
          await image.hover();
          await expect(root).toHaveClass(new RegExp(activeClass));
          for (const control of controls) await expect.poll(() => effectiveOpacity(control)).toBeGreaterThan(0);
          if (presentation !== 'page') {
            await expect(previous).toHaveCSS('opacity', '0.28');
            await expect(next).toHaveCSS('opacity', count === 1 ? '0.28' : '1');
          }
          // The class deadline is exact even when touch CSS deliberately keeps controls visible.
          await image.hover({ position: { x: 1, y: 1 } });
          await Promise.all([
            inactive(root, activeClass),
            ...touch ? [] : controls.map(control => alpha(control, 0)),
          ]);
          if (touch) {
            if (presentation !== 'page') await expect(previous).toHaveCSS('opacity', '0.28');
            for (const control of controls) expect(await effectiveOpacity(control)).toBeGreaterThan(0);
          }
          if (!touch) {
            await image.hover();
            // Real hover on an existing actionable control holds the whole group.
            const hold = presentation === 'page' ? controls[0]
              : root.locator('.row_article_row_navigation_button:enabled').first();
            await expect(hold).toBeEnabled();
            await hold.hover();
            await page.waitForTimeout(2_100);
            await expect(root).toHaveClass(new RegExp(activeClass));
            for (const control of controls) expect(await effectiveOpacity(control)).toBeGreaterThan(0);
            await image.hover();
            await inactive(root, activeClass);
            await keyboardReveal(page, hold);
            await expect(root).toHaveClass(new RegExp(activeClass));
            for (const control of controls) await expect.poll(() => effectiveOpacity(control)).toBeGreaterThan(0);
          }
          await page.screenshot({ path: info.outputPath(`${presentation}-${theme}-${count}-${touch ? 'touch' : 'fine'}.png`) });
          if (presentation !== 'classic') {
            await page.keyboard.press('Escape');
            await expect(root).toBeHidden();
          }
        });
      });
  }
});
