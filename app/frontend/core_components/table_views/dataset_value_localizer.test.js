// @vitest-environment jsdom
// dataset_value_localizer.test.js
// Verifies conservative multilingual resolution and live dataset-view language refreshes.
// Covers raw scalar/JSON values, explicit column metadata, and registered DOM renderers.
// Exists to prevent either raw language JSON leaks or accidental collapsing of ordinary JSON fields.

import { beforeEach, describe, expect, test } from 'vitest';
import {
    bindDatasetLanguageRenderer,
    refreshLocalizedDatasetValues,
    resolveDatasetDisplayValue,
    setLocalizedDatasetText,
} from './dataset_value_localizer.js';

describe('dataset_value_localizer', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
    });

    test('shows only the active language for metadata-backed string and object payloads', () => {
        const metadata = { is_multilingual: true };
        expect(resolveDatasetDisplayValue('{"en":"Services","fi":"Palvelut"}', metadata, 'fi')).toBe('Palvelut');
        expect(resolveDatasetDisplayValue({ en: 'Services', yue: '服務' }, metadata, 'yue')).toBe('服務');
    });

    test('uses English and then the first available translation as controlled fallbacks', () => {
        const metadata = { is_multilingual: true };
        expect(resolveDatasetDisplayValue('{"fi":"Palvelut","en":"Services"}', metadata, 'sv')).toBe('Services');
        expect(resolveDatasetDisplayValue('{"fi":"Palvelut","yue":"服務"}', metadata, 'sv')).toBe('Palvelut');
    });

    test('preserves ordinary JSON when metadata explicitly says the field is not multilingual', () => {
        const rawValue = '{"name":"test","value":"x"}';
        expect(resolveDatasetDisplayValue(rawValue, { is_multilingual: false }, 'name')).toBe(rawValue);
    });

    test('uses a conservative language-key heuristic only when metadata is missing', () => {
        expect(resolveDatasetDisplayValue('{"en":"Services","fi":"Palvelut"}', null, 'fi')).toBe('Palvelut');
        expect(resolveDatasetDisplayValue('{"name":"test","value":"x"}', null, 'name')).toBe('{"name":"test","value":"x"}');
    });

    test('refreshes text and whole-view renderers through one shared language pass', async () => {
        const text = document.createElement('span');
        const view = document.createElement('section');
        document.body.append(text, view);

        setLocalizedDatasetText(text, { en: 'Services', fi: 'Palvelut' }, { is_multilingual: true });
        bindDatasetLanguageRenderer(view, (language) => {
            view.textContent = `view:${language}`;
        }, 'en');

        await refreshLocalizedDatasetValues('fi');

        expect(text.textContent).toBe('Palvelut');
        expect(view.textContent).toBe('view:fi');
    });
});
