// C22_article_image_arrows_probe.spec.ts
// Captures WO32 article arrows and measures the SVG ink centre in CSS pixels.
// Connects owned temporary image datasets, real article views and theme overrides.
// Keeps before/after owner evidence separate and always cleans the dataset via API.
// Run with ./filterest test testing/e2e/C_card_view/C22_article_image_arrows_probe.spec.ts
// --project=desktop-card --project=mobile-card --workers=1 --reporter=list.
// WO32_PROBE_PHASE=before captures the old checkout without new-style assertions;
// default after measures ink (<=1 CSS px per axis). Run the same spec on each checkout.
// Output: data/testing/wo32/{before,after}/ (or FILTEREST_TEST_RUNTIME_ROOT/wo32).
import { test as base, expect, type APIRequestContext, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { login, loadCredentials } from '../helpers/auth';
import {
  buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest, fetchCsrfTokenForRequest,
  openTempDatasetRowArticle,
} from '../helpers/temp-dataset';
import { configureArticleFieldRoles, postJsonWithCsrf } from '../helpers/image-first-article';
import { recordTestDatasetOwnershipFromRequest } from '../helpers/test-artifact-dataset-column-recorder';
import { listRegisteredTestArtifacts } from '../helpers/test-artifact-run-registry';
import { resolveFilterestTestRuntimeRoot } from '../helpers/test-runtime-paths';
import { waitForVisiblePageReady } from '../../../server_tools/lib/browser_view_readiness.mjs';

const phase = process.env.WO32_PROBE_PHASE || 'after';
if (!['before', 'after'].includes(phase)) throw new Error('WO32_PROBE_PHASE must be before or after');
const outputRoot = path.join(resolveFilterestTestRuntimeRoot(), 'wo32', phase);
// The carousel renders five thumbnails and exists only with more than five images.
// Six is the smallest real fixture that retains both carousel boundary shots.
const imageCount = 6;
const imagePng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
type OwnedProbe = { dataset: string; request: APIRequestContext | null };
const test = base.extend<{ ownedProbe: OwnedProbe }>({
  ownedProbe: [async ({ playwright: _playwright }, use) => {
    const owned: OwnedProbe = { dataset: buildTempDatasetName('e2e_wo32_arrows'), request: null };
    try { await use(owned); } finally {
      // Fixture teardown has its own budget even after the test/page times out.
      // The independent context retains the authenticated cookies captured before creation.
      const request = owned.request;
      if (request) {
        try {
          const isOwned = (name: string) => listRegisteredTestArtifacts().some(artifact =>
            artifact.kind === 'dataset' && artifact.name === name && artifact.status === 'confirmed');
          if (isOwned(owned.dataset)) {
            // Preserve parent/managed-child columns and language-key evidence before dropping either.
            await recordTestDatasetOwnershipFromRequest(request, owned.dataset);
            await cleanupDatasetViaRequest(request, owned.dataset);
          }
          const child = `${owned.dataset}_assets`;
          if (isOwned(child)) await cleanupDatasetViaRequest(request, child);
        } finally { await request.dispose(); }
      }
    }
  }, { timeout: 60_000 }],
});
test.use({ actionTimeout: 10_000, navigationTimeout: 20_000 });
const arrow = (root: Locator, direction: string, carousel = false) => root.locator(
  `[data-testid="${carousel ? 'big-card-image-carousel' : 'row-article-image'}-${direction}"]`,
);

/** Map the actual mask's path bounds through its rendered contain box.
 * getBBox measures SVG ink bounds, including the asset's asymmetric whitespace;
 * checking only span centres would miss an off-centre path inside the SVG. */
async function measureInk(button: Locator) {
  return button.evaluate(async element => {
    const icon = element.querySelector<HTMLElement>('.row_article_image_arrow_icon');
    if (!icon || element.textContent?.trim()) throw new Error('Expected decorative mask span without a glyph');
    const style = getComputedStyle(icon);
    const url = style.maskImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
    if (!url || style.maskSize !== 'contain' || style.maskPosition !== '50% 50%') {
      throw new Error('Expected centred contain mask');
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error('SVG mask failed to load');
    const parsed = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
    const svg = document.importNode(parsed.documentElement, true) as unknown as SVGSVGElement;
    svg.style.cssText = 'position:fixed;left:-10000px;visibility:hidden';
    document.body.append(svg);
    const palette = document.createElement('span');
    // Resolve tokens on the actual button, including its explicit app-theme override.
    palette.style.cssText = 'position:fixed;visibility:hidden;'
      + 'background-color:var(--control-disabled-bg);color:var(--control-disabled-text)';
    element.append(palette);
    try {
      const ink = svg.getBBox();
      const view = svg.viewBox.baseVal;
      const box = icon.getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      const scale = Math.min(box.width / view.width, box.height / view.height);
      const inkX = box.left + (box.width - view.width * scale) / 2
        + (ink.x - view.x + ink.width / 2) * scale;
      const inkY = box.top + (box.height - view.height * scale) / 2
        + (ink.y - view.y + ink.height / 2) * scale;
      const expected = getComputedStyle(palette);
      return { dx: inkX - (bounds.left + bounds.width / 2), dy: inkY - (bounds.top + bounds.height / 2),
        iconColor: style.backgroundColor, expectedDisabledIconColor: expected.color,
        buttonBackground: getComputedStyle(element).backgroundColor,
        expectedDisabledBackground: expected.backgroundColor,
        iconWidth: box.width, iconHeight: box.height, mask: url,
        disabled: (element as HTMLButtonElement).disabled, label: element.getAttribute('aria-label') };
    } finally { svg.remove(); palette.remove(); }
  });
}

async function disabledSkin(button: Locator) {
  return button.evaluate(element => {
    const style = getComputedStyle(element);
    const icon = element.querySelector('.row_article_image_arrow_icon');
    if (!icon) throw new Error('Expected an image-arrow mask');
    const reference = document.createElement('span');
    // Compare against the existing theme-local palette independently of the new
    // aliases, so frozen root tokens under the opposite OS theme cannot pass.
    reference.style.cssText = 'background:var(--table_border_color);color:var(--border_color);'
      + 'border:1px solid var(--border_color);outline:1px solid var(--control-disabled-border)';
    element.append(reference);
    const expected = getComputedStyle(reference);
    const result = { background: style.backgroundColor, color: style.color, border: style.borderTopColor,
      iconColor: getComputedStyle(icon).backgroundColor,
      shadow: style.boxShadow, filter: style.filter, blur: style.backdropFilter, cursor: style.cursor,
      opacity: style.opacity, expectedBackground: expected.backgroundColor, expectedColor: expected.color,
      expectedBorder: expected.borderTopColor, resolvedDisabledBorder: expected.outlineColor,
      borders: ['top', 'right', 'bottom', 'left'].map(side => ({ side,
        color: style.getPropertyValue(`border-${side}-color`),
        width: style.getPropertyValue(`border-${side}-width`),
        style: style.getPropertyValue(`border-${side}-style`),
      })) };
    reference.remove();
    return result;
  });
}

async function hoverImageArrow(page: Page, button: Locator) {
  // Classic controls stop receiving pointers outside their media rectangle.
  // Playwright checks the hit target before moving, so enter the media first,
  // just as a mouse user does. Never bypass a genuinely obstructed arrow.
  const inline = button.locator('xpath=ancestor::*[@data-testid="row-article-inline-media"][1]');
  if (await inline.count()) {
    await inline.hover({ position: { x: 2, y: 2 } });
    await waitForVisiblePageReady(page);
    const hit = await button.evaluate(element => {
      const box = element.getBoundingClientRect();
      const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { receivesPointer: target === element || element.contains(target),
        pointerEvents: getComputedStyle(element).pointerEvents,
        target: target?.outerHTML.slice(0, 300) ?? 'outside viewport' };
    });
    expect(hit.pointerEvents, 'Revealed classic arrow must accept pointer input').not.toBe('none');
    expect(hit.receivesPointer, `Revealed classic arrow is obstructed at its centre by ${hit.target}`).toBe(true);
  }
  await button.hover();
  await waitForVisiblePageReady(page);
  expect(await button.evaluate(element => element.matches(':hover')),
    'Arrow itself must receive the real mouse hover').toBe(true);
}

async function assertDisabled(page: Page, button: Locator, touch: boolean) {
  const rest = await disabledSkin(button);
  expect(rest).toMatchObject({ background: rest.expectedBackground, color: rest.expectedColor,
    iconColor: rest.expectedColor,
    border: rest.expectedBorder, shadow: 'none', filter: 'none', blur: 'none', cursor: 'not-allowed', opacity: '1' });
  for (const border of rest.borders) {
    expect(border.color, `${border.side} edge follows the resolved disabled border token`)
      .toBe(rest.resolvedDisabledBorder);
    expect(border.style, `${border.side} edge is solid`).toBe('solid');
    expect(parseFloat(border.width), `${border.side} edge is at least 1px`).toBeGreaterThanOrEqual(1);
    expect(border.color, `${border.side} edge is distinct from the disabled background`)
      .not.toBe(rest.background);
  }
  if (!touch) {
    await hoverImageArrow(page, button);
    expect(await disabledSkin(button)).toEqual(rest);
    await page.mouse.down();
    try {
      await waitForVisiblePageReady(page);
      expect(await disabledSkin(button)).toEqual(rest);
    } finally { await page.mouse.up(); }
  }
  return rest;
}

async function assertEnabledColors(page: Page, button: Locator, touch: boolean) {
  const colors = () => button.evaluate(element => {
    const icon = element.querySelector('.row_article_image_arrow_icon');
    if (!icon) throw new Error('Expected an image-arrow mask');
    return { iconColor: getComputedStyle(icon).backgroundColor,
      buttonColor: getComputedStyle(element).color };
  });
  // Desktop captures pin visibility by hovering an arrow; leave it before sampling rest.
  if (!touch) await page.mouse.move(0, 0);
  await waitForVisiblePageReady(page);
  expect(await button.evaluate(element => element.matches(':hover')), 'Enabled arrow at rest').toBe(false);
  const rest = await colors();
  expect(rest.iconColor, 'Enabled resting mask follows button colour').toBe(rest.buttonColor);
  let hover = null;
  if (!touch) {
    await hoverImageArrow(page, button);
    hover = await colors();
    expect(hover.iconColor, 'Enabled hovered mask follows button colour').toBe(hover.buttonColor);
  }
  return { rest, hover };
}

async function capturePair(page: Page, root: Locator, name: string, testInfo: TestInfo,
  touch: boolean, carousel = false) {
  await root.scrollIntoViewIfNeeded();
  await waitForVisiblePageReady(page);
  if (!touch) {
    // Reveal only after readiness, then pin the real idle controller by hovering
    // an enabled control. Old disabled arrows use 52% opacity and may hide at idle.
    await root.hover({ position: { x: 2, y: 2 } });
    const next = arrow(root, 'next', carousel);
    await hoverImageArrow(page, await next.isEnabled() ? next : arrow(root, 'previous', carousel));
  }
  const measurements = [];
  for (const direction of ['previous', 'next']) {
    const button = arrow(root, direction, carousel);
    await expect(button).toBeVisible();
    if (phase === 'after') {
      await expect(button).toHaveCSS('opacity', '1');
      const measurement = await measureInk(button);
      expect(Math.abs(measurement.dx), `${name} ${direction} ink X`).toBeLessThanOrEqual(1);
      expect(Math.abs(measurement.dy), `${name} ${direction} ink Y`).toBeLessThanOrEqual(1);
      expect(measurement.iconWidth).toBeGreaterThan(0);
      expect(measurement.iconWidth).toBe(measurement.iconHeight);
      expect(measurement.label).toBeTruthy();
      const enabledColors = measurement.disabled ? null : await assertEnabledColors(page, button, touch);
      const disabledSkin = measurement.disabled ? await assertDisabled(page, button, touch) : null;
      measurements.push({ direction, ...measurement, enabledColors, disabledSkin });
    }
  }
  const enabledIconColor = measurements.find(measurement => !measurement.disabled)?.iconColor;
  if (phase === 'after') {
    expect(enabledIconColor, `${name} enabled arrow for colour comparison`).toBeTruthy();
    for (const measurement of measurements.filter(item => item.disabled)) {
      expect(measurement.iconColor, `${name} disabled mask colour`)
        .toBe(measurement.expectedDisabledIconColor);
      expect(measurement.iconColor, `${name} disabled/enabled distinction`).not.toBe(enabledIconColor);
      expect(measurement.buttonBackground, `${name} disabled button background`)
        .toBe(measurement.expectedDisabledBackground);
    }
  }
  const folder = path.join(outputRoot, testInfo.project.name, testInfo.title.replace(/[^a-z0-9-]/gi, '_'));
  await mkdir(folder, { recursive: true });
  const screenshot = path.join(folder, `${name}.png`);
  await root.screenshot({ path: screenshot, animations: 'disabled' });
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
  if (phase === 'after') await writeFile(path.join(folder, `${name}.json`),
    JSON.stringify(measurements.map(measurement => ({ ...measurement, enabledIconColor })), null, 2));
}

async function captureImageBoundaries(page: Page, root: Locator, name: string,
  testInfo: TestInfo, touch: boolean) {
  await expect(root.locator('[data-testid="row-article-image-position"]')).toHaveText(`1 / ${imageCount}`);
  await expect(arrow(root, 'previous')).toBeDisabled();
  await expect(arrow(root, 'next')).toBeEnabled();
  await capturePair(page, root, `${name}-first`, testInfo, touch);
  for (let index = 1; index < imageCount; index++) {
    const next = arrow(root, 'next');
    if (touch) await next.tap();
    else await next.click();
    await expect(root.locator('[data-testid="row-article-image-position"]'))
      .toHaveText(`${index + 1} / ${imageCount}`);
  }
  await expect(arrow(root, 'next')).toBeDisabled();
  await expect(arrow(root, 'previous')).toBeEnabled();
  await capturePair(page, root, `${name}-last`, testInfo, touch);
}

for (const device of ['desktop', 'phone'] as const) {
  test.describe(`WO32 ${device}`, () => {
    test.use({ hasTouch: device === 'phone' });
    for (const theme of ['light', 'dark'] as const) {
      test(`${theme} article image arrows`, async ({ page, playwright, baseURL,
        extraHTTPHeaders, ignoreHTTPSErrors, ownedProbe }, testInfo) => {
        test.skip(testInfo.project.name !== (device === 'phone' ? 'mobile-card' : 'desktop-card'),
          'Owner proof uses desktop and a real touch-capable phone context.');
        test.setTimeout(120_000);
        const touch = device === 'phone';
        // Opposite OS preference catches aliases frozen on :root in either app theme.
        await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
        await page.route(url => url.pathname === '/api/user-visual-preference', route => {
          if (route.request().method() !== 'GET') return route.continue();
          return route.fulfill({ json: { theme_mode: theme, revision: 1, configured: true } });
        });
        await page.addInitScript(selectedTheme => {
          localStorage.setItem('theme', selectedTheme);
          localStorage.setItem('chosen_language', 'fi');
        }, theme);
        await login(page, loadCredentials());
        // Never borrow page.request: the browser runner closes it at a test timeout.
        const request = ownedProbe.request = await playwright.request.newContext({
          baseURL, extraHTTPHeaders, ignoreHTTPSErrors, timeout: 10_000,
          storageState: await page.context().storageState(),
        });
        const dataset = ownedProbe.dataset;
        await test.step('Create the owned image dataset', async () => {
          await createTempDataset(page, { datasetName: dataset,
            columns: { id: 'SERIAL', title: 'TEXT', description: 'TEXT', detail_note: 'TEXT' },
            seedRows: [{ title: 'Kuvanuolten keskitys', description: 'Tilapäinen kuvasarja', detail_note: 'WO32' }] });
          const enable = await postJsonWithCsrf(page, '/api/asset-linking/images/enable',
            { parent_table: dataset, max_file_size_mb: 10 });
          expect(enable.status, enable.body).toBe(201);
          await recordTestDatasetOwnershipFromRequest(request, dataset);
        });
        await test.step('Upload all six images before opening the article', async () => {
          const status = await request.get(`/api/asset-linking/status?table=${encodeURIComponent(dataset)}`);
          expect(status.ok()).toBe(true);
          const relations = (await status.json()).image_asset_linkings;
          expect(relations).toHaveLength(1);
          const relation = relations[0];
          expect(relation.parent_table).toBe(dataset);
          expect(relation.child_table).toBe(`${dataset}_assets`);
          expect(relation.foreign_key_column).toBeTruthy();
          const csrf = await fetchCsrfTokenForRequest(request);
          for (let index = 0; index < imageCount; index++) {
            const filename = `wo32-${index}.png`;
            const upload = await request.post(`/api/add-row-multipart?dataset=${encodeURIComponent(relation.child_table)}`, {
              headers: { 'X-CSRF-Token': csrf },
              multipart: {
                jsonPayload: JSON.stringify({ [relation.foreign_key_column]: 1, asset_kind: 'image',
                  original_name: filename, mime_type: 'image/png', size_bytes: imagePng.length, title: filename }),
                file_child_0: { name: filename, mimeType: 'image/png', buffer: imagePng },
              },
            });
            expect(upload.status(), `Image ${index + 1} upload`).toBe(201);
          }
          // The managed cached_image field now has a value, so the first article
          // build includes classic inline media. An empty pre-upload article does not.
          await configureArticleFieldRoles(page, dataset);
          await openTempDatasetRowArticle(page, dataset, 1);
          await expect(page.locator('body')).toHaveClass(new RegExp(`${theme}-mode`));
        });
        const article = page.locator('[data-testid="big-card-container"]');
        await expect(article.locator('[data-testid="row-article-inline-media"]')).toBeVisible();
        await test.step('Capture carousel first and last', async () => {
          const carousel = article.locator('.big_card_thumbnail_row');
          await expect(arrow(carousel, 'next', true)).toBeEnabled();
          await expect(arrow(carousel, 'previous', true)).toBeDisabled();
          await capturePair(page, carousel, 'carousel-first', testInfo, touch, true);
          await arrow(carousel, 'next', true).click();
          await expect(arrow(carousel, 'next', true)).toBeDisabled();
          await expect(arrow(carousel, 'previous', true)).toBeEnabled();
          await capturePair(page, carousel, 'carousel-last', testInfo, touch, true);
          await arrow(carousel, 'previous', true).click();
          await expect(article.locator('[data-testid="big-card-image-thumb-0"]')).toBeVisible();
        });
        const view = page.locator('[data-testid="image-first-view"]');
        const stage = view.locator('[data-testid="row-article-image-first-stage"]');
        await test.step('Open IFAV and capture image boundaries', async () => {
          // On a 375px phone the previous carousel arrow covers the first thumbnail's
          // centre. Use its supported keyboard activation instead of an unclickable hit point.
          await article.locator('[data-testid="big-card-image-thumb-0"]').press('Enter');
          await expect(stage).toBeVisible();
          await captureImageBoundaries(page, stage, 'ifav', testInfo, touch);
        });
        if (touch) {
          await test.step('Capture phone controls after the real idle timer', async () => {
            // Wait for the real idle controller; capturePair never touches phone controls.
            await page.mouse.move(0, 0);
            await expect(page.locator('.image_first_view_overlay')).not.toHaveClass(/image-modal-controls-active/,
              { timeout: 5_000 });
            await capturePair(page, stage, 'ifav-touch-idle', testInfo, touch);
            await expect(page.locator('.image_first_view_overlay')).not.toHaveClass(/image-modal-controls-active/);
          });
        }
        await test.step('Close IFAV', async () => {
          await page.keyboard.press('Escape');
          await expect(view).toBeHidden();
        });
        await test.step('Capture classic image boundaries', async () => {
          const inline = article.locator('[data-testid="row-article-inline-media"]').first();
          await expect(inline).toBeVisible();
          // A retained article may remember its own selection. Its keyboard handler
          // reaches the first image without waiting on pointer-hidden desktop controls.
          for (let remaining = imageCount - 1; remaining > 0 && await arrow(inline, 'previous').isEnabled(); remaining--) {
            await inline.press('ArrowLeft');
          }
          await captureImageBoundaries(page, inline, 'classic', testInfo, touch);
        });
      });
    }
  });
}
