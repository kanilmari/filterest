import { describe, test, expect } from 'vitest';
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
    computeCloseTarget,
} from './login_page_builder_helpers.js';

// ---------------------------------------------------------------------------
// translateError
// ---------------------------------------------------------------------------
describe('translateError', () => {
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
// computeCloseTarget
// ---------------------------------------------------------------------------
describe('computeCloseTarget', () => {
    test('returns referrer if same origin and different path', () => {
        expect(computeCloseTarget(
            'https://example.com/dashboard',
            'https://example.com',
            '/login'
        )).toBe('https://example.com/dashboard');
    });

    test('returns / if referrer is same page', () => {
        expect(computeCloseTarget(
            'https://example.com/login',
            'https://example.com',
            '/login'
        )).toBe('/');
    });

    test('returns / if referrer is different origin', () => {
        expect(computeCloseTarget(
            'https://other.com/page',
            'https://example.com',
            '/login'
        )).toBe('/');
    });

    test('returns / if referrer is empty', () => {
        expect(computeCloseTarget('', 'https://example.com', '/login')).toBe('/');
    });

    test('returns / if referrer is null', () => {
        expect(computeCloseTarget(null, 'https://example.com', '/login')).toBe('/');
    });
});
