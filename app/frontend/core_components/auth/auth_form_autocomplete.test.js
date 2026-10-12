// auth_form_autocomplete.test.js
// Checks the actual Go-served authentication templates rather than mock forms.
// Connects account identifiers, passwords and verification codes to browser hints.
// Prevents masked PINs being offered as the account password.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const forms = {
    register: {
        username: 'username',
        password: 'new-password',
        fixed_pin: 'one-time-code',
        confirm_fixed_pin: 'one-time-code',
    },
    login: {
        username: 'username',
        password: 'current-password',
        otp: 'off',
        'password-reset-otp': 'off',
        'password-reset-new-password': 'new-password',
        authCode: 'off',
    },
    first_run_admin: {
        username: 'username',
        password: 'new-password',
        confirm_password: 'new-password',
        fixed_pin: 'one-time-code',
        confirm_fixed_pin: 'one-time-code',
        totp_code: 'one-time-code',
    },
};

describe.each(Object.entries(forms))('%s authentication hints', (name, hints) => {
    const markup = readFileSync(resolve(`frontend/templates/${name}.html`), 'utf8');
    const page = new DOMParser().parseFromString(markup, 'text/html');

    test.each(Object.entries(hints))('%s uses %s', (id, hint) => {
        expect(page.getElementById(id)?.getAttribute('autocomplete')).toBe(hint);
    });

    test('all masked fields have the appropriate password or PIN hint', () => {
        const masked = [...page.querySelectorAll('input[type="password"]')];
        expect(masked.length).toBeGreaterThan(0);
        for (const input of masked) {
            const pin = input.id.includes('pin');
            expect(input.autocomplete).toBe(pin ? 'one-time-code' : hints[input.id]);
            if (pin) {
                expect(input.inputMode).toBe('numeric');
                expect(input.pattern).toBe('[0-9]{4,8}');
                expect(input.minLength).toBe(4);
                expect(input.maxLength).toBe(8);
            }
        }
    });
});
