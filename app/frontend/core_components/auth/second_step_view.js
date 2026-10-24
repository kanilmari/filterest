// second_step_view.js
// Renders accessible code fields and shared verification states inside a supplied root.
// Connects factor descriptors, translation keys and existing standalone/modal controls.
// Exists so callers own requests and phase state while all code presentation stays shared.
import { getTranslationForKey } from '../lang/translation_handler.js';
import { sanitizeOtpCode, applyLoginLangKey, translateError } from './login_page_builder_helpers.js';
import { SECOND_STEP_FACTORS } from './second_step_factors.js';

let nextInstance = 0;
const mounted = new WeakMap();
const homes = new WeakMap();
const PIN_MASK_CLASS = 'auth-verify__masked';
const SHIELD_ICON = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M12 3 4 6v6c0 4 4.5 7.5 8 9 3.5-1.5 8-5 8-9V6l-8-3Z\"/><path d=\"m8.5 12 2.3 2.3 4.7-4.8\"/></svg>";

export function bindSecondStepCopy(node, key) {
    if (node) applyLoginLangKey(node, key, getTranslationForKey(key));
}

/** Translate visibility names through the same attribute path used on language switches. */
export function setSecondStepReveal(button, input, kind = 'password') {
    if (!button || !input) return;
    const shown = kind === 'pin' ? !input.classList.contains(PIN_MASK_CLASS) : input.type !== 'password';
    const key = `${shown ? 'hide' : 'show'}_${kind}`;
    button.dataset.ariaLabelLangKey = key;
    button.setAttribute('aria-label', getTranslationForKey(key));
    button.setAttribute('aria-controls', input.id);
    button.setAttribute('aria-pressed', String(shown));
}

function clearCopy(node) {
    if (!node) return;
    delete node.dataset.langKey;
    node.textContent = '';
}

/** Mount into the auth-verify slots used by login.html; no page/global IDs are required.
 * Callers may pass their own input, primary/back/resend controls for embedded field groups.
 * Existing input identities are preserved; all new slot identities are instance-specific.
 */
