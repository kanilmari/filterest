// L11_verification_setup_screens.spec.ts
// Proves profile code and administrator PIN fields without changing an account.
// Connects the shared authenticated E2E session to fulfilled requests and actual rendered fields.
// Every non-GET request is fulfilled or aborted; no profile, factor or email write reaches the server.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { expandAdminTreeFolder, openAdminTreeButton } from '../helpers/admin-navigation';
import { waitForAppReady } from '../helpers/navigation';

test.use({ serviceWorkers: 'block' });
const ACCOUNT = '[data-testid="navbar-auth-user"], [data-testid="tab-user"]';
const copy = {
  fi: {
    label: 'Vahvistuskoodi', hint: '9 kirjainta tai numeroa. Voit liittää koko koodin välilyönteineen.',
    empty: 'Syötä vahvistuskoodi.', invalid: 'Vahvistuskoodi ei kelpaa tai on vanhentunut. Tarkista koodi tai pyydä uusi.',
    resend: 'Pyydä uusi koodi', pin: 'PIN-koodi', confirm: 'Vahvista PIN-koodi',
    pinHint: '4–8 numeroa. Vahvista sama PIN-koodi alla.', confirmHint: 'Syötä valitsemasi PIN-koodi uudelleen.',
    mismatch: 'PIN-koodit eivät täsmää.', format: 'PIN-koodissa pitää olla 4–8 numeroa.', show: 'Näytä PIN-koodi', hide: 'Piilota PIN-koodi',
    emailHeading: 'Vahvista uusi sähköpostiosoite', passwordHeading: 'Vahvista salasanan vaihto',
  },
  en: {
    label: 'Verification code', hint: '9 letters or numbers. You can paste the whole code, including spaces.',
    empty: 'Enter the verification code.', invalid: 'The verification code is not valid or has expired. Check it or request a new one.',
    resend: 'Request a new code', pin: 'PIN', confirm: 'Confirm PIN',
    pinHint: '4–8 digits. Confirm the same PIN below.', confirmHint: 'Enter your chosen PIN again.',
    mismatch: 'The PIN entries do not match.', format: 'The PIN must contain 4–8 digits.', show: 'Show PIN', hide: 'Hide PIN',
    emailHeading: 'Confirm your new email address', passwordHeading: 'Confirm your password change',
  },
};

async function visibleBorder(input: Locator) {
  await input.evaluate(node => node.blur());
  const border = await input.evaluate(node => {
    const style = getComputedStyle(node);
    return { width: parseFloat(style.borderTopWidth), style: style.borderTopStyle, color: style.borderTopColor, background: style.backgroundColor };
  });
  expect(border.width).toBeGreaterThan(0); expect(border.style).not.toBe('none');
  expect(border.color).not.toMatch(/transparent|rgba\([^)]*,\s*0\s*\)/);
  expect(border.color).not.toBe(border.background);
}
async function associatedField(page: Page, input: Locator, label: string, hint: string) {
  const id = await input.getAttribute('id');
  await expect(page.locator(`label[for="${id}"]`)).toHaveText(label);
  const ids = (await input.getAttribute('aria-describedby'))!.split(' ');
  await expect(page.locator(`[id="${ids[0]}"]`)).toHaveText(hint);
  const error = page.locator(`[id="${ids[1]}"]`);
  await expect(error).toHaveAttribute('role', 'status'); await expect(error).toHaveAttribute('aria-live', 'polite');
  await visibleBorder(input);
  return error;
}
async function errorBelow(input: Locator, error: Locator, text: string | RegExp) {
  await expect(input).toHaveAttribute('aria-invalid', 'true'); await expect(error).toHaveText(text);
  const inputBox = await input.boundingBox(); const errorBox = await error.boundingBox();
  expect(errorBox!.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height);
}

