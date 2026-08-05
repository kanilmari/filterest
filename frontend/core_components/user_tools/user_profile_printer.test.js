// user_profile_printer.test.js
// Verifies the pure request-body helpers used by the user profile printer.
// Bridges form-state combinations and stable API payloads in isolation.
// Exists so body-building behavior can be covered without DOM setup.

import { describe, expect, test } from 'vitest';
import {
    buildPasswordUpdateBody,
    buildProfileUpdateBody,
    sanitizeOtpCode,
} from './user_profile_printer_builder.js';

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
