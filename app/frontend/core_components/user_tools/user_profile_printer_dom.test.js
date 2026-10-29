// @vitest-environment jsdom
// user_profile_printer_dom.test.js
// Verifies profile form submission payloads across OTP and current-password UI flows.
// Bridges the rendered account settings DOM and the mocked endpoint router.
// Exists to prevent profile saves from dropping the current password required by the backend.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
    endpointRouterMock,
    showErrorToastMock,
    showInfoToastMock,
    showInputModalMock,
    showSuccessToastMock,
    showWarningToastMock,
} = vi.hoisted(() => ({
    endpointRouterMock: vi.fn(),
    showErrorToastMock: vi.fn(),
    showInfoToastMock: vi.fn(),
    showInputModalMock: vi.fn(),
    showSuccessToastMock: vi.fn(),
    showWarningToastMock: vi.fn(),
}));

vi.mock('../endpoints/endpoint_router.js', () => ({
    endpoint_router: endpointRouterMock,
}));

vi.mock('../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showErrorToast: showErrorToastMock,
    showInfoToast: showInfoToastMock,
    showSuccessToast: showSuccessToastMock,
    showWarningToast: showWarningToastMock,
}));

vi.mock('../../reusable_components/modal/confirm_modal_builder.js', () => ({
    showInputModal: showInputModalMock,
}));

import { generate_user_view } from './user_profile_printer.js';

function flushPromises() {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

describe('generate_user_view profile submit', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '<div id="profile-root"></div>';
        showInputModalMock.mockResolvedValue('old-pass');

        endpointRouterMock.mockImplementation((routeName) => {
            if (routeName === 'fetchUserProfile') {
                return Promise.resolve({
                    username: 'alice',
                    email: 'alice@example.com',
                });
            }
            if (routeName === 'requestEmailChangeOTP') {
                return Promise.resolve({ masked_email: 'n***@example.com' });
            }
            if (routeName === 'updateUserProfile') {
                return Promise.resolve({ success: true });
            }
            return Promise.resolve({});
        });
    });

    test('reuses the OTP password prompt when saving an email change', async () => {
        const container = document.getElementById('profile-root');
        await generate_user_view(container);

        document.getElementById('edit_email').value = 'new@example.com';
        document.getElementById('edit_email').dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('confirm_email').value = 'new@example.com';

        document.getElementById('email_otp_send_btn').click();
        await flushPromises();

        document.getElementById('email_otp').value = '12 34 56';
        document.getElementById('user_profile_form')
            .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await flushPromises();

        const updateCall = endpointRouterMock.mock.calls.find(([routeName]) => (
            routeName === 'updateUserProfile'
        ));
        expect(updateCall?.[1]?.body_data).toEqual({
            current_password: 'old-pass',
            email: 'new@example.com',
            email_otp: '123456',
        });
        expect(showSuccessToastMock).toHaveBeenCalledWith('Profile updated successfully.');
        expect(document.getElementById('profile_message')).toBeNull();
        expect(showInputModalMock).toHaveBeenCalledTimes(1);
    });

    test('uses the current password field when saving a username change', async () => {
        const container = document.getElementById('profile-root');
        await generate_user_view(container);

        document.getElementById('edit_username').value = 'alice2';
        document.getElementById('current_password').value = 'field-pass';
        document.getElementById('user_profile_form')
            .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await flushPromises();

        const updateCall = endpointRouterMock.mock.calls.find(([routeName]) => (
            routeName === 'updateUserProfile'
        ));
        expect(updateCall?.[1]?.body_data).toEqual({
            current_password: 'field-pass',
            username: 'alice2',
        });
        expect(showSuccessToastMock).toHaveBeenCalledWith('Profile updated successfully.');
        expect(showInputModalMock).not.toHaveBeenCalled();
    });

    test('uses toast feedback instead of the legacy inline profile message', async () => {
        const container = document.getElementById('profile-root');
        await generate_user_view(container);

        expect(document.getElementById('profile_message')).toBeNull();

        document.getElementById('user_profile_form')
            .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await flushPromises();

        expect(showInfoToastMock).toHaveBeenCalledWith('No changes to save.');
        expect(showErrorToastMock).not.toHaveBeenCalled();
        expect(showWarningToastMock).not.toHaveBeenCalled();
    });

    test('renders OTP controls with translatable fallback text', async () => {
        const container = document.getElementById('profile-root');
        await generate_user_view(container);

        const emailOtpButton = document.getElementById('email_otp_send_btn');
        const passwordOtpButton = document.getElementById('password_otp_send_btn');
        const emailOtpLabel = document.querySelector('label[for="email_otp"]');

        expect(emailOtpButton.dataset.langKey).toBe('send_verification_code');
        expect(emailOtpButton.textContent).toBe('Send verification code');
        expect(passwordOtpButton.dataset.langKey).toBe('send_verification_code');
        expect(passwordOtpButton.textContent).toBe('Send verification code');
        expect(emailOtpLabel.closest('.auth-verify').querySelector('.auth-verify__header').hidden).toBe(true);
        expect(emailOtpLabel.dataset.langKey).toBe('verification_code_label');
        expect(emailOtpLabel.textContent).toBe('Verification code');
    });

    test('uses translation-aware fallback text for OTP validation warnings', async () => {
        const container = document.getElementById('profile-root');
        await generate_user_view(container);

        document.getElementById('edit_email').value = 'invalid-email';
        document.getElementById('edit_email').dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('email_otp_send_btn').click();
        await flushPromises();

        expect(showWarningToastMock).toHaveBeenCalledWith('Enter a new email address first.');
    });
});

