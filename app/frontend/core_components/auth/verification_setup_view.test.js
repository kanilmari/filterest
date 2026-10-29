// verification_setup_view.test.js
// Exercises shared embedded descriptors and actual First Run/registration templates.
// Connects translated copy, server errors, PIN reveals and submitted form fields.
// Prevents setup UI changes from altering factor contracts or caller actions.
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, expect, test, vi } from 'vitest';
import { translatePage } from '../lang/translation_handler.js';
import { SECOND_STEP_FACTORS } from './second_step_factors.js';
import { mountEmbeddedSecondStep } from './second_step_view.js';
import { SECOND_STEP_TRANSLATION_FALLBACKS } from './second_step_translation_fallbacks.js';
import { VERIFICATION_SETUP_TRANSLATION_FALLBACKS } from './verification_setup_translation_fallbacks.js';
import { initializeFirstRunAdminPage } from './first_run_admin_page.js';
import { initializeRegistrationVerificationFields } from './register_page_builder.js';

vi.mock('./auth_preference_controls.js', () => ({ authPreferenceControlsReady: Promise.resolve() }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn().mockResolvedValue({}) }));
vi.mock('../table_views/dataset_value_localizer.js', () => ({ refreshLocalizedDatasetValues: vi.fn() }));
vi.mock('../lang/dev_lang_key_editor.js', () => ({ initDevLangKeyEditor: vi.fn() }));
const copy = { ...SECOND_STEP_TRANSLATION_FALLBACKS, ...VERIFICATION_SETUP_TRANSLATION_FALLBACKS };
beforeEach(async () => {
    document.body.innerHTML = '';
    window.translationPromises = { fi: Promise.resolve({}), en: Promise.resolve({}) };
    await translatePage('en');
});

function template(page, error = '') {
    // Only synthetic validation codes are substituted; enrollment key stays empty.
    const source = readFileSync(`frontend/templates/${page}.html`, 'utf8')
        .replace(/{{if \.FactorErr}}([\s\S]*?){{end}}/g, (_match, block) => error ? block : '')
        .replaceAll('{{.FactorErr}}', error).replaceAll('{{.VerificationErr}}', page === 'register' ? error : '')
        .replaceAll('{{.FormAction}}', '/register').replace(/{{[^}]*}}/g, '');
    document.body.innerHTML = source;
    const form = document.querySelector(page === 'register' ? '[data-testid="register-form"]' : '#first-run-admin-form');
    form.querySelectorAll('input[name="verification_method"]').forEach(input => { input.checked = input.value === 'fixed_pin'; });
    if (page === 'register') initializeRegistrationVerificationFields(document);
    else initializeFirstRunAdminPage(document);
    return form;
}

