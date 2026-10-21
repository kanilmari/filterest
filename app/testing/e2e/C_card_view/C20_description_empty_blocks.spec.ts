/**
 * C20_description_empty_blocks.spec.ts
 * Proves sanitized preview text occupies the clipped box in both explicit themes.
 * Connects the real description builder, formatter, locale reader and card styles.
 * Uses an offline browser fixture: no application server, account or dataset writes.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

const appRoot = path.resolve(__dirname, '../../..');
const origin = 'https://card-preview.invalid';
const cardRoot = '/frontend/core_components/table_views/card_view/';
// Stub only neighbours unrelated to description rendering; all preview code,
// sanitization, language resolution and styles come from this checkout.
const stubs: Record<string, string> = {
  '/frontend/core_components/endpoints/endpoint_router.js': 'export function endpoint_router() { throw Error("Unexpected API call"); }',
  [cardRoot + 'card_avatar_builder.js']: 'export function createImageElement() {} export function create_seeded_avatar() {}',
  [cardRoot + 'row_article_opener.js']: 'export function openRowArticleView() {}',
  [cardRoot + 'image_first_view_activation.js']: 'export function bindImageFirstViewActivation() {}',
  [cardRoot + 'dataset_icon_builder.js']: 'export function createDatasetIconElement() {}',
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
      <style>body { margin: 24px; background: var(--bg_color); color: var(--text_color); font: 16px sans-serif; }
      #fixture { width: 440px; max-width: 90vw; } .card { animation: none !important; transition: none !important; }</style>
      <body class="${theme}-mode"><main id="fixture"></main></body>` });
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
