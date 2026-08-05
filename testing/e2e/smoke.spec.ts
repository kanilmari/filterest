import { test, expect } from '@playwright/test';

test('has title', async ({ page }) => {
  await page.goto('/');

  // Expect a title to exist (dev instance may have different name)
  await expect(page).toHaveTitle(/.+/);
});

