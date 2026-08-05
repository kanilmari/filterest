/**
 * K1_toast.spec.ts
 *
 * End-to-end coverage for the toast notification system.
 * Verifies toast rendering, stacking, i18n langKey behavior, and timed auto-dismiss logic.
 */

import { test, expect, type Page } from '@playwright/test';
import { login, loadCredentials, type TestCredentials } from '../helpers/auth';

type ToastInvocationOptions = {
  message?: string;
  langKey?: string;
  level?: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
};

async function waitForToastTimingStability(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.body.classList.contains('loading'), { timeout: 15000 }).catch(() => {});

  const measureTimerDrift = async () => page.evaluate(async () => {
    const start = performance.now();
    await new Promise((resolve) => window.setTimeout(resolve, 100));
    return performance.now() - start;
  });

  await expect.poll(measureTimerDrift, { timeout: 15000 }).toBeLessThan(250);
  await expect.poll(measureTimerDrift, { timeout: 15000 }).toBeLessThan(250);
}

async function triggerToast(page: Page, toastOptions: ToastInvocationOptions): Promise<void> {
  await page.evaluate(async (options) => {
    const toastModule = await import('/frontend/reusable_components/notifications/toast_notification_printer.js');
    toastModule.showToast(options);
  }, toastOptions);
}

test.describe('Toast Notification System', () => {
  let credentials: TestCredentials;

  test.beforeAll(() => {
    credentials = loadCredentials();
  });

  test.beforeEach(async ({ page }) => {
    await login(page, credentials);
    // Timer-based toast assertions need the SPA shell to stop starving the
    // main thread, otherwise auto-dismiss callbacks fire seconds late.
    await waitForToastTimingStability(page);
  });

  test('showToast displays a success message', async ({ page }) => {
    const successMessage = `toast-success-${Date.now()}`;

    await triggerToast(page, {
      message: successMessage,
      level: 'success',
      duration: 1200,
    });

    const toastContainer = page.locator('[data-testid="toast-container"], #toast-notification-container');
    const successToast = page.locator('[data-testid="toast"]', { hasText: successMessage });

    await expect(toastContainer).toBeVisible();
    await expect(successToast).toBeVisible();
    await expect(successToast).toHaveClass(/toast-notification-item/);
    await expect(successToast).toHaveAttribute('data-toast-level', 'success');

    // The toast duration is still 1200ms, but desktop-shell bootstrap can
    // delay JavaScript timers by several seconds immediately after login.
    await expect(successToast).toBeHidden({ timeout: 10000 });
  });

  test('multiple toasts stack vertically', async ({ page }) => {
    const stackedToastMessages = [
      `toast-stack-1-${Date.now()}`,
      `toast-stack-2-${Date.now()}`,
      `toast-stack-3-${Date.now()}`,
    ];

    await page.evaluate(async (messages) => {
      const toastModule = await import('/frontend/reusable_components/notifications/toast_notification_printer.js');
      toastModule.showToast({ message: messages[0], level: 'info', duration: 6000 });
      toastModule.showToast({ message: messages[1], level: 'warning', duration: 6000 });
      toastModule.showToast({ message: messages[2], level: 'success', duration: 6000 });
    }, stackedToastMessages);

    const stackedToasts = page.locator('[data-testid="toast-container"] [data-testid="toast"], #toast-notification-container .toast-notification-item');
    await expect(stackedToasts).toHaveCount(3);

    for (const message of stackedToastMessages) {
      await expect(page.locator('[data-testid="toast"]', { hasText: message })).toBeVisible();
    }

    const toastTopPositions = await stackedToasts.evaluateAll((elements) =>
      elements.map((element) => Math.round(element.getBoundingClientRect().top)),
    );

    expect(new Set(toastTopPositions).size).toBe(3);
    const sortedTopPositions = [...toastTopPositions].sort((first, second) => first - second);
    expect(sortedTopPositions[0]).toBeLessThan(sortedTopPositions[1]);
    expect(sortedTopPositions[1]).toBeLessThan(sortedTopPositions[2]);
  });

  test('toast with langKey gets translated', async ({ page }) => {
    const translationExpectation = await page.evaluate(async () => {
      const activeLanguage =
        document.documentElement.lang ||
        localStorage.getItem('chosen_language') ||
        (navigator.language || 'en').slice(0, 2);

      const response = await fetch(`/api/translations?lang=${encodeURIComponent(activeLanguage)}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch translations for "${activeLanguage}": ${response.status}`);
      }

      const payload = await response.json();
      const translationMap =
        payload &&
        typeof payload === 'object' &&
        payload.translations &&
        typeof payload.translations === 'object'
          ? payload.translations
          : payload;

      const preferredKeys = [
        'view_table',
        'view_card',
        'add_more_views',
        'login',
        'access_denied_for_action',
        'cancel',
        'results',
      ];
      const selectedKey =
        preferredKeys.find((key) => {
          const value = translationMap?.[key];
          return typeof value === 'string' && value.trim().length > 0 && value.trim() !== key;
        }) ??
        Object.keys(translationMap ?? {}).find((key) => {
          const value = translationMap?.[key];
          return (
            /^[a-z][a-z0-9_]*$/i.test(key) &&
            typeof value === 'string' &&
            value.trim().length > 0 &&
            value.trim() !== key &&
            !/[<>]/.test(value)
          );
        });

      if (!selectedKey) {
        throw new Error(`No stable translated langKey was available for "${activeLanguage}".`);
      }

      const expectedText = translationMap[selectedKey].trim();

      return { selectedKey, expectedText };
    });

    await triggerToast(page, {
      langKey: translationExpectation.selectedKey,
      level: 'info',
      duration: 10000,
    });

    const translatedToast = page.locator(
      `[data-testid="toast"] .toast-notification-text` +
      `[data-lang-key=${JSON.stringify(translationExpectation.selectedKey)}]`,
    );

    await expect(translatedToast).toHaveCount(1);
    await expect(translatedToast).toBeVisible({ timeout: 5000 });
    await expect(translatedToast).toHaveText(translationExpectation.expectedText, { timeout: 5000 });
  });

  test('error toast persists longer than success toast', async ({ page }) => {
    const successMessage = `toast-duration-success-${Date.now()}`;
    const errorMessage = `toast-duration-error-${Date.now()}`;

    await page.evaluate(async ({ successMessage: successText, errorMessage: errorText }) => {
      const toastModule = await import('/frontend/reusable_components/notifications/toast_notification_printer.js');
      toastModule.showToast({ message: successText, level: 'success', duration: 5000 });
      toastModule.showToast({ message: errorText, level: 'error', duration: 10000 });
    }, { successMessage, errorMessage });

    const successToast = page.locator('[data-testid="toast"]', { hasText: successMessage });
    const errorToast = page.locator('[data-testid="toast"]', { hasText: errorMessage });

    await expect(successToast).toBeVisible();
    await expect(errorToast).toBeVisible();

    await page.waitForTimeout(6200);

    await expect(successToast).toBeHidden();
    await expect(errorToast).toBeVisible();
  });
});
