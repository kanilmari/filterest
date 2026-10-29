// C31_article_one_heading.spec.ts
// Proves all three article presentations share the exact first-heading rule.
// Connects owned temporary datasets, real image uploads and the existing article editor.
// Covers FI/EN, opposite OS themes, desktop/phone, and cleans up even on failure.
import { expect, test, type Page } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest, openTempDatasetRowArticle } from '../helpers/temp-dataset';
import { closeArticleToCardView, postJsonWithCsrf } from '../helpers/image-first-article';
import { loadDatasetCardVisibility } from '../helpers/appearance-revisions';

const presentations = ['article_view', 'image_first_view', 'image_first_page_view'] as const;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const content = (same: boolean) => `<p><br></p><h2>${same ? 'Contact' : 'Contact us'}</h2>`
  + '<p>Owned article heading proof; the full authored text must stay editable.</p><h1>Section</h1><h3>Subsection</h3>';

async function applyTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate(value => {
    document.body.classList.remove('light-mode', 'dark-mode', 'system-mode');
    document.body.classList.add(`${value}-mode`);
  }, theme);
  await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
}

for (const presentation of presentations) for (const theme of ['light', 'dark'] as const) {
  test(`WO94 ${presentation}: one heading and advisory editor in ${theme}`, async ({ page }, info) => {
    test.skip(!['desktop-card', 'mobile-card'].includes(info.project.name), 'WO94 desktop and phone matrix');
    test.setTimeout(180_000);
    await login(page, loadCredentials());
    const dataset = buildTempDatasetName('e2e_wo94_headings');
    let created = false;
    const originalLanguage = await page.evaluate(() => localStorage.getItem('chosen_language'));
    try {
      await createTempDataset(page, { datasetName: dataset,
        columns: { id: 'SERIAL', title: 'TEXT', content: 'TEXT' },
        seedRows: [true, false].map(same => ({ title: JSON.stringify({ fi: 'Contact', en: 'Contact' }),
          content: JSON.stringify({ fi: content(same), en: content(same) }) })),
      });
      created = true;
      // Matching needs known content languages; plain text deliberately has none.
      const visibility = await loadDatasetCardVisibility(page.request, dataset);
      for (const name of ['title', 'content']) {
        const column = visibility.columns.find(column => column.column_name === name);
        expect(column).toBeTruthy();
        const configured = await postJsonWithCsrf(page, '/api/admin/column-multilingual', {
          dataset, column_uid: column!.column_uid, is_multilingual: true,
        });
        expect(configured.ok, configured.body).toBe(true);
      }
      const enabled = await postJsonWithCsrf(page, '/api/asset-linking/images/enable', {
        parent_table: dataset, max_file_size_mb: 10,
      });
      expect(enabled.status, enabled.body).toBe(201);
      // Real owned media makes the existing full-height IFAV route available.
      await page.reload({ waitUntil: 'domcontentloaded' });
      for (const id of [1, 2]) {
        await openTempDatasetRowArticle(page, dataset, id);
        await page.locator('.big_card_image_gallery input[type="file"]').first().setInputFiles({
          name: `wo94-${id}.png`, mimeType: 'image/png', buffer: png,
        });
        await expect(page.locator('[data-testid^="big-card-image-thumb-"]').first()).toBeVisible();
        // The shared top-bar close exists only on desktop; the next openTempDatasetRowArticle reloads anyway.
        if (info.project.name === 'desktop-card') await closeArticleToCardView(page);
      }
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light', reducedMotion: 'reduce' });
      for (const language of ['fi', 'en']) {
        await page.evaluate(value => localStorage.setItem('chosen_language', value), language);
        for (const id of [1, 2]) {
          const same = id === 1;
          await page.goto(`/${dataset}/${id}?view=${presentation}`, { waitUntil: 'domcontentloaded' });
          await expect(page.locator('html')).toHaveAttribute('lang', language);
          const article = page.locator(presentation === 'article_view'
            ? '.active_row_article .row_article_content' : '.image_first_view .row_article_content');
          await expect(article).toBeVisible();
          await applyTheme(page, theme);
          await expect(article.locator('h1')).toHaveCount(1);
          await expect(article.locator('h1.big_card_header')).toHaveText('Contact');
          const titleStyles = await article.locator('h1.big_card_header').evaluate(node => {
            const legacy = document.createElement('div');
            legacy.className = node.className;
            legacy.textContent = node.textContent;
            node.after(legacy);
            const style = (element: Element) => {
              const computed = getComputedStyle(element);
              return [computed.fontSize, computed.marginTop, computed.marginBottom];
            };
            try { return { title: style(node), legacy: style(legacy) }; }
            finally { legacy.remove(); }
          });
          expect(titleStyles.title).toEqual(titleStyles.legacy);
          const body = article.locator('.big_description_value[data-column="content"]');
          await expect(body.locator('h2').filter({ hasText: /^Contact$/ })).toHaveCount(0);
          await expect(body.locator('h2').filter({ hasText: /^Contact us$/ })).toHaveCount(same ? 0 : 1);
          await expect(body.locator('h3')).toHaveText('Subsection');
          const demoted = body.locator('h2[data-demoted-from="h1"]');
          await expect(demoted).toHaveText('Section');
          const sizes = await demoted.evaluate(node => {
            const authored = document.createElement('h1');
            authored.textContent = node.textContent;
            node.after(authored);
            try { return { rendered: getComputedStyle(node).fontSize, authored: getComputedStyle(authored).fontSize }; }
            finally { authored.remove(); }
          });
          expect(sizes.rendered).toBe(sizes.authored);
          expect(parseFloat(sizes.rendered)).toBeGreaterThan(0);
          await page.screenshot({ path: info.outputPath(`${presentation}-${theme}-${language}-${id}.png`), fullPage: true });

          // IFAV/Page are read-only. Their row is edited through the existing ordinary article form.
          if (presentation !== 'article_view') {
            await page.goto(`/${dataset}/${id}?view=article_view`, { waitUntil: 'domcontentloaded' });
            await expect(page.locator('.active_row_article')).toBeVisible();
            await applyTheme(page, theme);
          }
          const editor = page.locator('.active_row_article');
          await editor.getByTestId('big-card-edit-button').click();
          const input = editor.locator('[data-column="content"] textarea');
          await expect(input).toHaveValue(content(same));
          const hint = editor.locator('[data-column="content"] .row-article-heading-hint');
          await expect(hint).toHaveAttribute('aria-live', 'polite');
          const copy = language === 'fi' ? 'Sisältö alkaa samalla otsikolla kuin rivi; otsikko näytetään jo.'
            : 'The content starts with the row title, which is already shown.';
          await expect(hint).toHaveText(same ? copy : '');
          if (same) {
            await expect(hint).toBeVisible();
            const title = editor.locator('.big_card_header_value input');
            await title.fill('Another title'); await expect(hint).toHaveText('');
            await title.fill('Contact'); await expect(hint).toHaveText(copy);
            await input.fill('<h2>Contact us</h2><p>New content</p>'); await expect(hint).toHaveText('');
            await input.fill(content(true)); await expect(hint).toHaveText(copy);
            await expect(editor.getByTestId('big-card-edit-button')).toBeEnabled();
          }
          await page.screenshot({ path: info.outputPath(`editor-${presentation}-${theme}-${language}-${id}.png`), fullPage: true });
          await editor.getByTestId('big-card-cancel-button').click();
          await expect(editor.locator('.row_article_content h1')).toHaveCount(1);
          await expect(editor.locator('.row-article-heading-hint')).toHaveCount(0);
        }
      }
    } finally {
      try { if (created) await cleanupDatasetViaRequest(page.request, dataset); }
      finally {
        await page.evaluate(value => {
          if (value === null) localStorage.removeItem('chosen_language');
          else localStorage.setItem('chosen_language', value);
        }, originalLanguage);
      }
    }
  });
}
