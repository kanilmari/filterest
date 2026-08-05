// dev_lang_key_editor.test.js
// Unit tests for the dev lang-key editor AI-fill helpers.
// Bridges editor textarea DOM state and dev AI translation request payloads.
// Exists so AI Translate fills missing translations without overwriting polished copy.
import { describe, expect, it } from 'vitest';
import {
    applyDevLangEditorAIResultToEmptyFields,
    buildDevLangEditorAITranslateRequest,
} from './dev_lang_key_editor.js';

function createEditorOverlay() {
    const overlay = document.createElement('div');
    overlay.innerHTML = `
        <textarea data-field="usage_explanation">Table 'app_service_catalog'</textarea>
        <textarea data-lang="fi">Etsi palveluita</textarea>
        <textarea data-lang="en">Search for services</textarea>
        <textarea data-lang="ch"></textarea>
        <textarea data-lang="yue"></textarea>
    `;
    return overlay;
}

describe('dev lang-key editor AI fill helpers', () => {
    it('sends existing editor translations as AI source context', () => {
        const request = buildDevLangEditorAITranslateRequest('search_for_app_service_catalog', createEditorOverlay());

        expect(request).toEqual({
            lang_key: 'search_for_app_service_catalog',
            usage_explanation: "Table 'app_service_catalog'",
            fi: 'Etsi palveluita',
            en: 'Search for services',
            ch: '',
            yue: '',
        });
    });

    it('fills only empty fields from AI suggestions', () => {
        const overlay = createEditorOverlay();

        const filledCount = applyDevLangEditorAIResultToEmptyFields(overlay, {
            fi: "Taulukko 'app_service_catalog'",
            en: "Table 'app_service_catalog'",
            ch: '搜索服务',
            yue: '搜尋服務',
        });

        expect(filledCount).toBe(2);
        expect(overlay.querySelector('textarea[data-lang="fi"]').value).toBe('Etsi palveluita');
        expect(overlay.querySelector('textarea[data-lang="en"]').value).toBe('Search for services');
        expect(overlay.querySelector('textarea[data-lang="ch"]').value).toBe('搜索服务');
        expect(overlay.querySelector('textarea[data-lang="yue"]').value).toBe('搜尋服務');
    });
});
