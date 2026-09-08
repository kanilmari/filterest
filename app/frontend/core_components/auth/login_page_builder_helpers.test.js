// Verifies the pure value builders and navigation guards used by the login page.
// Bridges representative auth inputs with the helper module's normalized outputs.
// Covers redirect boundaries without requiring a browser or live authentication.
// Exists to prevent unsafe return targets and auth-loop regressions.
import { describe, test, expect, afterEach } from 'vitest';
import {
    translateError,
    pickLang,
    sanitizeOtpCode,
    buildCredentialsBody,
    buildOtpBody,
    buildPasswordResetRequestBody,
    buildPasswordResetBody,
    formatOtpError,
    resolvePostLoginTarget,
    computeStandaloneLoginBackTarget,
} from './login_page_builder_helpers.js';

// ---------------------------------------------------------------------------
// translateError
// ---------------------------------------------------------------------------
describe('translateError', () => {
    afterEach(() => {
        localStorage.removeItem('chosen_language');
    });

    test.each([
        ['fi', 'login_not_allowed', 'Tällä tilillä ei voi kirjautua tähän palveluun.'],
        ['en', 'login_not_allowed', 'This account is not allowed to sign in to this service.'],
        ['fi', 'authentication_policy_unavailable', 'Kirjautuminen ei ole juuri nyt käytettävissä. Yritä hetken kuluttua uudelleen.'],
        ['en', 'authentication_policy_unavailable', 'Sign-in is temporarily unavailable. Please try again shortly.'],
    ])('shows localized %s policy failure %s from the shared language preference', (language, code, expected) => {
        localStorage.setItem('chosen_language', language);
        expect(translateError(code)).toBe(expected);
        expect(translateError(code)).not.toContain(code);
    });

    test.each([
        ['HTTP 403: login_not_allowed', 'fi-FI', 'Tällä tilillä ei voi kirjautua tähän palveluun.'],
        ['POST /api/login failed: HTTP 503: authentication_policy_unavailable', 'en-US', 'Sign-in is temporarily unavailable. Please try again shortly.'],
    ])('normalizes a transport prefix for %s without exposing the code', (code, language, expected) => {
        expect(translateError(code, language)).toBe(expected);
    });

    test('preserves unknown and existing codes while unsupported languages use English policy copy', () => {
        expect(translateError('not_login_not_allowed', 'en')).toBe('not_login_not_allowed');
        expect(translateError('wrong_credentials', 'en')).toBe('Väärä käyttäjätunnus tai salasana.');
        expect(translateError('login_not_allowed', 'sv')).toBe('This account is not allowed to sign in to this service.');
    });

    test('translates known error codes', () => {
        expect(translateError('wrong_credentials')).toBe('Väärä käyttäjätunnus tai salasana.');
        expect(translateError('wrong_otp')).toBe('Virheellinen vahvistuskoodi.');
        expect(translateError('csrf_token_invalid')).toBe('Virheellinen CSRF-token. Lataa sivu uudelleen.');
        expect(translateError('no_pending_otp')).toBe('Ei odottavaa vahvistusta. Kirjaudu uudelleen.');
        expect(translateError('no_pending_password_reset')).toBe('Ei odottavaa salasanan palautusta. Aloita alusta.');
        expect(translateError('too_many_otp_requests')).toBe('Liian monta koodipyyntöä. Odota hetki.');
        expect(translateError('email_not_found')).toBe('Sähköpostiosoitetta ei löydy. Ota yhteyttä ylläpitoon.');
        expect(translateError('identifier_required')).toBe('Syötä käyttäjätunnus tai sähköposti.');
        expect(translateError('new_password_required')).toBe('Syötä uusi salasana.');
    });

    test('returns the code itself for unknown codes', () => {
        expect(translateError('some_unknown_error')).toBe('some_unknown_error');
    });

    test('returns fallback for empty string', () => {
        expect(translateError('')).toBe('Virhe kirjautumisessa.');
    });

    test('returns fallback for null/undefined', () => {
        expect(translateError(null)).toBe('Virhe kirjautumisessa.');
        expect(translateError(undefined)).toBe('Virhe kirjautumisessa.');
    });
});

