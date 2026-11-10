// C28_details_edges_and_show_more.spec.ts
// Proves stacked list edges, pre-563 wide frames and category rounding in both image sizes.
// Uses the existing owned dataset fixture; appearance writes affect only that dataset.
// Exercises explicit application themes over opposite OS themes and cleans up on failure.
import { expect, test, type Locator } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest, openTempDataset, openTempDatasetRowArticle } from '../helpers/temp-dataset';
import { saveCardVisibilityWithFreshRevisions } from '../helpers/appearance-revisions';
import { closeActiveFilterbarIfOpen } from '../helpers/filterbar';

// Expected frames read from 96478826: cards.css:297-310, 343-346, 436-437;
// standard card_details_kv and cards_big.css have no outer border/radius declarations.
// Keep these values in the spec: no Git or historical stylesheet is needed at runtime.
const PRE_563 = {
  standard: { border: '0 none currentColor', borderRadius: '0px' },
  modern: { border: '1px solid var(--card-modern-surface-border)', borderRadius: 'var(--border_radius)' },
  modernDetails: { border: '0 none currentColor', borderRadius: '0px', borderTop: '1px solid var(--card-modern-separator-color)' },
  big: { border: '0 none currentColor', borderRadius: '0px' },
};
const STACKED = { border: '0 none currentColor', borderRadius: '0px',
  borderBlock: '1px solid var(--border_color)' };

async function expectEdges(list: Locator, expected: Record<string, string>) {
  await expect(list).toBeVisible();
  const edges = await list.evaluate((element, frame) => {
    const properties = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
      ...['top', 'right', 'bottom', 'left'].flatMap(side => ['width', 'style', 'color'].map(part => `border-${side}-${part}`))];
    const read = (node: Element) => {
      const css = getComputedStyle(node);
      return Object.fromEntries(properties.map(property => [property, css.getPropertyValue(property)]));
    };
    const actual = read(element), probe = document.createElement('span');
    probe.style.cssText = 'all: initial; color: var(--text_color);';
    Object.assign(probe.style, frame); element.append(probe);
    const resolved = read(probe); probe.remove();
    return { actual, resolved };
  }, expected);
  expect(edges.actual).toEqual(edges.resolved);
}