for (const factor of ['email_change', 'password_change', 'pin_setup', 'pin_confirmation', 'totp_setup']) {
    test(`${factor}: descriptor attributes, translated labels and aria`, async () => {
        const root = document.createElement('section'); document.body.append(root);
        const view = mountEmbeddedSecondStep(root, factor);
        const descriptor = SECOND_STEP_FACTORS[factor];
        for (const [name, value] of Object.entries(descriptor.attributes)) expect(view.input.getAttribute(name)).toBe(value);
        for (const lang of ['fi', 'en']) {
            await translatePage(lang);
            for (const slot of ['heading', 'instruction', 'label', 'hint']) {
                if (descriptor[slot]) expect(root.querySelector(`[data-verify="${slot}"]`).textContent).toBe(copy[descriptor[slot]][lang]);
            }
            expect(view.validate()).toBe(false);
            expect(root.querySelector('[data-verify="error"]').textContent).toBe(copy[descriptor.empty][lang]);
        }
        expect(root.querySelector('label').htmlFor).toBe(view.input.id);
        for (const id of view.input.getAttribute('aria-describedby').split(' ')) expect(document.getElementById(id)).not.toBeNull();
        expect(root.querySelector('[data-verify="error"]').getAttribute('role')).toBe('status');
    });
}
for (const page of ['first_run_admin', 'register']) {
    test.each(['fi', 'en'])(`${page}: PIN labels/hints/reveal, inactive fields and unchanged body (%s)`, async lang => {
        const form = template(page);
        await translatePage(lang);
        const pin = form.querySelector('#fixed_pin'); const confirm = form.querySelector('#confirm_fixed_pin');
        expect(form.querySelector('label[for="fixed_pin"]').textContent).toBe(copy.pin_setup_label[lang]);
        expect(form.querySelector('label[for="confirm_fixed_pin"]').textContent).toBe(copy.pin_setup_confirm_label[lang]);
        for (const [input, hint] of [[pin, 'pin_setup_hint'], [confirm, 'pin_confirm_hint']]) {
            expect(input.type).toBe('text');
            expect(input.inputMode).toBe('numeric');
            expect(input.autocomplete).toBe('one-time-code');
            expect(input.classList.contains('auth-verify__masked')).toBe(true);
            const ids = input.getAttribute('aria-describedby').split(' ');
            expect(document.getElementById(ids[0]).textContent).toBe(copy[hint][lang]);
            const reveal = form.querySelector(`[aria-controls="${input.id}"]`);
            expect(reveal.getAttribute('aria-label')).toBe(copy.show_pin[lang]);
            expect(reveal.getAttribute('aria-pressed')).toBe('false');
            reveal.click(); expect(input.type).toBe('text');
            expect(input.classList.contains('auth-verify__masked')).toBe(false);
            expect(reveal.getAttribute('aria-pressed')).toBe('true');
            expect(reveal.getAttribute('aria-label')).toBe(copy.hide_pin[lang]);
            reveal.click(); expect(input.type).toBe('text');
            expect(input.classList.contains('auth-verify__masked')).toBe(true);
            expect(reveal.getAttribute('aria-pressed')).toBe('false');
            expect(reveal.getAttribute('aria-label')).toBe(copy.show_pin[lang]);
        }
        for (const input of form.querySelectorAll('input[autocomplete="new-password"]')) expect(input.type).toBe('password');
        pin.value = '0123'; confirm.value = '0123';
        const body = new FormData(form);
        expect(body.get('fixed_pin')).toBe('0123'); expect(body.get('confirm_fixed_pin')).toBe('0123');
        expect(form.getAttribute('method')).toBe('POST');
        expect(form.getAttribute('action')).toBe(page === 'register' ? '/register' : '/first-run');
        expect(form.querySelector('[type="submit"]').dataset.langKey).toBe(page === 'register' ? 'register' : 'first_run_admin_submit');
        const none = form.querySelector('input[name="verification_method"][value="none"]');
        none.checked = true; none.dispatchEvent(new Event('change', { bubbles: true }));
        const group = pin.closest('[data-pin-setup]');
        expect(group.hidden).toBe(true); expect(group.hasAttribute('inert')).toBe(true);
        expect([...group.querySelectorAll('input, button')].every(control => control.disabled)).toBe(true);
        expect(new FormData(form).has('fixed_pin')).toBe(false);
    });
    test.each(['first_run_fixed_pin_invalid', 'first_run_fixed_pin_mismatch'])(`${page}: server %s is below its field`, async code => {
        const form = template(page, code); await translatePage('fi');
        const input = form.querySelector(code.endsWith('mismatch') ? '#confirm_fixed_pin' : '#fixed_pin');
        const error = document.getElementById(input.getAttribute('aria-describedby').split(' ')[1]);
        expect(error.dataset.langKey).toBe(code); expect(error.textContent).toBe(copy[code].fi);
        expect(input.getAttribute('aria-invalid')).toBe('true');
        expect(input.closest('.auth-verify__field').lastElementChild).toBe(error);
        expect(form.querySelector('[data-factor-error]')).toBeNull();
        if (page === 'first_run_admin') expect(form.querySelectorAll(`[data-lang-key="${code}"]`)).toHaveLength(1);
        await translatePage('en'); expect(error.textContent).toBe(copy[code].en);
    });
    test(`${page}: mismatched PIN submission stays in the form with the server's error key`, () => {
        const form = template(page);
        form.querySelector('#fixed_pin').value = '0123'; form.querySelector('#confirm_fixed_pin').value = '0124';
        const submit = new Event('submit', { bubbles: true, cancelable: true }); form.dispatchEvent(submit);
        expect(submit.defaultPrevented).toBe(true);
        expect(form.querySelector('[data-lang-key="first_run_fixed_pin_mismatch"]')).not.toBeNull();
    });
}
test.each(['fi', 'en'])('First Run: PIN mismatch reveals settings before focusing and announcing the error (%s)', async lang => {
    const form = template('first_run_admin');
    await translatePage(lang);
    const settings = form.querySelector('[data-section-key="settings"]');
    const account = form.querySelector('[data-section-key="credentials"]');
    settings.querySelector('#setup_code').value = 'synthetic-setup-code';
    const radios = [...settings.querySelectorAll('input[type="radio"]')];
    for (const name of new Set(radios.map(input => input.name))) {
        const group = radios.filter(input => input.name === name);
        if (!group.some(input => input.checked)) group[0].checked = true;
    }
    const pin = form.querySelector('#fixed_pin');
    const confirmation = form.querySelector('#confirm_fixed_pin');
    pin.value = '0123'; confirmation.value = '0124';
    expect(pin.checkValidity()).toBe(true); expect(confirmation.checkValidity()).toBe(true);
    form.querySelector('[data-form-section-footer-direction="next"]').click();
    expect(settings.hidden).toBe(true); expect(account.hidden).toBe(false);

    const submit = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
    expect(settings.hidden).toBe(false);
    expect(settings.hasAttribute('inert')).toBe(false);
    expect(settings.getAttribute('aria-hidden')).toBe('false');
    expect(account.hidden).toBe(true);
    expect(document.activeElement).toBe(confirmation);
    expect(confirmation.getAttribute('aria-invalid')).toBe('true');
    const error = document.getElementById(confirmation.getAttribute('aria-describedby').split(' ')[1]);
    expect(error.closest('[hidden], [inert], [aria-hidden="true"]')).toBeNull();
    expect(error.textContent).toBe(copy.first_run_fixed_pin_mismatch[lang]);
    expect(error.getAttribute('role')).toBe('status');
    expect(error.getAttribute('aria-live')).toBe('polite');
    expect(error.getAttribute('aria-atomic')).toBe('true');

    confirmation.value = '0123';
    const corrected = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(corrected);
    expect(corrected.defaultPrevented).toBe(false);
    expect(error.textContent).toBe('');
});
test.each(['first_run_postmark_required', 'first_run_future_factor_error'])(
    'First Run: other factor error %s retains the visible general error display', code => {
        const form = template('first_run_admin', code);
        const email = form.querySelector('input[name="verification_method"][value="email"]');
        email.checked = true; email.dispatchEvent(new Event('change', { bubbles: true }));
        const error = form.querySelector('[data-factor-error]');
        expect(error).not.toBeNull();
        expect(error.className).toBe('error');
        expect(form.querySelectorAll(`[data-lang-key="${code}"]`)).toHaveLength(1);
        expect(error.dataset.langKey).toBe(code);
        expect(error.textContent).not.toBe('');
        expect(error.closest('[hidden], [inert], [aria-hidden="true"]')).toBeNull();
        expect(error.previousElementSibling.dataset.verificationFields).toBe('totp');
    }
);
test('First Run TOTP: raw max 32, whitespace normalization, rejected long values survive and server error is associated', async () => {
    const form = template('first_run_admin', 'first_run_totp_invalid');
    const totp = form.querySelector('input[value="totp"]'); totp.checked = true; totp.dispatchEvent(new Event('change', { bubbles: true }));
    const input = form.querySelector('#totp_code');
    expect(input.maxLength).toBe(32);
    const root = input.closest('.auth-verify');
    expect(form.querySelector('[data-factor-error]')).toBeNull();
    expect(root.querySelector('[data-verify="error"]').dataset.langKey).toBe('first_run_totp_invalid');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const paste = value => {
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', { value: { getData: () => value } });
        input.dispatchEvent(event);
    };
    paste(' 012 345\n'); expect(input.value).toBe('012345');
    expect(new FormData(form).get('totp_code')).toBe('012345');
    input.select(); paste('012 '.repeat(20)); expect(input.value).toBe('012'.repeat(20));
    expect(root.querySelector('[data-verify="error"]').dataset.langKey).toBe('verification_totp_format');
    input.value = ' 012 345 '; input.dispatchEvent(new Event('change')); expect(input.value).toBe('012345');
    expect(root.querySelector('[data-verify="hint"]').id).toBe(input.getAttribute('aria-describedby').split(' ')[0]);
});