// ---------------------------------------------------------------------------
// pickLang
// ---------------------------------------------------------------------------
describe('pickLang', () => {
    test('picks the requested language', () => {
        expect(pickLang('{"fi":"Hei","en":"Hello"}', 'fi')).toBe('Hei');
    });

    test('falls back to English', () => {
        expect(pickLang('{"en":"Hello","sv":"Hej"}', 'fi')).toBe('Hello');
    });

    test('falls back to first value if no en', () => {
        expect(pickLang('{"sv":"Hej","de":"Hallo"}', 'fi')).toBe('Hej');
    });

    test('returns empty string for null/undefined input', () => {
        expect(pickLang(null, 'fi')).toBe('');
        expect(pickLang(undefined, 'fi')).toBe('');
        expect(pickLang('', 'fi')).toBe('');
    });

    test('returns plain string if not valid JSON', () => {
        expect(pickLang('just a plain string', 'fi')).toBe('just a plain string');
    });

    test('returns empty string for empty JSON object', () => {
        expect(pickLang('{}', 'fi')).toBe('');
    });
});

// ---------------------------------------------------------------------------
// sanitizeOtpCode
// ---------------------------------------------------------------------------
describe('sanitizeOtpCode', () => {
    test('strips spaces', () => {
        expect(sanitizeOtpCode('1 2 3 4 5 6')).toBe('123456');
    });

    test('strips tabs and newlines', () => {
        expect(sanitizeOtpCode('12\t34\n56')).toBe('123456');
    });

    test('returns empty string for null/undefined', () => {
        expect(sanitizeOtpCode(null)).toBe('');
        expect(sanitizeOtpCode(undefined)).toBe('');
    });

    test('returns value unchanged if no whitespace', () => {
        expect(sanitizeOtpCode('334726')).toBe('334726');
    });
});

// ---------------------------------------------------------------------------
// buildCredentialsBody
// ---------------------------------------------------------------------------
describe('buildCredentialsBody', () => {
    test('builds correct body object', () => {
        expect(buildCredentialsBody('admin', 'pass123', 'fp-hash', 'csrf-abc')).toEqual({
            username: 'admin',
            password: 'pass123',
            fingerprint: 'fp-hash',
            csrf_token: 'csrf-abc',
        });
    });

    test('handles empty strings', () => {
        expect(buildCredentialsBody('', '', '', '')).toEqual({
            username: '',
            password: '',
            fingerprint: '',
            csrf_token: '',
        });
    });
});

// ---------------------------------------------------------------------------
// buildOtpBody
// ---------------------------------------------------------------------------
describe('buildOtpBody', () => {
    test('builds correct body object', () => {
        expect(buildOtpBody('334726', 'csrf-xyz')).toEqual({
            otp_code: '334726',
            csrf_token: 'csrf-xyz',
        });
    });
});

// ---------------------------------------------------------------------------
// buildPasswordResetRequestBody
// ---------------------------------------------------------------------------
describe('buildPasswordResetRequestBody', () => {
    test('builds correct body object', () => {
        expect(buildPasswordResetRequestBody('admin@example.com', 'csrf-xyz')).toEqual({
            identifier: 'admin@example.com',
            csrf_token: 'csrf-xyz',
        });
    });
});

// ---------------------------------------------------------------------------
// buildPasswordResetBody
// ---------------------------------------------------------------------------
describe('buildPasswordResetBody', () => {
    test('builds correct body object', () => {
        expect(buildPasswordResetBody('334726', 'new-secret', 'csrf-xyz')).toEqual({
            otp_code: '334726',
            new_password: 'new-secret',
            csrf_token: 'csrf-xyz',
        });
    });
});

