// C24_cancel_changes.spec.ts
// Proves the article discard action names and restores unsaved edits in FI/EN.
// Connects an owned temporary dataset, the real article editor and explicit themes.
// Captures each language and theme, and removes the dataset even on failure.
import { expect, test, type Request } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import { buildTempDatasetName, createTempDataset, dropTempDataset, openTempDatasetRowArticle } from '../helpers/temp-dataset';
import { waitForVisiblePageReady } from '../../../server_tools/lib/browser_view_readiness.mjs';

for (const theme of ['light', 'dark'] as const) {
  test(`Cancel changes discards the article draft in FI/EN, ${theme} theme`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await login(page, loadCredentials());
    const dataset = buildTempDatasetName('e2e_cancel_changes');
    const originalLanguage = await page.evaluate(() => localStorage.getItem('chosen_language'));
    let created = false;
    try {
      await createTempDataset(page, {
        datasetName: dataset,
        columns: { id: 'SERIAL', title: 'TEXT', content: 'TEXT' },
        seedRows: [{ title: 'Saved article title', content: 'Saved article content' }],
      });
      created = true;
      for (const [language, label] of [['fi', 'Peruuta muutokset'], ['en', 'Cancel changes']]) {
        await page.evaluate(value => localStorage.setItem('chosen_language', value), language);
        await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
        await openTempDatasetRowArticle(page, dataset, 1);
        const article = page.locator('[data-testid="big-card-container"]:visible').first();
        await expect(article).toBeVisible();
        // Apply the override after the view exists, so startup cannot replace it.
        await page.evaluate(value => {
          document.body.classList.remove('light-mode', 'dark-mode', 'system-mode');
          document.body.classList.add(`${value}-mode`);
        }, theme);
        await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
        const edit = article.getByTestId('big-card-edit-button');
        const cancel = article.getByTestId('big-card-cancel-button');
        await edit.click();
        const title = article.locator('[data-column="title"]').first();
        const input = title.locator('input, textarea').first();
        await expect(input).toHaveValue('Saved article title');
        await input.fill(`Unsaved ${language} draft`);
        await expect(cancel).toBeVisible();
        await expect(cancel).toHaveText(label);
        await waitForVisiblePageReady(page);
        await page.screenshot({ path: testInfo.outputPath(`cancel-changes-${theme}-${language}.png`), fullPage: true });

        const writes: string[] = [];
        const recordWrite = (request: Request) => {
          if (request.method() === 'POST' && request.url().includes('/api/update-row')) writes.push(request.url());
        };
        page.on('request', recordWrite);
        try {
          await cancel.click();
          await expect(cancel).toBeHidden();
          await expect(title).toContainText('Saved article title');
          await edit.click();
          await expect(title.locator('input, textarea').first()).toHaveValue('Saved article title');
          await cancel.click();
          expect(writes).toEqual([]);
        } finally {
          page.off('request', recordWrite);
        }
      }
    } finally {
      try {
        if (created) await dropTempDataset(page, dataset);
      } finally {
        await page.evaluate(value => {
          if (value === null) localStorage.removeItem('chosen_language');
          else localStorage.setItem('chosen_language', value);
        }, originalLanguage);
      }
    }
  });
}