// Public profile text needs no password prompt and sends only the changed allow-listed fields.
test('website and biography are loaded and saved from the profile', async () => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    endpointRouterMock.mockImplementation((route) => route === 'fetchUserProfile'
        ? Promise.resolve({ username: 'alice', email: 'alice@example.com', website: 'https://old.invalid', bio_social_medias: 'Old biography' })
        : Promise.resolve({ success: true }));
    const root = document.createElement('div'); document.body.append(root);
    await generate_user_view(root);
    expect(root.querySelector('#edit_website').value).toBe('https://old.invalid');
    expect(root.querySelector('#edit_bio_social_medias').value).toBe('Old biography');
    root.querySelector('#edit_website').value = 'https://new.invalid';
    root.querySelector('#edit_bio_social_medias').value = '';
    root.querySelector('#user_profile_form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
    expect(endpointRouterMock).toHaveBeenCalledWith('updateUserProfile', { method: 'POST', body_data: { website: 'https://new.invalid', bio_social_medias: '' } });
});

// The four server code errors change presentation only; submits still carry the caller's exact bodies.
describe('profile code presentation', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        document.body.innerHTML = '<main id="profile-root"></main>';
        window.translationPromises = { fi: Promise.resolve({}), en: Promise.resolve({}) };
        showInputModalMock.mockResolvedValue('  current exact  ');
        endpointRouterMock.mockImplementation(route => Promise.resolve(route === 'fetchUserProfile'
            ? { username: 'alice', email: 'alice@example.com' } : { masked_email: 'n•••@example.com' }));
        await generate_user_view(document.getElementById('profile-root'));
    });
    async function ready(kind) {
        if (kind === 'email') {
            const email = document.getElementById('edit_email'); email.value = 'new@example.com'; email.dispatchEvent(new Event('input'));
            document.getElementById('confirm_email').value = 'new@example.com';
        } else {
            document.getElementById('current_password').value = '  current exact  ';
            const next = document.getElementById('new_password'); next.value = '  replacement exact  '; next.dispatchEvent(new Event('input'));
            document.getElementById('confirm_password').value = '  replacement exact  ';
        }
        document.getElementById(`${kind}_otp_send_btn`).click(); await flushPromises();
    }
    test.each(['email_otp_required', 'email_otp_invalid', 'password_otp_required', 'password_otp_invalid'])('%s stays inline and translates in fi/en', async code => {
        const kind = code.startsWith('email') ? 'email' : 'password';
        await ready(kind);
        const { translatePage } = await import('../lang/translation_handler.js');
        const { SECOND_STEP_TRANSLATION_FALLBACKS: copy } = await import('../auth/second_step_translation_fallbacks.js');
        const input = document.getElementById(`${kind}_otp`); input.value = code.endsWith('required') ? '' : 'abc234def';
        endpointRouterMock.mockRejectedValueOnce(new Error(`Virhe pyynnössä (updateUserProfile): {"error":"${code}"}`));
        document.getElementById(kind === 'email' ? 'user_profile_form' : 'user_password_form').dispatchEvent(new Event('submit', { cancelable: true }));
        await flushPromises();
        const error = document.getElementById(input.getAttribute('aria-describedby').split(' ')[1]);
        const key = code.endsWith('required') ? 'verification_code_empty' : 'verification_email_error';
        expect(input.getAttribute('aria-invalid')).toBe('true'); expect(error.dataset.langKey).toBe(key);
        for (const lang of ['fi', 'en']) { await translatePage(lang); expect(error.textContent).toBe(copy[key][lang]); }
        expect(input.closest('.auth-verify__field').lastElementChild).toBe(error);
        expect(showErrorToastMock).not.toHaveBeenCalled();
        const update = endpointRouterMock.mock.calls.find(([route]) => route === 'updateUserProfile');
        expect(update[1]).toEqual({ method: 'POST', body_data: kind === 'email'
            ? { email: 'new@example.com', ...(input.value ? { email_otp: input.value } : {}), current_password: '  current exact  ' }
            : { new_password: '  replacement exact  ', ...(input.value ? { password_otp: input.value } : {}), current_password: '  current exact  ' } });
    });
    test('hiding the password-code section removes its native validation constraint', async () => {
        await ready('password');
        const input = document.getElementById('password_otp'); input.value = 'bad';
        expect(input.checkValidity()).toBe(false);
        const next = document.getElementById('new_password'); next.value = ''; next.dispatchEvent(new Event('input'));
        expect(input.disabled).toBe(true); expect(input.checkValidity()).toBe(true);
        next.value = 'replacement'; next.dispatchEvent(new Event('input'));
        expect(input.disabled).toBe(false); expect(input.checkValidity()).toBe(false);
    });
    test.each(['email', 'password'])('%s retains send requests, masked recipient, resend busy/failure states and other error toasts', async kind => {
        await ready(kind);
        const send = document.getElementById(`${kind}_otp_send_btn`);
        const input = document.getElementById(`${kind}_otp`); const root = input.closest('.auth-verify');
        expect(send.dataset.langKey).toBe('verification_resend');
        expect(root.querySelector('bdi').textContent).toBe('n•••@example.com');
        const route = kind === 'email' ? 'requestEmailChangeOTP' : 'requestPasswordChangeOTP';
        expect(endpointRouterMock).toHaveBeenCalledWith(route, { method: 'POST', body_data: kind === 'email'
            ? { new_email: 'new@example.com', current_password: '  current exact  ' } : { current_password: '  current exact  ' } });
        let fail;
        endpointRouterMock.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
        send.click(); await flushPromises();
        expect(send.disabled).toBe(true); expect(send.dataset.langKey).toBe('verification_resending');
        expect(root.getAttribute('aria-busy')).toBe('true');
        fail(new Error('delivery failed')); await flushPromises();
        expect(showErrorToastMock).toHaveBeenCalledWith('delivery failed');
        expect(send.disabled).toBe(false); expect(send.dataset.langKey).toBe('verification_resend');
        expect(root.querySelector('[data-verify="status"]').dataset.langKey).toBe('verification_send_failed');
        input.value = 'abc234def'; endpointRouterMock.mockRejectedValueOnce(new Error('profile_write_refused'));
        document.getElementById(kind === 'email' ? 'user_profile_form' : 'user_password_form').dispatchEvent(new Event('submit', { cancelable: true }));
        await flushPromises(); expect(showErrorToastMock).toHaveBeenCalled();
        expect(document.querySelector('#user_profile_form button[type="submit"]').dataset.langKey).toBe('save_profile');
        if (kind === 'password') expect(document.querySelector('#user_password_form button[type="submit"]').dataset.langKey).toBe('password_change_confirm');
    });
});
