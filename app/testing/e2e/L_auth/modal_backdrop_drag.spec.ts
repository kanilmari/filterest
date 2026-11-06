// modal_backdrop_drag.spec.ts
// Proves login draft retention and ordinary backdrop dismissal with real browser gestures.
// Connects the guest login entry and its privacy dialog to the shared modal lifecycle.
// Prevents the login exception from disabling dismissal for other dialogs.
import { expect, test } from '@playwright/test';
import { openLoginEntry } from '../helpers/auth';

test.use({ storageState: { cookies: [], origins: [] } });

test('Login retains its draft after a selection drag and an intentional backdrop click', async ({ page }) => {
  await openLoginEntry(page);
  const overlay = page.locator('#custom_modal_overlay');
  const field = overlay.getByTestId('login-username');
  const draft = 'Select and keep this text';
  await field.fill(draft);
  await field.scrollIntoViewIfNeeded();
  const points = await field.evaluate(input => {
    const rect = input.getBoundingClientRect();
    const y = rect.top + rect.height / 2;
    const target = input.closest('#custom_modal_overlay');
    // Match the gesture to an exposed point on the actual overlay.
    for (const x of [innerWidth - 1, innerWidth - 4, innerWidth - 14, innerWidth - 32]) {
      if (document.elementFromPoint(x, y) === target) {
        return { start: rect.left + parseFloat(getComputedStyle(input).paddingLeft) + 3, end: x, y };
      }
    }
    throw new Error('Expected an exposed backdrop to the right of the field');
  });
  await page.mouse.move(points.start, points.y);
  await page.mouse.down();
  await page.mouse.move(points.end, points.y, { steps: 15 });
  await page.mouse.up();
  await expect(overlay).toBeVisible();
  await expect(field).toHaveValue(draft);
  await expect.poll(() => field.evaluate((input: HTMLInputElement) =>
    (input.selectionEnd ?? 0) - (input.selectionStart ?? 0))).toBeGreaterThan(0);

  await page.mouse.click(points.end, points.y);
  await expect(overlay).toBeVisible();
  await expect(field).toHaveValue(draft);
  await overlay.locator('.modal_close_button').click();
  await expect(overlay).toBeHidden();
});

test('An ordinary privacy dialog still closes from a genuine backdrop click', async ({ page }) => {
  await openLoginEntry(page);
  const overlay = page.locator('#custom_modal_overlay');
  const field = overlay.getByTestId('login-username');
  await expect(field).toBeVisible();
  await overlay.locator('#privacy-notice-link').click();
  await expect(field).toHaveCount(0);
  await expect(overlay).toBeVisible();
  const point = await overlay.evaluate(element => {
    for (const [x, y] of [[1, innerHeight / 2], [innerWidth - 1, innerHeight / 2], [innerWidth / 2, 1]]) {
      if (document.elementFromPoint(x, y) === element) return { x, y };
    }
    throw new Error('Expected an exposed backdrop around the privacy dialog');
  });
  await page.mouse.click(point.x, point.y);
  await expect(overlay).toBeHidden();
});