for (const width of [390, 1200, 1201, 1440, 1600, 1920]) for (const theme of ['light', 'dark'] as const) for (const size of ['small', 'large']) {
  test(`WO96 ${size} card edges and Show more at ${width}px/${theme}`, async ({ page, context }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    // Response-only account preference survives every helper navigation and reload.
    await context.route(url => url.pathname === '/api/user-visual-preference', async route => {
      expect(route.request().method()).toBe('GET');
      await route.fulfill({ json: { configured: true, revision: 1, theme_mode: theme } });
    });
    await context.addInitScript(theme => {
      localStorage.setItem('theme', theme); localStorage.setItem('chosen_language', 'fi');
    }, theme);
    await login(page, loadCredentials());
    const dataset = buildTempDatasetName('e2e_wo96_card'); let created = false;
    try {
      // Seed rows carry only application columns: row inserts refuse system fields (id/created/updated);
      // the `id` column definition stays, as in batch 563's natively passing C28 and in C29.
      await createTempDataset(page, { datasetName: dataset,
        columns: { id: 'SERIAL', name: 'TEXT', description: 'TEXT', published: 'TEXT', link: 'TEXT', ...(size === 'large' ? { thumbnail: 'TEXT' } : {}) },
        seedRows: [{ name: 'Matka / Travel', description: 'Kuvaus / Description', published: '22.10.2026', link: 'https://example.test/',
          ...(size === 'large' ? { thumbnail: '/frontend/favicon4E.png' } : {}) }] });
      created = true;
      const roles: Record<string, string> = { name: 'header', description: 'description', published: 'details', link: 'details', thumbnail: 'image' };
      for (const style of ['standard', 'modern']) {
        await saveCardVisibilityWithFreshRevisions(page.request, dataset, visibility => ({ card_style_variant: style,
          columns: visibility.columns.map(column => roles[column.column_name] ? {
            ...column, card_element: roles[column.column_name], show_value_on_card: true,
          } : column) }));
        await openTempDataset(page, dataset, 'card');
        await closeActiveFilterbarIfOpen(page);
        await expect(page.locator('body')).toHaveClass(new RegExp(`(^| )${theme}-mode( |$)`));
        await expect(page.locator('html')).toHaveAttribute('lang', 'fi');
        const card = page.locator(`#${dataset}_card_view_container [data-testid="card-item"]`).first();
        await expect(card.locator(`.card_content_${size}`)).toBeVisible();
        const list = card.locator(style === 'modern' ? '.card_modern_info_panel' : '.card_details_kv');
        if (width <= 1550) {
          await expectEdges(list, STACKED);
        } else {
          // Prove the wide layout is active, rather than accidentally testing a narrow container.
          await expect(card.locator('.card_body')).toHaveCSS('flex-direction', 'row');
          const listWidth = await card.evaluate(element => element.closest('.card_container')!.getBoundingClientRect().width);
          expect(listWidth).toBeGreaterThan(1060);
          await expectEdges(list, PRE_563[style as 'standard' | 'modern']);
        }
        if (style === 'modern') await expectEdges(card.locator('.card_details_kv'), PRE_563.modernDetails);
        const more = card.locator('button[data-lang-key="show_more"]');
        await expect(more).toBeVisible();
        const radii = await more.evaluate(element => {
          const probe = document.createElement('span'); probe.style.borderRadius = 'var(--search_tools_radius)'; element.append(probe);
          const expected = getComputedStyle(probe).borderTopLeftRadius; probe.remove();
          return [getComputedStyle(element).borderTopLeftRadius, expected];
        });
        expect(radii[0]).toBe(radii[1]); expect(parseFloat(radii[1])).toBeGreaterThan(0);
        await page.screenshot({ path: info.outputPath(`${style}-card.png`) });
      }
      await openTempDatasetRowArticle(page, dataset, 1);
      await expect(page.locator('body')).toHaveClass(new RegExp(`(^| )${theme}-mode( |$)`));
      await expectEdges(page.locator('.big_card_details_container:visible'), width <= 1200 ? STACKED : PRE_563.big);
      await expect(page.locator('.big_card_details_container > div').first()).toHaveCSS('border-bottom-width', '2px');
    } finally { if (created) await cleanupDatasetViaRequest(page.request, dataset); }
  });
}

/** Measure painted words, omitting whitespace and inline element boxes. One line can include several text nodes. */
async function measureDetailLines(value: Locator) {
  return value.evaluate(value => {
    const field = value.closest('.two_line_field')!;
    const label = field.querySelector('.two_line_label_text')!;
    const icon = field.querySelector('.two_line_label_icon')!;
    const lines: { top: number; left: number; nodes: Set<Node> }[] = [];
    const textRuns: { tag: string; display: string; rects: { left: number; top: number }[] }[] = [];
    const walker = document.createTreeWalker(value, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
      textRuns.push({ tag: node.parentElement!.tagName, display: getComputedStyle(node.parentElement!).display,
        rects: rects.map(({ left, top }) => ({ left, top })) });
      for (const word of node.textContent!.matchAll(/\S+/g)) {
        range.setStart(node, word.index!);
        range.setEnd(node, word.index! + word[0].length);
        for (const rect of range.getClientRects()) {
          if (rect.width <= 0 || rect.height <= 0) continue;
          let line = lines.find(line => Math.abs(line.top - rect.top) <= 1);
          if (!line) {
            line = { top: rect.top, left: rect.left, nodes: new Set() };
            lines.push(line);
          }
          line.left = Math.min(line.left, rect.left);
          line.nodes.add(node);
        }
      }
    }
    return { textRuns, viewport: innerWidth, fieldWidth: field.getBoundingClientRect().width,
      valueWidth: value.getBoundingClientRect().width, iconRight: icon.getBoundingClientRect().right, labelLeft: label.getBoundingClientRect().left,
      valueLeft: value.getBoundingClientRect().left, lines: lines.sort((a, b) => a.top - b.top)
        .map(line => ({ top: line.top, left: line.left, textNodes: line.nodes.size })) };
  });
}

function misalignedLines(sample: Awaited<ReturnType<typeof measureDetailLines>>) {
  const starts = [sample.labelLeft, sample.valueLeft, sample.lines[0].left];
  return sample.lines.flatMap((line, index) => starts.some(start => Math.abs(line.left - start) > 1) ? [index + 1] : []);
}

