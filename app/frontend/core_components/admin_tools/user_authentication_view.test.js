// user_authentication_view.test.js
// Verifies administrator user selection, explicit provisioning, and verification payloads.
// Bridges mocked protected API rows with the Admin → Site settings form behavior.
// Exists to prevent fixed PIN disclosure, accidental persistence, or implicit admin activation.

import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();

vi.mock('../endpoints/endpoint_router.js', () => ({
    endpoint_router: (...args) => endpointRouterMock(...args),
}));

vi.mock('../lang/translation_handler.js', () => ({
    getTranslationForKey: (_key, { fallback } = {}) => fallback || '',
}));

const usersFixture = [
    {
        user_id: 7,
        username: 'existing_admin',
        enabled: true,
        admin_group_member: true,
        admin_access_allowed: true,
        verification_method: 'fixed_pin',
    },
    {
        user_id: 12,
        username: 'new_operator',
        enabled: false,
        admin_group_member: false,
        admin_access_allowed: false,
        verification_method: 'email',
    },
    {
        user_id: 19,
        username: 'totp_admin',
        enabled: true,
        admin_group_member: true,
        admin_access_allowed: true,
        verification_method: 'totp',
    },
];

function selectUser(userId) {
    const select = document.querySelector('[data-testid="user-authentication-user"]');
    select.value = String(userId);
    select.dispatchEvent(new Event('change', { bubbles: true }));
}

async function submitForm() {
    document.querySelector('.user-authentication-form').dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => {
        expect(document.querySelector('[data-testid="user-authentication-save"]').disabled).toBe(false);
    });
}

describe('user_authentication_view', () => {
    beforeEach(() => {
        document.body.innerHTML = '<main id="target"></main>';
        endpointRouterMock.mockReset();
        endpointRouterMock.mockResolvedValue({ users: usersFixture.map((user) => ({ ...user })) });
    });

    test('loads users without exposing a fixed PIN and shows authoritative status after selection', async () => {
        const { generate_user_authentication_view } = await import('./user_authentication_view.js');
        await generate_user_authentication_view(document.getElementById('target'));

        expect(endpointRouterMock).toHaveBeenCalledWith('adminUserAuthentication');
        expect(document.querySelectorAll('[data-testid="user-authentication-user"] option')).toHaveLength(4);

        selectUser(7);

        expect(document.querySelector('[data-testid="user-authentication-status"]').textContent).toContain('Fixed PIN');
        expect(document.querySelector('[data-testid="verification-method-fixed_pin"]').checked).toBe(true);
        expect(document.querySelector('[data-testid="user-authentication-fixed-pin"]').value).toBe('');
        expect(document.querySelector('[data-testid="user-authentication-fixed-pin-confirmation"]').value).toBe('');
    });

    test('shows an existing authenticator-app method without silently selecting password-only mode', async () => {
        const { generate_user_authentication_view } = await import('./user_authentication_view.js');
        await generate_user_authentication_view(document.getElementById('target'));
        selectUser(19);

        expect(document.querySelector('[data-testid="user-authentication-status"]').textContent)
            .toContain('Authenticator app (not managed by this tool)');
        expect(document.querySelectorAll('input[name="verification_method"]:checked')).toHaveLength(0);

        await submitForm();

        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
        expect(document.querySelector('.user-authentication-feedback').textContent)
            .toContain('Select one of the available verification methods');
    });

    test('validates a fixed PIN, saves it only in the POST payload, and clears both PIN fields', async () => {
        const savedUser = {
            ...usersFixture[1],
            enabled: true,
            admin_group_member: true,
            admin_access_allowed: true,
            verification_method: 'fixed_pin',
        };
        endpointRouterMock
            .mockResolvedValueOnce({ users: usersFixture.map((user) => ({ ...user })) })
            .mockResolvedValueOnce(savedUser);
        const { generate_user_authentication_view } = await import('./user_authentication_view.js');
        await generate_user_authentication_view(document.getElementById('target'));
        selectUser(12);

        const fixedPinMethod = document.querySelector('[data-testid="verification-method-fixed_pin"]');
        fixedPinMethod.checked = true;
        fixedPinMethod.dispatchEvent(new Event('change', { bubbles: true }));
        const pin = document.querySelector('[data-testid="user-authentication-fixed-pin"]');
        const confirmation = document.querySelector('[data-testid="user-authentication-fixed-pin-confirmation"]');
        pin.value = '1234';
        confirmation.value = '5678';
        await submitForm();
        expect(endpointRouterMock).toHaveBeenCalledTimes(1);
        expect(document.querySelector('.user-authentication-feedback').textContent).toContain('do not match');

        pin.value = '123456';
        confirmation.value = '123456';
        await submitForm();

        expect(endpointRouterMock).toHaveBeenLastCalledWith('adminUserAuthentication', {
            method: 'POST',
            body_data: {
                user_id: 12,
                verification_method: 'fixed_pin',
                fixed_pin: '123456',
            },
        });
        expect(pin.value).toBe('');
        expect(confirmation.value).toBe('');
        expect(document.querySelector('[data-testid="user-authentication-status"]').textContent).toContain('Administrator access allowedYes');
    });

    test('saves password-only mode without a PIN and explains admin activation before saving', async () => {
        endpointRouterMock
            .mockResolvedValueOnce({ users: usersFixture.map((user) => ({ ...user })) })
            .mockResolvedValueOnce({
                ...usersFixture[1],
                enabled: true,
                admin_group_member: true,
                admin_access_allowed: true,
                verification_method: 'none',
            });
        const { generate_user_authentication_view } = await import('./user_authentication_view.js');
        await generate_user_authentication_view(document.getElementById('target'));
        selectUser(12);

        const noneMethod = document.querySelector('[data-testid="verification-method-none"]');
        noneMethod.checked = true;
        noneMethod.dispatchEvent(new Event('change', { bubbles: true }));

        expect(document.querySelector('.user-authentication-activation-notice').textContent)
            .toContain('adds it to the admins group');
        await submitForm();

        expect(endpointRouterMock).toHaveBeenLastCalledWith('adminUserAuthentication', {
            method: 'POST',
            body_data: {
                user_id: 12,
                verification_method: 'none',
            },
        });
    });

    test('does not present an unsupported POST readback as password-only mode', async () => {
        endpointRouterMock
            .mockResolvedValueOnce({ users: usersFixture.map((user) => ({ ...user })) })
            .mockResolvedValueOnce({
                ...usersFixture[1],
                enabled: true,
                admin_group_member: true,
                admin_access_allowed: true,
                verification_method: 'totp',
            });
        const { generate_user_authentication_view } = await import('./user_authentication_view.js');
        await generate_user_authentication_view(document.getElementById('target'));
        selectUser(12);

        const noneMethod = document.querySelector('[data-testid="verification-method-none"]');
        noneMethod.checked = true;
        noneMethod.dispatchEvent(new Event('change', { bubbles: true }));
        await submitForm();

        expect(document.querySelectorAll('input[name="verification_method"]:checked')).toHaveLength(0);
        expect(document.querySelector('[data-testid="user-authentication-status"]').textContent)
            .toContain('Authenticator app (not managed by this tool)');
        expect(document.querySelector('.user-authentication-feedback').textContent)
            .toContain('cannot manage');
    });
});
