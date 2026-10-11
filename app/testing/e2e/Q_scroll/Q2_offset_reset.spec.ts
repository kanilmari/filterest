// Q2_offset_reset.spec.ts
// Proves fresh dataset/view origins and retained card-list returns.
// Connects real navigation commits to the visible dataset scroll host.
// Avoids reading the hidden source tab or letting setup helpers reset the proof.
import { test, expect } from '@playwright/test';
import { login } from '../helpers/auth';
import { navigateToDataset, waitForDataLoaded } from '../helpers/navigation';
import { switchToView, closeBigCard } from '../helpers/view-switch';

const DATASET = 'app_service_catalog';
const CARD_HOST = `#${DATASET}_card_view_container`;

test.describe('Q2 — Offset Reset', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await navigateToDataset(page, DATASET, { allowFallback: false });
    await waitForDataLoaded(page, DATASET);
  });

  test('offset resets when changing table', async ({ page }) => {
    const source = page.locator(`#${DATASET}_container .scrollable_content:visible`);
    await expect(source).toHaveCount(1);
    await source.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => source.evaluate(element => element.scrollTop)).toBeGreaterThan(0);

    await navigateToDataset(page, 'system_users', { allowFallback: false });
    await waitForDataLoaded(page, 'system_users');
    const destination = page.locator('#system_users_container .scrollable_content:visible');
    await expect(destination).toHaveCount(1);
    await expect.poll(() => destination.evaluate(element => element.scrollTop)).toBe(0);
  });

  test('a newly committed view surface starts at the top', async ({ page }) => {
    await switchToView(page, 'card');
    const cards = page.locator(CARD_HOST);
    await cards.evaluate(element => { element.scrollTop = 600; });
    await expect.poll(() => cards.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    // switchToView deliberately scrolls before clicking; use the real buttons
    // directly here so that helper cannot satisfy the reset assertion itself.
    await page.locator(`#${DATASET}_filterBar_panel [data-testid="view-btn-table"]`)
      .dispatchEvent('click');
    await expect(page.locator(`#${DATASET}_table_view_container`)).toBeVisible();
    await page.locator(`#${DATASET}_filterBar_panel [data-testid="view-btn-card"]`)
      .dispatchEvent('click');
    await expect(cards).toBeVisible();
    await expect.poll(() => cards.evaluate(element => element.scrollTop)).toBe(0);
  });

  test('article close and history back/forward keep the mounted card viewport', async ({ page }) => {
    await switchToView(page, 'card');
    const cards = page.locator(CARD_HOST);
    const firstCard = cards.locator('.card[data-id]').first();
    await expect(firstCard).toBeVisible();
    await firstCard.evaluate(element => element.setAttribute('data-scroll-reset-proof', 'retained'));
    await cards.evaluate(element => { element.scrollTop = 600; });
    await expect.poll(() => cards.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const position = await cards.evaluate(element => element.scrollTop);
    // DOM activation preserves the viewport from which the article opens.
    await firstCard.locator('[data-testid="card-item-header"]').dispatchEvent('click');
    const article = page.locator('[data-testid="big-card-container"]:visible');
    await expect(article).toBeVisible();
    // Phones hide the article close controls, so use their browser navigation.
    // Tablet/desktop projects must still exercise the visible close button.
    if ((page.viewportSize()?.width || 0) <= 700) {
      await page.goBack();
    } else {
      await closeBigCard(page);
    }
    await expect(article).toHaveCount(0);
    await expect(cards).toBeVisible();
    await expect.poll(() => cards.evaluate(element => element.scrollTop)).toBeCloseTo(position, 0);
    await expect(firstCard).toHaveAttribute('data-scroll-reset-proof', 'retained');

    await page.goForward();
    await expect(article).toBeVisible();
    await page.goBack();
    await expect(cards).toBeVisible();
    await expect.poll(() => cards.evaluate(element => element.scrollTop)).toBeCloseTo(position, 0);
    await expect(firstCard).toHaveAttribute('data-scroll-reset-proof', 'retained');
  });
});
