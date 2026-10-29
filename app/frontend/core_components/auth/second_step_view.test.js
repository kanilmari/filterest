// second_step_view.test.js
// Verifies all factor contracts against the actual login template and live translator.
// Connects page/modal mounts, paste handling, shared errors and secondary actions in jsdom.
// Exists so both entry paths keep the same accessible multilingual code-screen behavior.
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { SECOND_STEP_FACTORS } from './second_step_factors.js';
import { SECOND_STEP_TRANSLATION_FALLBACKS as copy } from './second_step_translation_fallbacks.js';
import { renderSecondStep, mountLoginSecondStep, leaveLoginSecondStep, showLoginStatus, bindLoginCodeResend } from './second_step_view.js';
import { translatePage } from '../lang/translation_handler.js';
import { dirname, resolve } from 'node:path';

vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
vi.mock('../table_views/dataset_value_localizer.js', () => ({ refreshLocalizedDatasetValues: vi.fn() }));
vi.mock('../lang/dev_lang_key_editor.js', () => ({ initDevLangKeyEditor: vi.fn() }));

function formFixture(modal = false) {
    const doc = new DOMParser().parseFromString(readFileSync('frontend/templates/login.html', 'utf8'), 'text/html');
    const form = doc.querySelector('form.auth-form');
    const wrapper = document.createElement('div');
    if (modal) wrapper.className = 'modal';
    wrapper.append(form);
    document.body.append(wrapper);
    return form;
}
function paste(input, text) {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
}
beforeEach(async () => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    window.translationPromises = { fi: Promise.resolve({}), en: Promise.resolve({}) };
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    await translatePage('en');
});
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

test('PIN descriptor is a numeric one-time-code text field with unchanged raw and semantic limits', () => {
    expect(SECOND_STEP_FACTORS.fixed_pin.attributes).toEqual({
        type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', minlength: '4', maxlength: '32',
        pattern: '[0-9]{4,8}', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false',
    });
    expect(SECOND_STEP_FACTORS.fixed_pin.maxCodeLength).toBe(8);
});

