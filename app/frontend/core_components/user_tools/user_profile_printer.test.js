// user_profile_printer.test.js
// Verifies profile payloads and browser credential hints on the rendered forms.
// Bridges form-state combinations, password confirmation and stable API payloads.
// Keeps passwords distinct from public names and verification codes.

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { showInputModal } from '../../reusable_components/modal/confirm_modal_builder.js';
import { generate_user_view } from './user_profile_printer.js';
import {
    buildPasswordUpdateBody,
    buildProfileUpdateBody,
    sanitizeOtpCode,
} from './user_profile_printer_builder.js';

vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
vi.mock('../lang/translation_handler.js', () => ({
    getTranslationForKey: (_key, { fallback } = {}) => fallback || '',
}));
vi.mock('../../reusable_components/modal/confirm_modal_builder.js', () => ({ showInputModal: vi.fn() }));
vi.mock('../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showErrorToast: vi.fn(), showInfoToast: vi.fn(), showSuccessToast: vi.fn(), showWarningToast: vi.fn(),
}));

describe('profile authentication hints', () => {
    beforeEach(async () => {
        document.body.innerHTML = '<main id="profile"></main>';
        endpoint_router.mockReset().mockResolvedValue({ username: 'Public name', email: 'fixture@example.test' });
        showInputModal.mockReset().mockResolvedValue(null);
        await generate_user_view(document.getElementById('profile'));
    });

    test.each([
        ['current_password', 'current-password'],
        ['new_password', 'new-password'],
        ['confirm_password', 'new-password'],
        ['email_otp', 'off'],
        ['password_otp', 'off'],
        ['new_login_name', 'username'],
    ])('%s uses %s before and after focus', (id, hint) => {
        const input = document.getElementById(id);
        expect(input.autocomplete).toBe(hint);
        input.dispatchEvent(new Event('focus'));
        expect(input.autocomplete).toBe(hint);
        if (id.endsWith('password')) expect(input.type).toBe('password');
    });

    test('preserves hints on the existing autofill traps and public display name', () => {
        expect(document.querySelector('[name="decoy_username_trap"]').autocomplete).toBe('username');
        expect(document.querySelector('[name="decoy_password_trap"]').autocomplete).toBe('current-password');
        expect(document.getElementById('edit_username').autocomplete).toBe('off');
    });

    test('asks for the current password when confirming an account action', () => {
        document.getElementById('sign_out_other_devices').click();
        expect(showInputModal).toHaveBeenCalledWith(expect.objectContaining({
            inputType: 'password', autocomplete: 'current-password',
        }));
    });
});

describe('sanitizeOtpCode', () => {
    test('removes all whitespace from spaced OTP values', () => {
        expect(sanitizeOtpCode('12 34\t56\n78')).toBe('12345678');
    });

    test('returns an empty string for non-string input', () => {
        expect(sanitizeOtpCode(null)).toBe('');
        expect(sanitizeOtpCode(undefined)).toBe('');
        expect(sanitizeOtpCode(123456)).toBe('');
    });
});

describe('buildProfileUpdateBody', () => {
    test('returns only changed username fields when email is unchanged', () => {
        expect(buildProfileUpdateBody({
            originalUsername: 'alice',
            originalEmail: 'alice@example.com',
            username: 'alice2',
            email: 'alice@example.com',
            emailOtp: 'should-not-be-used',
            currentPassword: 'old-pass',
        })).toEqual({
            current_password: 'old-pass',
            username: 'alice2',
        });
    });

    test('includes changed email and a sanitized OTP when email changes', () => {
        expect(buildProfileUpdateBody({
            originalUsername: 'alice',
            originalEmail: 'alice@example.com',
            username: 'alice',
            email: 'new@example.com',
            emailOtp: '12 34 56',
            currentPassword: 'old-pass',
        })).toEqual({
            current_password: 'old-pass',
            email: 'new@example.com',
            email_otp: '123456',
        });
    });

    test('omits otp when the sanitized value is empty', () => {
        expect(buildProfileUpdateBody({
            originalUsername: 'alice',
            originalEmail: 'alice@example.com',
            username: 'alice',
            email: 'new@example.com',
            emailOtp: '   ',
            currentPassword: 'old-pass',
        })).toEqual({
            current_password: 'old-pass',
            email: 'new@example.com',
        });
    });

    test('does not add current password when profile identifiers are unchanged', () => {
        expect(buildProfileUpdateBody({
            originalUsername: 'alice',
            originalEmail: 'alice@example.com',
            username: 'alice',
            email: 'alice@example.com',
            emailOtp: '',
            currentPassword: 'old-pass',
        })).toEqual({});
    });

    test('returns an empty body when nothing changes', () => {
        expect(buildProfileUpdateBody({
            originalUsername: 'alice',
            originalEmail: 'alice@example.com',
            username: 'alice',
            email: 'alice@example.com',
            emailOtp: '123456',
        })).toEqual({});
    });
});

describe('buildPasswordUpdateBody', () => {
    test('builds the required password fields without otp', () => {
        expect(buildPasswordUpdateBody({
            currentPassword: 'old-pass',
            newPassword: 'new-pass',
            passwordOtp: '',
        })).toEqual({
            current_password: 'old-pass',
            new_password: 'new-pass',
        });
    });

    test('includes a sanitized password otp when present', () => {
        expect(buildPasswordUpdateBody({
            currentPassword: 'old-pass',
            newPassword: 'new-pass',
            passwordOtp: '98 76 54',
        })).toEqual({
            current_password: 'old-pass',
            new_password: 'new-pass',
            password_otp: '987654',
        });
    });
});
