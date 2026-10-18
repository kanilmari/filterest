// C25_rich_text_links.spec.ts
// Proves rich-text and plain URLs remain clickable in native cards and articles.
// Connects API-owned dataset fixtures, the shared renderer and native link navigation.
// Cleans its own dataset even on failure and never changes site appearance settings.
import { expect, test } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import {
  buildTempDatasetName, createTempDataset, cleanupDatasetViaRequest, openTempDatasetRowArticle,
} from '../helpers/temp-dataset';

const richHref = 'https://rich-text.example.test/?utm_source=a&utm_medium=b#frag';
const plainHref = 'https://plain-url.example.test/story';
const richLabel = 'Lue lisää / Read more';
const unsafeLabel = 'Vaarallinen linkki / Unsafe link';

for (const theme of ['light', 'dark'] as const) {
  test(`WO40 rich-text links preserve safe hrefs in ${theme}`, async ({ page, context }) => {
    test.setTimeout(120_000);
    await login(page, loadCredentials());
    const dataset = buildTempDatasetName('e2e_wo40_rich_links');
    let created = false;
    // The external click proof stays inside this browser fixture.
    await context.route(/^https:\/\/(?:rich-text|plain-url)\.example\.test\//, route =>
      route.fulfill({ contentType: 'text/html', body: '<p>Link opened</p>' }));
    try {
      await createTempDataset(page, {
        datasetName: dataset,
        columns: { id: 'SERIAL', title: 'TEXT', content: 'TEXT' },
        seedRows: [{
          title: 'WO40 — Linkit / Links',
          content: `<p><a href="${richHref}" target="_self" rel="opener" onclick="alert(278)" class="source">${richLabel}</a>`
            + ` ja ${plainHref} <a href="javascript:alert(278)">${unsafeLabel}</a></p>`,
        }],
      });
      created = true;
      // API fixtures must be followed by a reload before opening their view.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openTempDatasetRowArticle(page, dataset, 1);
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      // Page-local theme only; no palette, Home or text-style settings are saved.
      await page.evaluate(value => {
        document.body.classList.remove('light-mode', 'dark-mode', 'system-mode');
        document.body.classList.add(`${value}-mode`);
      }, theme);
      await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));

      const article = page.locator('[data-testid="big-card-container"]:visible').first();
      const value = article.locator('.two_line_value[data-column="content"]');
      await expect(value).toBeVisible();
      const richLink = value.getByRole('link', { name: richLabel, exact: true });
      const plainLink = value.getByRole('link', { name: plainHref, exact: true });
      await expect(value.locator('a')).toHaveCount(2);
      await expect(value.locator('a a')).toHaveCount(0);
      await expect(value).toContainText(unsafeLabel);
      await expect(value.getByRole('link', { name: unsafeLabel, exact: true })).toHaveCount(0);
      await expect(value.locator('[onclick], .source')).toHaveCount(0);

      const articleURL = page.url();
      for (const [link, href] of [[richLink, richHref], [plainLink, plainHref]] as const) {
        await expect(link).toHaveAttribute('href', href);
        await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        await expect(link).toHaveAttribute('target', '_blank');
        const popupPromise = page.waitForEvent('popup');
        await link.click();
        const popup = await popupPromise;
        try {
          await popup.waitForLoadState('domcontentloaded');
          await expect(popup).toHaveURL(href);
          expect(await popup.evaluate(() => window.opener === null)).toBe(true);
          await expect(page).toHaveURL(articleURL);
        } finally {
          await popup.close();
        }
      }
    } finally {
      if (created) await cleanupDatasetViaRequest(page.request, dataset);
    }
  });
}
