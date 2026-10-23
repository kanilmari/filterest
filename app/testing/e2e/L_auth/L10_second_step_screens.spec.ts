// L10_second_step_screens.spec.ts
// Proves sign-in code copy, attributes, errors and theme boundaries without account writes.
// Connects the real signed-out login entry to browser-fulfilled verification responses.
// Exists so the shared second step can be checked without signing in or sending email.
import { expect, test, type Page } from '@playwright/test';

const FACTORS = {
  fixed_pin: {
    heading: ['Vahvista kirjautuminen', 'Confirm sign-in'],
    instruction: ['Syötä kirjautumista varten määrittämäsi PIN-koodi.', 'Enter the PIN you set up for sign-in.'],
    label: ['PIN-koodi', 'PIN'], value: '0123', type: 'password', mode: 'numeric', auto: 'off', min: '4', pattern: '[0-9]{4,8}',
  },
  totp: {
    heading: ['Vahvista kirjautuminen', 'Confirm sign-in'],
    instruction: ['Syötä todennussovelluksen nykyinen vahvistuskoodi.', 'Enter the current verification code from your authenticator app.'],
    label: ['Vahvistuskoodi', 'Verification code'], value: '012345', type: 'text', mode: 'numeric', auto: 'one-time-code', min: '6', pattern: '[0-9]{6}',
  },
  email: {
    heading: ['Vahvista kirjautuminen', 'Confirm sign-in'],
    instruction: ['Syötä sähköpostiisi lähetetty vahvistuskoodi.', 'Enter the verification code sent to your email.'],
    label: ['Vahvistuskoodi', 'Verification code'], value: 'abc234def', type: 'text', mode: 'text', auto: 'one-time-code', min: '9', pattern: '[A-Za-z0-9]{9}',
  },
  recovery: {
    heading: ['Vaihda salasana', 'Reset your password'],
    // Preserve the existing non-enumeration sentence, rather than the design fixture's revision.
    instruction: ['Jos tili löytyy, yritämme lähettää palautuskoodin. Voit pyytää uuden koodin.', 'If the account exists, we will try to send a recovery code. You can request a new code.'],
    label: ['Palautuskoodi', 'Recovery code'], value: 'abc234def', type: 'text', mode: 'text', auto: 'one-time-code', min: '9', pattern: '[A-Za-z0-9]{9}',
  },
} as const;
type Factor = keyof typeof FACTORS;

async function guardRequests(page: Page, factor: Factor) {
  let loginRequests = 0;
  await page.route('**/*', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === 'GET') return route.continue();
    if (request.method() === 'POST') {
      if (pathname === '/api/login' && factor !== 'recovery') {
        loginRequests++;
        if (loginRequests === 1) return route.fulfill({ json: {
          otp_required: true, verification_method: factor, masked_email: 'a•••@example.com',
        } });
        return route.fulfill({ status: 401, json: { error: 'wrong_otp', attempts_remaining: 2 } });
      }
      if (pathname === '/api/request-password-reset-otp') return route.fulfill({ json: { ok: true } });
      if (pathname === '/api/reset-password') return route.fulfill({ status: 401, json: { error: 'wrong_otp', attempts_remaining: 2 } });
    }
    return route.abort('blockedbyclient');
  });
}

for (const language of ['fi', 'en'] as const) test.describe(`second step ${language}`, () => {
  test.use({ storageState: { cookies: [], origins: [] }, locale: language === 'fi' ? 'fi-FI' : 'en-US' });
  for (const theme of ['light', 'dark'] as const) {
    for (const factor of Object.keys(FACTORS) as Factor[]) test(`${factor}, ${theme}: copy, format, actions, error and input border`, async ({ page }) => {
      const copy = FACTORS[factor];
      const index = language === 'fi' ? 0 : 1;
      // Every chosen application theme is tested against the opposite OS preference.
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await page.addInitScript(({ language, theme }) => {
        localStorage.setItem('chosen_language', language);
        localStorage.setItem('theme', theme);
      }, { language, theme });
      await guardRequests(page, factor);
      // Added last so this GET fixture takes precedence over the non-GET guard.
      await page.route('**/api/user-visual-preference', async route => {
        if (route.request().method() !== 'GET') return route.abort('blockedbyclient');
        return route.fulfill({ json: { theme_mode: theme, revision: 1, configured: true } });
      });
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('login-username')).toBeVisible();
      await page.getByTestId('login-username').fill('second-step-fixture');
      if (factor === 'recovery') {
        await page.getByTestId('login-forgot-password').click();
      } else {
        await page.getByTestId('login-password').fill('fixture-not-an-account');
        const privacy = page.getByTestId('login-privacy-accept');
        if (await privacy.isVisible() && !await privacy.isChecked()) await privacy.check();
      }
      await page.getByTestId('login-submit').click();
      const root = page.getByTestId(factor === 'recovery' ? 'login-password-reset-section' : 'login-otp-section');
      const input = root.locator('[data-verify="input"]');
      await expect(root).toBeVisible();
      await expect(page.locator('body')).toHaveClass(new RegExp(`${theme}-mode`));
      await expect(root.locator('[data-verify="heading"]')).toHaveText(copy.heading[index]);
      await expect(root.locator('[data-verify="instruction"]')).toHaveText(copy.instruction[index]);
      await expect(root.locator('[data-verify="label"]')).toHaveText(copy.label[index]);
      expect(await root.innerText()).not.toMatch(/\bOTP\b|\bOtp\b/);
      for (const [attribute, value] of Object.entries({ type: copy.type, inputmode: copy.mode, autocomplete: copy.auto, minlength: copy.min, maxlength: '32', pattern: copy.pattern })) {
        await expect(input).toHaveAttribute(attribute, value);
      }
      if (factor === 'email' || factor === 'recovery') {
        for (const [attribute, value] of Object.entries({ autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' })) await expect(input).toHaveAttribute(attribute, value);
      }
      await expect(page.getByTestId('login-forgot-password')).toBeHidden();
      await expect(page.getByTestId('login-back-to-login')).toBeVisible();
      const resend = root.locator('[data-verify="resend"]');
      if (factor === 'email' || factor === 'recovery') await expect(resend).toBeVisible();
      else await expect(resend).toBeHidden();
      await input.evaluate(node => node.blur());
      const border = await input.evaluate(node => {
        const style = getComputedStyle(node);
        return { width: parseFloat(style.borderTopWidth), style: style.borderTopStyle, color: style.borderTopColor };
      });
      expect(border.width).toBeGreaterThan(0);
      expect(border.style).not.toBe('none');
      expect(border.color).not.toMatch(/transparent|rgba\([^)]*,\s*0\s*\)/);
      await input.fill(copy.value);
      if (factor === 'recovery') await page.getByTestId('login-password-reset-new-password').fill('  fixture-new-value  ');
      await page.getByTestId('login-submit').click();
      const error = root.locator('[data-verify="error"]');
      await expect(error).not.toBeEmpty();
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(error).toHaveAttribute('role', 'status');
      await expect(error).toHaveAttribute('aria-live', 'polite');
      const inputBox = await input.boundingBox();
      const errorBox = await error.boundingBox();
      expect(errorBox!.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height);
      const hintId = await root.locator('[data-verify="hint"]').getAttribute('id');
      const errorId = await error.getAttribute('id');
      await expect(input).toHaveAttribute('aria-describedby', `${hintId} ${errorId}`);
      await expect(root.locator('[data-verify="attempts"]')).toHaveText(language === 'fi' ? 'Yrityksiä jäljellä: 2.' : 'Attempts remaining: 2.');
    });
  }
});