for (const modal of [false, true]) describe(modal ? 'modal mount' : 'standalone mount', () => {
    test.each(Object.entries(SECOND_STEP_FACTORS).filter(([factor]) => ['fixed_pin', 'totp', 'email', 'recovery'].includes(factor)))('%s: attributes, copy, aria, errors and attempts', async (factor, descriptor) => {
        const form = formFixture(modal);
        const before = [...form.querySelectorAll('[id]')].map(node => [node, node.id, node.getAttribute('name'), node.dataset.testid]);
        const view = mountLoginSecondStep(form, factor, { masked_email: 'a•••@example.com' });
        const root = view.input.closest('.auth-verify');
        const slot = name => root.querySelector(`[data-verify="${name}"]`);
        for (const [key, value] of Object.entries(descriptor.attributes)) expect(view.input.getAttribute(key)).toBe(value);
        expect(view.input.type).toBe('text');
        expect(view.input.autocomplete).toBe('one-time-code');
        expect(view.input.classList.contains('auth-verify__masked')).toBe(Boolean(descriptor.reveal));
        for (const language of ['fi', 'en']) {
            await translatePage(language);
            for (const name of ['heading', 'instruction', 'label', 'hint']) expect(slot(name).textContent).toBe(copy[descriptor[name]][language]);
            expect(root.textContent).not.toMatch(/\bOtp\b|\bOTP\b/);
        }
        for (const [node, id, name, testid] of before) {
            expect(node.id).toBe(id); expect(node.getAttribute('name')).toBe(name); expect(node.dataset.testid).toBe(testid);
        }
        expect(view.input.getAttribute('aria-describedby')).toBe(`${slot('hint').id} ${slot('error').id}`);
        expect(slot('label').htmlFor).toBe(view.input.id);
        expect(slot('error').getAttribute('role')).toBe('status');
        expect(slot('error').getAttribute('aria-live')).toBe('polite');
        expect(slot('error').getAttribute('aria-atomic')).toBe('true');
        expect(slot('error').textContent).toBe('');
        expect(form.querySelector('#forgot-password-link').style.display).toBe('none');
        expect(form.querySelector('#back-to-login-link').parentNode).toBe(slot('actions'));
        expect(slot('resend').hidden).toBe(!descriptor.resend);
        expect(view.validate()).toBe(false);
        expect(slot('error').textContent).toBe(copy[descriptor.empty].en);
        view.input.value = factor === 'fixed_pin' ? '0123' : factor === 'totp' ? '012345' : 'abc234def';
        expect(view.validate()).toBe(true);
        view.error({ error: 'wrong_otp', attempts_remaining: 2 });
        expect(view.input.getAttribute('aria-invalid')).toBe('true');
        expect(slot('error').textContent).toBe(copy[descriptor.error].en);
        expect(slot('attempts').textContent).toBe('Attempts remaining: 2.');
        expect(view.input.closest('.auth-verify__field').lastElementChild).toBe(slot('error'));
        expect(document.activeElement).toBe(view.input);
        expect(view.input.value).not.toBe('');
        expect(slot('status').compareDocumentPosition(form.querySelector('#submit')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        await translatePage('fi');
        expect(slot('attempts').textContent).toBe('Yrityksiä jäljellä: 2.');
        for (const [code, key] of [['no_pending_otp', 'verification_expired'], ['no_pending_password_reset', 'verification_expired'], ['too_many_otp_requests', 'verification_locked'], [undefined, 'verification_unavailable']]) {
            view.error({ error: code });
            expect(slot('error').textContent).toBe(copy[key].fi);
            expect(slot('attempts').textContent).toBe('');
        }
        view.error({ error: 'unknown' });
        expect(slot('error').textContent).toBe('unknown');
        expect(slot('error').hasAttribute('data-lang-key')).toBe(false);
    });

    test.each(['fixed_pin', 'totp', 'email', 'recovery'])('%s: paste, input/autofill and composition preserve values without truncation', factor => {
        const view = mountLoginSecondStep(formFixture(modal), factor);
        const input = view.input;
        const code = factor === 'fixed_pin' ? '01 23' : factor === 'totp' ? '012 345' : 'abc 234 def';
        paste(input, ` \t${code}\n`);
        expect(input.value).toBe(code.replace(/\s/g, ''));
        expect(view.validate()).toBe(true);
        input.setSelectionRange(0, 2);
        paste(input, '98 ');
        expect(input.value.startsWith('98')).toBe(true);
        input.value = ' 12 34 ';
        input.dispatchEvent(new Event('change'));
        expect(input.value).toBe('1234');
        input.value = ' 98 76 ';
        input.dispatchEvent(new CompositionEvent('compositionend'));
        expect(input.value).toBe('9876');
        input.value = '';
        input.dispatchEvent(new InputEvent('beforeinput', { data: '123 '.repeat(20), inputType: 'insertReplacementText', cancelable: true }));
        expect(input.value).toBe('123'.repeat(20));
        input.value = '';
        paste(input, '123 '.repeat(20));
        expect(input.value).toBe('123'.repeat(20));
        expect(view.validate()).toBe(false);
        expect(input.getAttribute('aria-invalid')).toBe('true');
    });
});

test.each([false, true])('PIN mask/reveal/reset, help, mobile focus and password preservation (modal=%s)', async modal => {
    matchMedia.mockReturnValue({ matches: true });
    const form = formFixture(modal);
    form.querySelector('#password').value = '  exact password  ';
    const view = mountLoginSecondStep(form, 'fixed_pin');
    const root = view.input.closest('.auth-verify');
    expect(document.activeElement).toBe(root.querySelector('[data-verify="heading"]'));
    const reveal = root.querySelector('[data-verify="reveal"]');
    expect(view.input.type).toBe('text');
    expect(view.input.classList.contains('auth-verify__masked')).toBe(true);
    expect(reveal.getAttribute('aria-pressed')).toBe('false');
    expect(reveal.getAttribute('aria-label')).toBe('Show PIN');
    paste(view.input, '01 23');
    reveal.click();
    expect(view.input.type).toBe('text');
    expect(view.input.classList.contains('auth-verify__masked')).toBe(false);
    expect(view.input.value).toBe('0123');
    expect(reveal.getAttribute('aria-controls')).toBe('otp');
    expect(reveal.getAttribute('aria-pressed')).toBe('true');
    await translatePage('fi');
    expect(reveal.textContent).toBe('Piilota PIN-koodi');
    expect(reveal.getAttribute('aria-label')).toBe('Piilota PIN-koodi');
    reveal.click();
    expect(view.input.type).toBe('text');
    expect(view.input.classList.contains('auth-verify__masked')).toBe(true);
    expect(reveal.getAttribute('aria-pressed')).toBe('false');
    expect(reveal.getAttribute('aria-label')).toBe('Näytä PIN-koodi');
    expect(reveal.textContent).toBe('Näytä PIN-koodi');
    reveal.click();
    const help = root.querySelector('[data-verify="help-action"]');
    help.click();
    expect(help.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('[data-verify="help"]').hidden).toBe(false);
    leaveLoginSecondStep(form);
    expect(view.input.type).toBe('text');
    expect(view.input.classList.contains('auth-verify__masked')).toBe(true);
    expect(reveal.getAttribute('aria-pressed')).toBe('false');
    expect(reveal.getAttribute('aria-label')).toBe('Näytä PIN-koodi');
    expect(reveal.textContent).toBe('Näytä PIN-koodi');
    expect(form.querySelector('#submit').parentNode).toBe(form);
    expect(form.querySelector('#password').value).toBe('  exact password  ');
    expect(form.noValidate).toBe(false);
    showLoginStatus(form, 'password_updated_sign_in');
    expect(form.querySelector('[data-login-status]').getAttribute('role')).toBe('status');
    expect(form.querySelector('[data-login-status]').classList.contains('error')).toBe(false);
});

test.each(['totp', 'email', 'recovery'])('PIN remount resets its mask and %s stays unmasked', factor => {
    const form = formFixture();
    const first = mountLoginSecondStep(form, 'fixed_pin');
    first.input.closest('.auth-verify').querySelector('[data-verify="reveal"]').click();
    const pin = mountLoginSecondStep(form, 'fixed_pin');
    const reveal = pin.input.closest('.auth-verify').querySelector('[data-verify="reveal"]');
    expect(pin.input.type).toBe('text');
    expect(pin.input.classList.contains('auth-verify__masked')).toBe(true);
    expect(reveal.getAttribute('aria-pressed')).toBe('false');
    reveal.click();
    expect(pin.input.classList.contains('auth-verify__masked')).toBe(false);
    const next = mountLoginSecondStep(form, factor);
    expect(next.input.type).toBe('text');
    expect(next.input.autocomplete).toBe('one-time-code');
    expect(next.input.classList.contains('auth-verify__masked')).toBe(false);
    expect(next.input.closest('.auth-verify').querySelector('[data-verify="reveal"]').hidden).toBe(true);
});

test('resend is pending once, disables primary/action, recovers from failure without a countdown', async () => {
    const form = formFixture(true);
    const view = mountLoginSecondStep(form, 'email');
    let finish;
    const request = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const pending = view.resend(request);
    await view.resend(request);
    expect(request).toHaveBeenCalledOnce();
    expect(form.querySelector('input[type="submit"]').disabled).toBe(true);
    expect(form.querySelector('#resend-otp').getAttribute('aria-disabled')).toBe('true');
    expect(form.querySelector('#resend-otp').getAttribute('tabindex')).toBe('-1');
    expect(form.querySelector('#resend-otp').textContent).toBe(copy.verification_resending.en);
    finish(false);
    await pending;
    expect(form.querySelector('[data-verify="status"]').textContent).toBe(copy.verification_send_failed.en);
    expect(form.querySelector('input[type="submit"]').disabled).toBe(false);
    expect(form.querySelector('#resend-otp').getAttribute('aria-disabled')).toBe('false');
    expect(form.querySelector('#resend-otp').hasAttribute('tabindex')).toBe(false);
});

test.each([false, true])('resend ignores click, Enter and Space throughout verification (modal=%s)', async modal => {
    const form = formFixture(modal);
    const view = mountLoginSecondStep(form, 'email');
    const request = vi.fn().mockResolvedValue(true);
    bindLoginCodeResend(form, () => view, request);
    const resend = form.querySelector('#resend-otp');
    const primary = form.querySelector('input[type="submit"]');
    resend.focus();
    view.busy(true);
    expect(resend.getAttribute('aria-disabled')).toBe('true');
    expect(resend.getAttribute('tabindex')).toBe('-1');
    resend.click();
    for (const key of ['Enter', ' ']) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        resend.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        // jsdom does not synthesize native keyboard clicks; even a delivered click must be harmless.
        resend.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        resend.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
    }
    await view.resend(request);
    expect(request).not.toHaveBeenCalled();
    expect(primary.disabled).toBe(true);
    view.busy(false);
    expect(primary.disabled).toBe(false);
    expect(resend.getAttribute('aria-disabled')).toBe('false');
    expect(resend.hasAttribute('tabindex')).toBe(false);
    resend.click();
    await vi.waitFor(() => expect(primary.disabled).toBe(false));
    expect(request).toHaveBeenCalledOnce();
});

test.each(['email', 'recovery'])('a completed %s resend cannot enable submit during verification', async factor => {
    const form = formFixture();
    const view = mountLoginSecondStep(form, factor);
    const resend = form.querySelector(factor === 'email' ? '#resend-otp' : '#resend-password-reset-otp');
    let finish;
    const request = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const pending = view.resend(request);
    view.busy(true);
    finish(true);
    await pending;
    expect(form.querySelector('input[type="submit"]').disabled).toBe(true);
    expect(resend.getAttribute('aria-disabled')).toBe('true');
    expect(resend.getAttribute('tabindex')).toBe('-1');
    expect(view.input.closest('.auth-verify').getAttribute('aria-busy')).toBe('true');
    await view.resend(request);
    expect(request).toHaveBeenCalledOnce();
    view.busy(false);
    expect(form.querySelector('input[type="submit"]').disabled).toBe(false);
    expect(resend.getAttribute('aria-disabled')).toBe('false');
    expect(resend.hasAttribute('tabindex')).toBe(false);
});

test('resend restores an embedded control\'s original tab order after verification', () => {
    const form = formFixture();
    const resend = form.querySelector('#resend-otp');
    resend.setAttribute('tabindex', '0');
    const view = mountLoginSecondStep(form, 'email');
    view.busy(true);
    expect(resend.getAttribute('tabindex')).toBe('-1');
    view.busy(false);
    expect(resend.getAttribute('tabindex')).toBe('0');
});

test('remounting restores resend tab order and an old resend cannot enable the new verification', async () => {
    const form = formFixture();
    const previous = mountLoginSecondStep(form, 'email');
    let finish;
    const pending = previous.resend(() => new Promise(resolve => { finish = resolve; }));
    const current = mountLoginSecondStep(form, 'email');
    expect(form.querySelector('#resend-otp').hasAttribute('tabindex')).toBe(false);
    current.busy(true);
    finish(true);
    await pending;
    expect(form.querySelector('input[type="submit"]').disabled).toBe(true);
    expect(form.querySelector('#resend-otp').getAttribute('aria-disabled')).toBe('true');
    current.busy(false);
    expect(form.querySelector('#resend-otp').hasAttribute('tabindex')).toBe(false);
});

test.each([false, true])('corrected recovery password clears its error even after a rejected code (modal=%s)', modal => {
    const form = formFixture(modal);
    const view = mountLoginSecondStep(form, 'recovery');
    const password = form.querySelector('#password-reset-new-password');
    const error = form.querySelector('[data-verify="password-error"]');
    view.input.value = 'abc234def';
    view.passwordError();
    expect(error.textContent).toBe(copy.reset_password_empty.en);
    expect(password.getAttribute('aria-invalid')).toBe('true');
    password.value = '  exact replacement  ';
    expect(view.validate()).toBe(true);
    view.error({ error: 'wrong_otp' });
    expect(error.textContent).toBe('');
    expect(error.hasAttribute('data-lang-key')).toBe(false);
    expect(password.getAttribute('aria-invalid')).toBe('false');
    expect(password.value).toBe('  exact replacement  ');
    expect(view.input.closest('.auth-verify').querySelector('[data-verify="error"]').textContent).toBe(copy.reset_code_error.en);
});

test.each(['first_run_admin', 'register'])('%s stylesheet imports retain the common themed error rule', page => {
    const doc = new DOMParser().parseFromString(readFileSync(`frontend/templates/${page}.html`, 'utf8'), 'text/html');
    const visited = new Set();
    const errorColors = [];
    function visit(path) {
        if (visited.has(path)) return;
        visited.add(path);
        const css = readFileSync(path, 'utf8');
        for (const [, href] of css.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]/g)) {
            visit(href.startsWith('/') ? resolve(href.slice(1)) : resolve(dirname(path), href));
        }
        for (const [, body] of css.matchAll(/^\s*\.error\s*\{([^}]+)\}/gm)) {
            const color = body.match(/(?:^|;)\s*color:\s*([^;]+);/);
            if (color) errorColors.push(color[1]);
        }
    }
    doc.querySelectorAll('link[rel="stylesheet"]').forEach(link => visit(resolve(link.getAttribute('href').slice(1))));
    expect(visited.has(resolve('frontend/core_components/auth/auth.css'))).toBe(true);
    expect(errorColors).toEqual(['var(--color-error, #ff4c4c)']);
});

test('new IDs are unique across template mounts and a root/descriptor can mount without page controls', () => {
    const page = formFixture();
    mountLoginSecondStep(page, 'email');
    const modal = formFixture(true);
    const root = modal.querySelector('[data-testid="login-password-reset-section"]');
    renderSecondStep(root, SECOND_STEP_FACTORS.recovery);
    const ids = [...document.querySelectorAll('[data-verify]:not([data-verify="input"]):not([data-verify="instruction"]):not([data-verify="resend"])')].map(node => node.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
});
