// article-disclosures.ts
// Opens a now-closed article tool through its real accessible header.
// Existing media/related-row proofs explicitly request the tool they exercise.
import { expect, type Page } from '@playwright/test';

export async function openArticleDisclosure(page: Page, block: string) {
  const section = page.locator(`[data-article-disclosure-key="${block}"]:visible`).first();
  await expect(section).toBeVisible();
  if (await section.getAttribute('data-disclosure-state') !== 'expanded') {
    await section.locator(':scope > .row_article_disclosure_header').click();
  }
  await expect(section).toHaveAttribute('data-disclosure-state', 'expanded');
  return section;
}
