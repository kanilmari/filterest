/**
 * C20_description_empty_blocks.spec.ts
 * Proves sanitized preview text occupies the clipped box in both explicit themes.
 * Connects the real description builder, formatter, locale reader and card styles.
 * Uses an offline browser fixture: no application server, account or dataset writes.
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

const appRoot = path.resolve(__dirname, '../../..');
const origin = 'https://card-preview.invalid';
const cardRoot = '/frontend/core_components/table_views/card_view/';
// Stub only neighbours unrelated to description rendering; all preview code,
// sanitization, language resolution and styles come from this checkout.
const stubs: Record<string, string> = {
  '/frontend/core_components/endpoints/endpoint_router.js': 'export function endpoint_router() { throw Error("Unexpected API call"); }',
  [cardRoot + 'card_avatar_builder.js']: 'export function createImageElement() {} export function create_seeded_avatar() {} export function updateCardImageFrame() {}',
  [cardRoot + 'row_article_opener.js']: 'export function openRowArticleView() {}',
  [cardRoot + 'image_first_view_activation.js']: 'export function bindImageFirstViewActivation() {}',
  '/frontend/core_components/dev_tools/function_counter.js': 'export function count_this_function() {}',
  '/frontend/icons/icon_loader.js': 'export function setElementSvgContent() {}',
  '/frontend/core_components/route_permission_checker.js': 'export function hasRoutePermission() { return true; }',
  '/frontend/ui_config.js': 'export const show_more_button_on_cards = false; export function predictCardImageCssWidth() { return 300; } export function resolveCardMediaFolderForImageWidth() { return "1000"; }',
};

async function openOfflineFixture(page: Page, theme: string) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) throw Error(`Unexpected request: ${url.origin}`);
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html>
      <link rel="stylesheet" href="/frontend/styles/variables.css">
      <!-- Match imports.css: base.css resets paragraph margins before card styles.
           Browser default margins otherwise push short text outside a one-line clamp. -->
      <link rel="stylesheet" href="/frontend/styles/base.css">
      <link rel="stylesheet" href="${cardRoot}cards.css">
      <link rel="stylesheet" href="${cardRoot}card_description_lines.css">
      <link rel="stylesheet" href="/frontend/reusable_components/key_value_container/kv_container.css">
      <link rel="stylesheet" href="${cardRoot}card_field_label_placement.css">
      <style>body { margin: 24px; background: var(--bg_color); color: var(--text_color); font: 16px sans-serif; }
      #fixture { width: 440px; max-width: 90vw; } .card { animation: none !important; transition: none !important; }</style>
      <body class="${theme}-mode"><main id="fixture"></main></body>` });
    if (url.pathname === '/symbol-assets/table.svg') {
      return route.fulfill({ contentType: 'image/svg+xml', body: await readFile(path.join(appRoot, 'frontend/icons/symbols/table.svg')) });
    }
    if (stubs[url.pathname]) return route.fulfill({ contentType: 'text/javascript', body: stubs[url.pathname] });
    const file = path.resolve(appRoot, '.' + url.pathname);
    if (!file.startsWith(appRoot + path.sep)) throw Error('Fixture path escaped app');
    // JSON modules (`import … with { type: 'json' }`, e.g. contract_reader.js) need the JSON MIME type, as the server sends.
    const contentType = file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/javascript';
    await route.fulfill({ contentType, body: await readFile(file) });
  });
  await page.goto(origin);
}

async function render(page: Page, html: string, language: string, variant: string, lines: number, form = 'json') {
  await page.evaluate(async ({ html, language, variant, lines, form, cardRoot }) => {
    const builderPath = cardRoot + 'card_element_builder.js';
    const { addDescriptionSection } = await import(builderPath);
    const localePath = '/frontend/reusable_components/lang_value_reader.js';
    const { extractLangValue } = await import(localePath);
    localStorage.setItem('chosen_language', language);
    const localized = { fi: language === 'fi' ? html : 'Muu kieli', en: language === 'en' ? html : 'Other language' };
    const raw = form === 'plain' ? html : form === 'object' ? localized : JSON.stringify(localized);
    const card = document.createElement('div');
    card.className = variant === 'modern' ? 'card card--modern' : 'card';
    card.dataset.cardPresentationView = variant === 'article-result' ? 'article_view' : 'card';
    card.style.setProperty('--card-description-lines', String(lines));
    const content = document.createElement('div');
    content.className = variant === 'compact' ? 'card_content card_content_small' : 'card_content';
    const body = document.createElement('div'); body.className = 'card_body';
    const text = document.createElement('div'); text.className = 'card_text_content';
    body.append(text); content.append(body); card.append(content);
    document.querySelector('#fixture')!.replaceChildren(card);
    addDescriptionSection([{ suffix_number: 1, label: '', column: 'body', columnClass: 'fixture_body',
      columnMeta: {}, hasLangKey: false, rawValue: extractLangValue(raw, language) }], { id: 1 }, 'fixture', text);
  }, { html, language, variant, lines, form, cardRoot });
  return page.locator('.description_value');
}

// Pseudo-elements have no DOM bounding rectangle. Color their actual painted boxes
// without changing layout, then measure the first painted row in CSS pixels.
async function iconInsets(container: Locator) {
  const png = (await container.screenshot({ scale: 'css' })).toString('base64');
  return container.evaluate(async (el, data) => {
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0);
    image.close();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const style = getComputedStyle(el);
    const contentTop = parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
    let badge = NaN, glyph = NaN;
    for (let i = 0; i < pixels.length; i += 4) {
      const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
      const top = Math.floor(i / (4 * canvas.width)) - contentTop;
      if (isNaN(badge) && r === 255 && g === 0 && b === 255) badge = top;
      if (isNaN(glyph) && r === 0 && g === 255 && b === 255) glyph = top;
      if (Number.isFinite(glyph) && Number.isFinite(badge)) break;
    }
    return { badge, glyph, expectedGlyph: (parseFloat(getComputedStyle(el, '::before').height)
      - parseFloat(getComputedStyle(el, '::after').height)) / 2 };
  }, png);
}

test('C20 card descriptions display the configured number of text lines', async ({ page }, info) => {
  await openOfflineFixture(page, 'light');
  await page.addStyleTag({ url: '/frontend/styles/mobile_friendliness.css' });
  await page.addStyleTag({ content: `
    body { container: card-list / inline-size; }
    .card--modern :is(.card_header, .card_description_container)::before { background: #f0f !important; }
    .card--modern :is(.card_header, .card_description_container)::after { background: #0ff !important; border-color: #0ff !important; }
  ` });
  const samples = [];
  const icons = [];
  const longText = 'A long description that wraps at every viewport width. '.repeat(100);
  for (const width of [390, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    for (const variant of ['normal', 'modern', 'compact', 'article-result']) {
      for (const lines of [1, 2, 5, 11]) {
        const description = await render(page, longText, 'en', variant, lines, 'plain');
        const measurement = await description.evaluate(element => {
          const box = element.getBoundingClientRect();
          const range = document.createRange();
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          const rows = new Set<number>();
          while (walker.nextNode()) {
            range.selectNodeContents(walker.currentNode);
            for (const rect of Array.from(range.getClientRects())) {
              if (rect.width > 0 && rect.height > 0 && rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1) {
                rows.add(Math.round(rect.top));
              }
            }
          }
          return {
            clamp: getComputedStyle(element).getPropertyValue('-webkit-line-clamp'),
            visibleLines: rows.size,
          };
        });
        samples.push({ width, variant, lines, ...measurement });
        if (variant === 'modern' || variant === 'normal') {
          await page.evaluate(async ({ cardRoot, variant }) => {
            const { addHeaderElement } = await import(cardRoot + 'card_element_builder.js');
            if (variant === 'normal') localStorage.setItem('fixture_tableMeta', '{"icon_key":"table"}');
            else localStorage.removeItem('fixture_tableMeta');
            addHeaderElement('A weekend at sea<br>The harbour trail',
              '', 'title', false, { id: 1 }, 'fixture', document.querySelector('.card_text_content'));
          }, { cardRoot, variant });
          const header = page.locator('.card_header');
          const heading = header.locator('.header_value');
          const titleLines = await heading.evaluate(el => {
            const range = document.createRange();
            range.selectNodeContents(el);
            const bounds = el.getBoundingClientRect();
            return new Set(Array.from(range.getClientRects()).filter(r => r.top < bounds.bottom && r.bottom > bounds.top)
              .map(r => Math.round(r.top))).size;
          });
          if (variant === 'modern') {
            for (const [field, box] of [['header', header], ['description', page.locator('.card_description_container')]] as const) {
              icons.push({ width, variant, lines, titleLines, field, ...await iconInsets(box) });
            }
          } else {
            const offset = await header.locator('.card_header_dataset_icon').evaluate(icon => {
              const parent = icon.parentElement!;
              const style = getComputedStyle(parent);
              return icon.getBoundingClientRect().top - parent.getBoundingClientRect().top
                - parseFloat(style.paddingTop) - parseFloat(style.borderTopWidth);
            });
            icons.push({ width, variant, lines, titleLines, field: 'dataset', badge: offset, glyph: 0, expectedGlyph: 0 });
          }
        }
      }
    }
  }
  await info.attach('description-line-counts', { body: JSON.stringify(samples), contentType: 'application/json' });
  await info.attach('card-icon-geometry', { body: JSON.stringify(icons), contentType: 'application/json' });
  expect(icons.filter(m => m.titleLines !== 2 || !(Math.abs(m.badge) <= 1 && Math.abs(m.glyph - m.expectedGlyph) <= 1))).toEqual([]);
  expect(samples.filter(s => s.clamp !== String(s.lines) || s.visibleLines !== s.lines)).toEqual([]);
});

for (const theme of ['light', 'dark']) {
  for (const language of ['fi', 'en']) {
    test(`C20 visible description in ${theme} / ${language}`, async ({ page }, info) => {
      test.setTimeout(120000);
      // Test the explicit application theme against the opposite OS preference.
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await openOfflineFixture(page, theme);
      const text = language === 'fi' ? 'Näkyvä teksti' : 'Visible text';
      const prefixes = ['\n\n', '\r\n \t\u00a0', '<br>', '<p><br></p>', '<p></p><p>&nbsp;</p>',
        '<div><span>\u00a0<br></span></div>'];
      for (const variant of ['normal', 'modern', 'compact', 'article-result']) {
        for (const lines of [1, 2, 6]) {
          for (const [index, prefix] of prefixes.entries()) {
            const preview = await render(page, `${prefix}<p>${text}</p>`, language, variant, lines,
              ['plain', 'object', 'json'][index % 3]);
            await expect(preview).toBeVisible();
            await expect(preview).toHaveText(text);
            // textContent alone cannot prove the text is inside the clamp.
            const geometry = await preview.evaluate(element => {
              const box = element.getBoundingClientRect();
              const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
              let visible = 0;
              while (walker.nextNode()) {
                const node = walker.currentNode;
                for (let offset = 0; offset < (node.textContent?.length || 0); offset++) {
                  if (!node.textContent![offset].trim()) continue;
                  const range = document.createRange(); range.setStart(node, offset); range.setEnd(node, offset + 1);
                  const rect = range.getBoundingClientRect();
                  if (rect.width > 0 && rect.top >= box.top && rect.bottom <= box.bottom + 1
                      && rect.left >= box.left && rect.right <= box.right + 1) visible++;
                }
              }
              return { visible, overflow: element.scrollHeight > element.clientHeight + 1,
                height: box.height, lineHeight: parseFloat(getComputedStyle(element).lineHeight) };
            });
            expect(geometry.visible, `${variant}/${lines}/${index}: characters inside clipped box`).toBeGreaterThan(0);
            expect(geometry.overflow, 'short content has no reason for dots').toBe(false);
            expect(geometry.height).toBeLessThanOrEqual(lines * geometry.lineHeight + 1);
          }
          // Block and list boundaries continue to put text on distinct lines.
          for (const blocks of ['<p>A</p><p>B</p>', '<ul><li>A</li><li>B</li></ul>']) {
            const preview = await render(page, `<p><br></p>${blocks}`, language, variant, lines);
            const positions = await preview.evaluate(element => {
              const blocks = element.querySelectorAll('p, li');
              return Array.from(blocks, block => block.getBoundingClientRect().top);
            });
            expect(positions[1]).toBeGreaterThan(positions[0]);
          }
          const overflow = await render(page, `<br><p>${(text + ' ').repeat(150)}</p>`, language, variant, lines);
          expect(await overflow.evaluate(el => el.scrollHeight > el.clientHeight + 1)).toBe(true);
          await expect(overflow).toHaveCSS('-webkit-line-clamp', String(lines));
          if (variant === 'normal' && lines === 1) {
            await info.attach(`overflow-${theme}-${language}`, { body: await overflow.screenshot(), contentType: 'image/png' });
          }
        }
      }
      const empty = await render(page, '<p><br></p><p>&nbsp;</p>', language, 'normal', 1);
      await expect(empty).toBeEmpty();
    });
  }
}
