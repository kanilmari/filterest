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
        expect(emailOtpLabel.dataset.langKey).toBe('otp');
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
