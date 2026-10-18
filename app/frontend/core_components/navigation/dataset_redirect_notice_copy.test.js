// dataset_redirect_notice_copy.test.js
// Verifies every startup redirect sentence in Finnish and English.
// Connects stable notice keys and language tags to the page translator catalogue.
// Protects name placeholders and unknown-key fallback without a browser or server.
import { describe, expect, test } from 'vitest';
import {
    DATASET_REDIRECT_NOTICE_TRANSLATION_FALLBACKS as copy,
    resolveDatasetRedirectNoticeFallback as resolve,
} from './dataset_redirect_notice_copy.js';

describe('dataset redirect startup copy', () => {
    test.each(Object.entries(copy))('%s resolves both languages and keeps names as placeholders', (key, texts) => {
        for (const language of ['fi', 'en']) {
            expect(resolve(key, language)).toBe(texts[language]);
            expect(texts[language].includes('$table_name')).toBe(key.endsWith('_named'));
            expect(texts[language]).not.toBe(key);
        }
        expect(resolve(key, ' FI-fi ')).toBe(texts.fi);
        expect(resolve(key, 'en-GB')).toBe(texts.en);
        expect(resolve(key, 'de')).toBe(texts.en);
        expect(resolve(key)).toBe(texts.en);
    });
    test('an unknown key has no bootstrap sentence', () => {
        expect(resolve('unknown')).toBe('');
    });
});