for (const [theme, language] of [['light', 'fi'], ['dark', 'en']] as const) {
  test(`#1000 wrapped article Details keep the label's indentation at 320 and 390px, ${theme}/${language}`, async ({ page, context }, info) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    await context.route(url => url.pathname === '/api/user-visual-preference', route =>
      route.fulfill({ json: { configured: true, revision: 1, theme_mode: theme } }));
    await context.addInitScript(({ theme, language }) => {
      localStorage.setItem('theme', theme); localStorage.setItem('chosen_language', language);
    }, { theme, language });
    await login(page, loadCredentials());
    const dataset = buildTempDatasetName('e2e_detail_indent');
    const valueSelector = '.big_card_details_container .two_line_value[data-column="e2e_notes"]';
    let created = false;
    try {
      await createTempDataset(page, { datasetName: dataset, columns: { id: 'SERIAL', e2e_title: 'TEXT', e2e_notes: 'TEXT' },
        seedRows: [{ e2e_title: 'Harbour', e2e_notes: 'North <strong>quay</strong> opens early for the morning ferry. '
          + 'The crew checks the upper deck, counts the passengers and confirms the route before leaving the harbour.' }] });
      created = true;
      await saveCardVisibilityWithFreshRevisions(page.request, dataset, visibility => ({
        columns: visibility.columns.map(column => {
          if (column.column_name === 'e2e_title') return { ...column, card_element: 'header', show_value_on_card: true };
          if (column.column_name === 'e2e_notes') return { ...column, card_element: 'details', show_value_on_card: true,
            show_key_on_card: true, show_key_on_card_override: true };
          return column;
        }),
      }));
      await page.setViewportSize({ width: 320, height: 900 });
      await openTempDatasetRowArticle(page, dataset, 1);
      await closeActiveFilterbarIfOpen(page);
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      const section = page.getByTestId('big-card-container').locator('.row_article_details_section:visible');
      const toggle = section.locator('.row_article_disclosure_header');
      if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
      const value = section.locator(valueSelector);
      await expect(value.locator('strong')).toHaveText('quay');
      await expect(value).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      for (const width of [320, 390]) await test.step(`${width}px`, async () => {
        await page.setViewportSize({ width, height: 900 });
        await value.scrollIntoViewIfNeeded();
        await expect(value).toBeInViewport();
        const natural = await measureDetailLines(value);
        await info.attach(`${width}px natural visual lines`, { contentType: 'application/json',
          body: JSON.stringify({ width, theme, language, natural }) });
        expect(natural.viewport).toBe(width);
        expect(natural.valueWidth).toBeGreaterThan(width / 2);
        expect(natural.lines.length).toBeGreaterThanOrEqual(2);
        expect(natural.lines[0].textNodes).toBeGreaterThan(1);
        expect(natural.labelLeft).toBeGreaterThan(natural.iconRight);
        expect(misalignedLines(natural), 'every visible line starts under the label text').toEqual([]);

        // A local hanging indent moves only continuation text; measure it through the same path.
        const originalStyle = await value.evaluate(element => {
          const style = (element as HTMLElement).style;
          const original = { paddingInlineStart: style.paddingInlineStart, textIndent: style.textIndent };
          style.paddingInlineStart = '16px';
          style.textIndent = '-16px';
          return original;
        });
        try {
          const hanging = await measureDetailLines(value);
          await info.attach(`${width}px visual lines`, { contentType: 'application/json',
            body: JSON.stringify({ width, theme, language, natural, hanging }) });
          expect(hanging.lines.length).toBeGreaterThanOrEqual(2);
          expect(hanging.lines[0].left).toBeCloseTo(natural.lines[0].left, 1);
          expect(hanging.labelLeft).toBeCloseTo(natural.labelLeft, 1);
          expect(hanging.valueLeft).toBeCloseTo(natural.valueLeft, 1);
          expect(hanging.lines[1].left - natural.lines[0].left).toBeCloseTo(16, 0);
          expect(misalignedLines(hanging), 'only continuation lines should fail')
            .toEqual(hanging.lines.slice(1).map((_, index) => index + 2));
        } finally {
          await value.evaluate((element, original) => Object.assign((element as HTMLElement).style, original), originalStyle);
        }
      });
    } finally { if (created) await cleanupDatasetViaRequest(page.request, dataset); }
  });
}
