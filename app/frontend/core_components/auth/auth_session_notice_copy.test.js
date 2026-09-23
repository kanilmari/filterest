// @vitest-environment jsdom
// auth_session_notice_copy.test.js
// Verifies the bootstrap sentences the login page shows before translations load.
// Between a person whose sign-in ended and a site whose reviewed translations for
// these keys may not exist yet.
// Exists so this explanation never falls back to one language or to a key name.

import { describe, expect, test } from 'vitest';
import {
    AUTH_SESSION_NOTICE_TRANSLATION_FALLBACKS,
    resolveAuthSessionNoticeFallback,
} from './auth_session_notice_copy.js';

const SUPPORTED_LANGUAGES = ['fi', 'en', 'ch', 'yue'];

describe('auth session notice copy', () => {
    test.each(Object.keys(AUTH_SESSION_NOTICE_TRANSLATION_FALLBACKS))(
        '%s carries copy in every supported language',
        (langKey) => {
            const copy = AUTH_SESSION_NOTICE_TRANSLATION_FALLBACKS[langKey];
            expect(Object.keys(copy).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
            SUPPORTED_LANGUAGES.forEach((language) => {
                expect(typeof copy[language]).toBe('string');
                expect(copy[language].trim().length).toBeGreaterThan(0);
            });
        },
    );

    test.each([
        ['fi', 'fi'],
        ['fi-FI', 'fi'],
        ['en', 'en'],
        ['en-GB', 'en'],
        ['ch', 'ch'],
        ['zh', 'ch'],
        ['zh-CN', 'ch'],
        ['yue', 'yue'],
        ['zh-HK', 'yue'],
    ])('reads %s as the %s text', (languageTag, expectedLanguage) => {
        expect(resolveAuthSessionNoticeFallback('session_ended_sign_in_again', languageTag))
            .toBe(AUTH_SESSION_NOTICE_TRANSLATION_FALLBACKS.session_ended_sign_in_again[expectedLanguage]);
    });

    test('falls back to English for a language nobody translated', () => {
        expect(resolveAuthSessionNoticeFallback('session_ended_sign_in_again', 'sv'))
            .toBe(AUTH_SESSION_NOTICE_TRANSLATION_FALLBACKS.session_ended_sign_in_again.en);
    });

    test('has nothing to say about an unknown key', () => {
        expect(resolveAuthSessionNoticeFallback('not_a_notice', 'fi')).toBe('');
        expect(resolveAuthSessionNoticeFallback('', 'fi')).toBe('');
    });
});