for (const language of ['fi', 'en'] as const) for (const theme of ['light', 'dark'] as const) {
  test.describe(`verification setup ${language}/${theme}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
      await page.addInitScript(({ language, theme }) => {
        localStorage.setItem('chosen_language', language); localStorage.setItem('theme', theme);
      }, { language, theme });
    });
    test('profile: both recipients, code attributes, resend and four inline errors', async ({ page, context }) => {
      let profileError = 'email_otp_required'; let sends = 0; let submits = 0;
      await context.route('**/*', async route => {
        const request = route.request(); const pathname = new URL(request.url()).pathname;
        if (request.method() === 'GET') {
          if (pathname === '/api/user-visual-preference') return route.fulfill({ json: { theme_mode: theme, revision: 1, configured: true } });
          return route.continue();
        }
        if (request.method() === 'POST') {
          if (pathname === '/api/request-email-change-otp' || pathname === '/api/request-password-change-otp') {
            sends++;
            return route.fulfill({ json: { masked_email: pathname.includes('email-change') ? 'n•••@example.invalid' : 'c•••@example.invalid' } });
          }
          if (pathname === '/api/update-profile') { submits++; return route.fulfill({ status: 400, json: { error: profileError } }); }
        }
        return route.abort('blockedbyclient');
      });
      await page.goto('/', { waitUntil: 'domcontentloaded' }); await waitForAppReady(page);
      // Uses global setup's reserved authenticated E2E identity. No login fallback may send a POST here.
      const profile = await page.request.get('/api/user-profile'); expect(profile.ok()).toBe(true);
      expect((await profile.json()).user_id).toBeGreaterThan(1);
      await page.locator(ACCOUNT).first().waitFor({ state: 'attached' });
      await page.locator(ACCOUNT).first().evaluate((node: HTMLElement) => node.click());
      await expect(page.locator('#edit_email')).toBeVisible();
      await expect(page.locator('body')).toHaveClass(new RegExp(`${theme}-mode`));
      // Profile fields start read-only and unlock on their first focus (createLabeledInput in user_profile_printer.js,
      // against browser autofill), so focus each field before filling it, as a person's click or Tab does.
      const type = async (selector: string, value: string) => {
        const field = page.locator(selector); await field.focus(); await expect(field).toBeEditable(); await field.fill(value);
      };
      for (const kind of ['email', 'password'] as const) {
        if (kind === 'email') {
          await type('#edit_email', 'new@example.invalid'); await type('#confirm_email', 'new@example.invalid');
        } else {
          await type('#current_password', 'fixture-current-value');
          await type('#new_password', 'fixture-replacement-value'); await type('#confirm_password', 'fixture-replacement-value');
        }
        const send = page.locator(`#${kind}_otp_send_btn`);
        await send.click();
        if (kind === 'email') {
          await page.getByTestId('input-modal-input').fill('fixture-current-value'); await page.getByTestId('input-modal-confirm-button').click();
        }
        const input = page.locator(`#${kind}_otp`); await expect(input).toBeVisible();
        const error = await associatedField(page, input, copy[language].label, copy[language].hint);
        const root = input.locator('xpath=ancestor::*[contains(@class,"auth-verify--embedded")][1]');
        await expect(root.locator('[data-verify="heading"]')).toHaveText(kind === 'email' ? copy[language].emailHeading : copy[language].passwordHeading);
        await expect(root.locator('bdi')).toHaveText(kind === 'email' ? 'n•••@example.invalid' : 'c•••@example.invalid');
        for (const [attr, value] of Object.entries({ type: 'text', inputmode: 'text', autocomplete: 'one-time-code', minlength: '9', maxlength: '32', pattern: '[A-Za-z0-9]{9}', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' })) await expect(input).toHaveAttribute(attr, value);
        await expect(send).toHaveText(copy[language].resend);
        const submit = page.locator(kind === 'email' ? '#user_profile_form button[type="submit"]' : '#user_password_form button[type="submit"]');
        for (const state of ['required', 'invalid']) {
          profileError = `${kind}_otp_${state}`;
          await input.fill(state === 'required' ? '' : 'abc234def'); await submit.click();
          await errorBelow(input, error, state === 'required' ? copy[language].empty : copy[language].invalid);
        }
      }
      expect(sends).toBe(2); expect(submits).toBe(4);
    });
    test('admin: PIN hints, reveal and field errors without saving', async ({ page, context }) => {
      let adminPosts = 0;
      await context.route('**/*', async route => {
        const request = route.request(); const pathname = new URL(request.url()).pathname;
        if (request.method() !== 'GET') {
          if (pathname === '/api/admin/user-authentication') adminPosts++;
          return route.abort('blockedbyclient');
        }
        if (pathname === '/api/user-visual-preference') return route.fulfill({ json: { theme_mode: theme, revision: 1, configured: true } });
        if (pathname === '/api/admin/user-authentication') return route.fulfill({ json: { users: [{ user_id: 999999, username: 'fixture-only', enabled: false, admin_group_member: false, admin_access_allowed: false, verification_method: 'none' }] } });
        return route.continue();
      });
      await page.goto('/', { waitUntil: 'domcontentloaded' }); await waitForAppReady(page);
      await expandAdminTreeFolder(page, 'site_settings'); await openAdminTreeButton(page, 'user_authentication');
      await page.getByTestId('user-authentication-user').selectOption('999999');
      await page.getByTestId('verification-method-fixed_pin').check();
      await expect(page.locator('body')).toHaveClass(new RegExp(`${theme}-mode`));
      const pin = page.getByTestId('user-authentication-fixed-pin'); const confirm = page.getByTestId('user-authentication-fixed-pin-confirmation');
      const pinError = await associatedField(page, pin, copy[language].pin, copy[language].pinHint);
      const confirmError = await associatedField(page, confirm, copy[language].confirm, copy[language].confirmHint);
      for (const input of [pin, confirm]) {
        for (const [attr, value] of Object.entries({ type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', minlength: '4', maxlength: '8', pattern: '[0-9]{4,8}' })) await expect(input).toHaveAttribute(attr, value);
        const reveal = page.locator(`[aria-controls="${await input.getAttribute('id')}"]`);
        await expect(input).toHaveClass(/\bauth-verify__masked\b/);
        await expect.poll(() => input.evaluate(node => getComputedStyle(node).webkitTextSecurity)).toBe('disc');
        await expect(reveal).toHaveAttribute('aria-pressed', 'false');
        await expect(reveal).toHaveAccessibleName(copy[language].show); await reveal.click();
        await expect(input).toHaveAttribute('type', 'text'); await expect(reveal).toHaveAttribute('aria-pressed', 'true');
        await expect(input).not.toHaveClass(/\bauth-verify__masked\b/);
        await expect.poll(() => input.evaluate(node => getComputedStyle(node).webkitTextSecurity)).toBe('none');
        await expect(reveal).toHaveAccessibleName(copy[language].hide); await reveal.click();
        await expect(input).toHaveAttribute('type', 'text');
        await expect(input).toHaveClass(/\bauth-verify__masked\b/);
        await expect.poll(() => input.evaluate(node => getComputedStyle(node).webkitTextSecurity)).toBe('disc');
        await expect(reveal).toHaveAttribute('aria-pressed', 'false');
        await expect(reveal).toHaveAccessibleName(copy[language].show);
      }
      await pin.fill('12ab'); await confirm.fill('12ab'); await page.getByTestId('user-authentication-save').click();
      await errorBelow(pin, pinError, language === 'en' ? /^(?:The )?PIN must contain 4–8 digits\.$/ : copy[language].format);
      await pin.fill('0123'); await confirm.fill('0124'); await page.getByTestId('user-authentication-save').click();
      await errorBelow(confirm, confirmError, copy[language].mismatch);
      await expect(page.locator('[data-lang-key="user_authentication_activation_notice"]')).toBeVisible();
      await expect(page.getByTestId('user-authentication-save')).toHaveAttribute('data-lang-key', 'save_and_activate_admin');
      expect(adminPosts).toBe(0);
    });
  });
}
