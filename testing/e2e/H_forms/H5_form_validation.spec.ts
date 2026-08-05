/**
 * H5_form_validation.spec.ts
 *
 * Verifies add-row form validation on empty submit.
 */

import { test, expect } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';
import { navigateToDataset, openAddRowForm, waitForDataLoaded } from '../helpers/navigation';

test.describe('H5 — Form Validation', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
  });

  test('form shows validation errors on empty submit', async ({ page }) => {
    await navigateToDataset(page, 'app_service_catalog');
    await waitForDataLoaded(page, 'app_service_catalog');

    await openAddRowForm(page);

    const form = page.locator('[data-testid="add-row-form"]');
    await expect(form.first()).toBeVisible({ timeout: 10000 });

    const detailsSection = form.first().locator(':scope > section[data-section-key="details"]');
    const requiredField = detailsSection.locator('input[required], select[required], textarea[required]').first();
    test.skip(await requiredField.count() === 0, 'Dataset has no required base field to validate.');

    await requiredField.evaluate((field) => {
      if (field instanceof HTMLInputElement && field.type === 'checkbox') {
        field.checked = false;
      } else if (
        field instanceof HTMLInputElement
        || field instanceof HTMLSelectElement
        || field instanceof HTMLTextAreaElement
      ) {
        field.value = '';
      }
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(requiredField).not.toBeValid();

    const nextBtn = form.first().locator('[data-form-section-footer-direction="next"]');
    const submitBtn = form.first().locator('[data-testid="btn-add-row-submit"]');
    if (await nextBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await nextBtn.first().click();
      await expect(detailsSection).toBeVisible();
      await expect(
        form.first().locator('button[data-form-section-target="details"]'),
      ).toHaveAttribute('aria-current', 'step');
      await expect(submitBtn).toBeHidden();
    } else if (await submitBtn.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await submitBtn.first().click();
      await expect(form.first()).toBeVisible();
      await expect(requiredField).not.toBeValid();
    } else {
      throw new Error('The add-row form exposed neither Next nor Add.');
    }

    await page.keyboard.press('Escape');
  });
});