// ---------------------------------------------------------------------------
// formatOtpError
// ---------------------------------------------------------------------------
describe('formatOtpError', () => {
    test('appends attempts remaining', () => {
        expect(formatOtpError('Virheellinen koodi.', 3)).toBe(
            'Virheellinen koodi. (3 yritystä jäljellä)'
        );
    });

    test('appends zero attempts remaining', () => {
        expect(formatOtpError('Virheellinen koodi.', 0)).toBe(
            'Virheellinen koodi. (0 yritystä jäljellä)'
        );
    });

    test('returns message unchanged when attempts is undefined', () => {
        expect(formatOtpError('Virheellinen koodi.', undefined)).toBe('Virheellinen koodi.');
    });

    test('returns message unchanged when attempts is negative', () => {
        expect(formatOtpError('Virheellinen koodi.', -1)).toBe('Virheellinen koodi.');
    });
});

// ---------------------------------------------------------------------------
// resolvePostLoginTarget
// ---------------------------------------------------------------------------
describe('resolvePostLoginTarget', () => {
    test('prefers the login redirect query over the API fallback', () => {
        expect(resolvePostLoginTarget(
            '?redirect=%2Fapp_service_catalog%3Fservice_id%3D108',
            '/',
            'https://example.com'
        )).toBe('/app_service_catalog?service_id=108');
    });

    test('falls back to the API redirect when no redirect query is present', () => {
        expect(resolvePostLoginTarget(
            '',
            '/app_service_catalog/108',
            'https://example.com'
        )).toBe('/app_service_catalog/108');
    });

    test('rejects external redirect queries and keeps the API fallback', () => {
        expect(resolvePostLoginTarget(
            '?redirect=https%3A%2F%2Fevil.example%2Fsteal',
            '/',
            'https://example.com'
        )).toBe('/');
    });

    test('rejects scheme-relative redirect queries', () => {
        expect(resolvePostLoginTarget(
            '?redirect=%2F%2Fevil.example%2Fsteal',
            '/',
            'https://example.com'
        )).toBe('/');
    });

    test('falls back to / when neither redirect source is safe', () => {
        expect(resolvePostLoginTarget(
            '?redirect=javascript%3Aalert(1)',
            'https://evil.example/steal',
            'https://example.com'
        )).toBe('/');
    });
});

// ---------------------------------------------------------------------------
// computeStandaloneLoginBackTarget
// ---------------------------------------------------------------------------
describe('computeStandaloneLoginBackTarget', () => {
    test('returns an exact same-origin public referrer as a relative URL', () => {
        expect(computeStandaloneLoginBackTarget(
            'https://example.com/service_catalog?view=card#results',
            'https://example.com',
            ''
        )).toBe('/service_catalog?view=card#results');
    });

    test.each([
        '/admin/site_languages',
        '/api/get-results',
        '/first-run',
        '/login',
        '/register',
        '/system/ready',
        '/?login-entry=1',
        '/?register-entry=1',
    ])('falls back home for a non-public referrer: %s', (path) => {
        expect(computeStandaloneLoginBackTarget(
            `https://example.com${path}`,
            'https://example.com',
            ''
        )).toBe('/');
    });

    test('rejects an external referrer including an origin-prefix lookalike', () => {
        expect(computeStandaloneLoginBackTarget(
            'https://example.com.evil.test/service_catalog',
            'https://example.com',
            ''
        )).toBe('/');
    });

    test.each([
        '?redirect=%2Fadmin%2Fsite_languages',
        '?auth_notice=session-ended',
    ])('falls back home when login was entered from an auth redirect: %s', (search) => {
        expect(computeStandaloneLoginBackTarget(
            'https://example.com/service_catalog',
            'https://example.com',
            search
        )).toBe('/');
    });

    test('falls back home without a valid referrer', () => {
        expect(computeStandaloneLoginBackTarget('', 'https://example.com', '')).toBe('/');
    });
});