export function renderSecondStep(root, descriptor, options = {}) {
    mounted.get(root)?.dispose();
    const prefix = `auth-verify-${++nextInstance}`;
    const slot = name => root.querySelector(`[data-verify="${name}"]`);
    root.classList.add('auth-verify');
    root.querySelectorAll('[data-verify]').forEach(node => {
        if (!node.id) node.id = `${prefix}-${node.dataset.verify}`;
        if (!node.dataset.testid) node.dataset.testid = `${prefix}-${node.dataset.verify}`;
    });
    const input = options.input || slot('input');
    const heading = slot('heading');
    const hint = slot('hint');
    const error = slot('error');
    const status = slot('status');
    const attempts = slot('attempts');
    const primary = options.primary || slot('primary');
    const resend = options.resend || slot('resend');
    const back = options.back || slot('back');
    const reveal = slot('reveal');
    const help = slot('help');
    const helpAction = slot('help-action');
    const label = slot('label');
    const listeners = [];
    const on = (node, event, handler) => {
        if (!node) return;
        node.addEventListener(event, handler);
        listeners.push(() => node.removeEventListener(event, handler));
    };
    for (const [name, key] of Object.entries({
        step: descriptor.step, heading: descriptor.heading, instruction: descriptor.instruction,
        label: descriptor.label, hint: descriptor.hint,
    })) bindSecondStepCopy(slot(name), key);
    heading?.setAttribute('tabindex', '-1');
    if (slot('icon')) slot('icon').innerHTML = SHIELD_ICON;
    Object.entries(descriptor.attributes).forEach(([key, value]) => input.setAttribute(key, value));
    // Keep PINs out of password-manager heuristics; CSS owns only their visual mask.
    input.classList.toggle(PIN_MASK_CLASS, Boolean(descriptor.reveal));
    for (const attribute of ['autocapitalize', 'autocorrect', 'spellcheck']) {
        if (!(attribute in descriptor.attributes)) input.removeAttribute(attribute);
    }
    label.htmlFor = input.id;
    input.setAttribute('aria-describedby', `${hint.id} ${error.id}`);
    input.setAttribute('aria-invalid', 'false');
    [error, status, attempts].forEach(node => {
        node.setAttribute('role', 'status');
        node.setAttribute('aria-live', 'polite');
        node.setAttribute('aria-atomic', 'true');
        clearCopy(node);
    });
    bindSecondStepCopy(primary, descriptor.primary);
    bindSecondStepCopy(back, 'verification_back');
    if (back) back.style.display = 'inline-flex';
    if (options.forgot) options.forgot.style.display = 'none';
    if (resend) {
        resend.hidden = !descriptor.resend;
        resend.style.display = descriptor.resend ? 'inline-flex' : 'none';
        bindSecondStepCopy(resend, 'verification_resend');
    }
    const recipient = slot('recipient');
    if (recipient) {
        recipient.hidden = !(descriptor.recipient && options.recipient);
        bindSecondStepCopy(slot('recipient-label'), 'verification_recipient');
        slot('recipient-value').textContent = options.recipient || '';
    }
    let resetReveal = () => {};
    if (reveal) {
        // Keep the mock's compact eye control; its translated name remains live on language switches.
        reveal.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
        const revealLabel = document.createElement('span');
        revealLabel.className = 'auth-verify__reveal-label';
        revealLabel.id = `${prefix}-reveal-label`;
        revealLabel.dataset.testid = revealLabel.id;
        reveal.append(revealLabel);
        reveal.hidden = !descriptor.reveal;
        const updateReveal = () => {
            setSecondStepReveal(reveal, input, 'pin');
            bindSecondStepCopy(revealLabel, input.classList.contains(PIN_MASK_CLASS) ? 'show_pin' : 'hide_pin');
        };
        resetReveal = () => {
            input.classList.toggle(PIN_MASK_CLASS, Boolean(descriptor.reveal));
            updateReveal();
        };
        updateReveal();
        on(reveal, 'click', () => {
            input.classList.toggle(PIN_MASK_CLASS);
            updateReveal();
        });
    }
    if (helpAction && help) {
        helpAction.hidden = !descriptor.help;
        help.hidden = true;
        helpAction.setAttribute('aria-expanded', 'false');
        helpAction.setAttribute('aria-controls', help.id);
        help.setAttribute('role', 'region');
        help.setAttribute('aria-labelledby', helpAction.id);
        if (descriptor.help) {
            bindSecondStepCopy(helpAction, descriptor.helpAction);
            bindSecondStepCopy(help, descriptor.help);
        }
        on(helpAction, 'click', () => {
            help.hidden = !help.hidden;
            helpAction.setAttribute('aria-expanded', String(!help.hidden));
        });
    }
    const showFieldError = (key, focus = true) => {
        bindSecondStepCopy(error, key);
        input.setAttribute('aria-invalid', 'true');
        if (focus) input.focus();
    };
    const normalize = () => {
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const raw = input.value;
        const clean = sanitizeOtpCode(raw);
        if (raw !== clean) {
            input.value = clean;
            input.setSelectionRange(sanitizeOtpCode(raw.slice(0, start)).length, sanitizeOtpCode(raw.slice(0, end)).length);
        }
        // Never discard a rejected paste/autofill value, including values beyond raw maxlength.
        if (clean.length > descriptor.maxCodeLength) showFieldError(descriptor.format, false);
    };
    on(input, 'beforeinput', event => {
        // Intercept oversized replacement/autofill before native maxlength can discard its tail.
        if (event.isComposing || event.data == null || !event.inputType?.startsWith('insert')) return;
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        const raw = input.value.slice(0, start) + event.data + input.value.slice(end);
        if (raw.length <= input.maxLength) return;
        event.preventDefault();
        input.value = raw;
        normalize();
        const caret = sanitizeOtpCode(raw.slice(0, start) + event.data).length;
        input.setSelectionRange(caret, caret);
    });
    on(input, 'input', event => { if (!event.isComposing) normalize(); });
    on(input, 'change', normalize);
    on(input, 'compositionend', normalize);
    on(input, 'paste', event => {
        const pasted = event.clipboardData?.getData('text');
        if (pasted === undefined) return;
        event.preventDefault();
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        const before = input.value.slice(0, start);
        input.value = before + pasted + input.value.slice(end);
        const caret = sanitizeOtpCode(before + pasted).length;
        normalize();
        input.setSelectionRange(caret, caret);
        if (input.value && !new RegExp(`^(?:${descriptor.attributes.pattern})$`).test(input.value)) showFieldError(descriptor.format, false);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const password = root.querySelector('#password-reset-new-password');
    if (password && slot('password-hint') && slot('password-error')) {
        password.setAttribute('aria-describedby', `${slot('password-hint').id} ${slot('password-error').id}`);
        password.setAttribute('aria-invalid', 'false');
        clearCopy(slot('password-error'));
        bindSecondStepCopy(slot('password-hint'), 'reset_password_hint');
    }
    let sending = false;
    let verifying = false;
    let disposed = false;
    const resendTabIndex = resend?.getAttribute('tabindex');
    // Either request owns the disabled state until both requests have finished.
    const updateBusy = () => {
        if (disposed) return;
        const pending = verifying || sending;
        root.setAttribute('aria-busy', String(pending));
        if (primary) primary.disabled = pending;
        if (resend) {
            resend.disabled = pending;
            resend.setAttribute('aria-disabled', String(pending));
            if (pending) resend.setAttribute('tabindex', '-1');
            else if (resendTabIndex == null) resend.removeAttribute('tabindex');
            else resend.setAttribute('tabindex', resendTabIndex);
        }
        bindSecondStepCopy(primary, pending ? 'verification_checking' : descriptor.primary);
    };
    on(resend, 'keydown', event => {
        if ((verifying || sending) && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
    });
    const view = {
        input,
        passwordError() {
            const password = root.querySelector('#password-reset-new-password');
            bindSecondStepCopy(slot('password-error'), 'reset_password_empty');
            password?.setAttribute('aria-invalid', 'true');
            password?.focus();
        },
        validate() {
            normalize();
            if (password?.value.trim()) {
                clearCopy(slot('password-error'));
                password.setAttribute('aria-invalid', 'false');
            }
            clearCopy(error);
            clearCopy(attempts);
            input.setAttribute('aria-invalid', 'false');
            const key = !input.value ? descriptor.empty
                : !new RegExp(`^(?:${descriptor.attributes.pattern})$`).test(input.value) ? descriptor.format : '';
            if (key) showFieldError(key);
            return !key;
        },
        error(data = {}) {
            const message = translateError(data.error);
            const key = ({ wrong_otp: descriptor.error, no_pending_otp: 'verification_expired',
                no_pending_password_reset: 'verification_expired', too_many_otp_requests: 'verification_locked',
            })[data.error];
            if (key || !data.error) showFieldError(key || 'verification_unavailable');
            else {
                // Preserve admission-policy messages and the established unknown-code fallback.
                clearCopy(error);
                error.textContent = message;
                input.setAttribute('aria-invalid', 'true');
                input.focus();
            }
            clearCopy(attempts);
            if (Number.isInteger(data.attempts_remaining) && data.attempts_remaining >= 0) {
                bindSecondStepCopy(attempts, `verification_attempts+${data.attempts_remaining}`);
            }
        },
        status(key) { if (key) bindSecondStepCopy(status, key); else clearCopy(status); },
        busy(value) {
            verifying = value;
            updateBusy();
        },
        async resend(action) {
            if (verifying || sending || !descriptor.resend) return;
            sending = true;
            updateBusy();
            bindSecondStepCopy(resend, 'verification_resending');
            view.status('verification_resending');
            try {
                if (await action() === false) throw new Error('send failed');
                view.status('');
            } catch {
                view.status('verification_send_failed');
            } finally {
                sending = false;
                updateBusy();
                bindSecondStepCopy(resend, 'verification_resend');
            }
        },
        focus() {
            (window.matchMedia?.('(max-width: 520px)').matches ? heading : input)?.focus();
        },
        dispose() {
            resetReveal();
            verifying = false;
            sending = false;
            updateBusy();
            disposed = true;
            listeners.forEach(remove => remove());
        },
    };
    mounted.set(root, view);
    return view;
}

/** Adapt existing login controls once, preserving their IDs and restoring their original homes. */
export function mountLoginSecondStep(form, factor, data = {}) {
    leaveLoginSecondStep(form);
    form.querySelector('[data-login-status]')?.remove();
    const root = form.querySelector(factor === 'recovery' ? '#password-reset-section' : '#otp-section');
    const primaryGroup = form.querySelector('#submit');
    const primary = primaryGroup?.querySelector('input[type="submit"]');
    const back = form.querySelector('#back-to-login-link');
    const saved = [primaryGroup, back].filter(Boolean).map(node => {
        const marker = document.createComment('verification control home');
        node.before(marker);
        return { node, marker };
    });
    homes.set(form, { saved, noValidate: form.noValidate });
    form.noValidate = true;
    form.classList.add('is-verifying');
    form.querySelectorAll(':scope > h2, label[for="username"], #username, label[for="password"], .password-wrapper:not(.password-reset-wrapper), .privacy-notice-link').forEach(node => { node.style.display = 'none'; });
    root.style.display = 'block';
    if (primaryGroup) root.insertBefore(primaryGroup, root.querySelector('[data-verify="actions"]'));
    if (back) root.querySelector('[data-verify="actions"]').append(back);
    const view = renderSecondStep(root, SECOND_STEP_FACTORS[factor] || SECOND_STEP_FACTORS.email, {
        primary, back, forgot: form.querySelector('#forgot-password-link'), recipient: data.masked_email,
    });
    view.focus();
    return view;
}

export function leaveLoginSecondStep(form) {
    if (!form) return;
    const home = homes.get(form);
    if (home) {
        home.saved.forEach(({ node, marker }) => marker.replaceWith(node));
        form.noValidate = home.noValidate;
        homes.delete(form);
    }
    form.classList.remove('is-verifying');
    form.querySelector(':scope > h2')?.style.removeProperty('display');
    form.querySelectorAll('.auth-verify').forEach(root => {
        mounted.get(root)?.dispose();
        root.style.display = 'none';
    });
}

/** Both login entry paths resend by replaying the remembered credentials, never the code. */
export function bindLoginCodeResend(form, getView, replayCredentials) {
    form?.querySelector('#resend-otp')?.addEventListener('click', event => {
        event.preventDefault();
        void getView()?.resend(replayCredentials);
    });
}

/** Password-reset confirmation is a status after the credential view is restored. */
export function showLoginStatus(form, key) {
    let status = form.querySelector('[data-login-status]');
    if (!status) {
        status = document.createElement('p');
        status.dataset.loginStatus = '';
        status.id = `auth-verify-${++nextInstance}-login-status`;
        status.dataset.testid = status.id;
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        status.setAttribute('aria-atomic', 'true');
        form.querySelector('#submit')?.before(status);
    }
    bindSecondStepCopy(status, key);
}
