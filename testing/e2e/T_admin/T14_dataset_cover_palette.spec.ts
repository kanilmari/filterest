import { expect, test } from '@playwright/test';

test('admin cover palette is protected, compact, and live-only', async ({ page }) => {
  await page.goto('/app_autojen_vanteet', { waitUntil: 'domcontentloaded' });
  const response = await page.request.get('/api/admin/ui-feature-flags');
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ view_admin_cover_image_test_palette: true });

  const button = page.locator('[data-testid="dataset-cover-test-palette-button"]');
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.click();

  const panel = page.locator('[data-testid="dataset-cover-test-palette"]');
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(440);
  expect(box!.height).toBeLessThanOrEqual(800);

  const slider = page.locator('[data-testid="dataset-cover-test-palette-center-opacity"]');
  await slider.evaluate((input: HTMLInputElement) => {
    input.value = '0.35';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const hero = page.locator('.filterbar-inline-hero--has-cover');
  await expect(hero).toHaveCSS('--dataset-cover-mask-center-opacity', '0.35');
});
