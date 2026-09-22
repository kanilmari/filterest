// @vitest-environment jsdom
// dataset_form_text.test.js
// Verifies the dataset form's one text helper: its language order, its
// placeholders and the in-place retranslation of an open form.
// Exists so both modes, every setting control and the removal dialog name
// things the same way in Finnish, English, Chinese and Cantonese.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const runtime = {};
vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback } = {}) => runtime[key] ?? fallback,
}));

const { datasetFormText, observeDatasetFormLanguage, setDatasetFormText } = await import('./dataset_form_text.js');
const { DATASET_FORM_TRANSLATION_FALLBACKS } = await import('./dataset_form_translation_fallbacks.js');

beforeEach(() => {
    for (const key of Object.keys(runtime)) delete runtime[key];
    document.body.replaceChildren();
    document.documentElement.lang = 'en';
});

describe('dataset form text', () => {
    test('every text of the form has Finnish, English, Chinese and Cantonese copy', () => {
        for (const [key, copy] of Object.entries(DATASET_FORM_TRANSLATION_FALLBACKS)) {
            for (const language of ['fi', 'en', 'ch', 'yue']) {
                expect(copy[language], `${key}.${language}`).toBeTruthy();
            }
        }
    });

    test('the site’s reviewed translation comes first, then the form’s copy in the page language', () => {
        document.documentElement.lang = 'fi';
        expect(datasetFormText('dataset_new_folder_parent')).toBe('Uuden kansion yläkansio');
        runtime.dataset_new_folder_parent = 'Yläkansio uudelle kansiolle';
        expect(datasetFormText('dataset_new_folder_parent')).toBe('Yläkansio uudelle kansiolle');
        document.documentElement.lang = 'zh-HK';
        delete runtime.dataset_new_folder_parent;
        expect(datasetFormText('dataset_new_folder_parent')).toBe('新資料夾嘅上層資料夾');
        expect(datasetFormText('no_such_key')).toBe('no_such_key');
    });

    test('placeholders are filled by the form, in whichever language is shown', () => {
        expect(datasetFormText('dataset_created_in_folder', { dataset: 'blogs', folder: 'apps / fintravel' }))
            .toBe('Dataset blogs was created in the folder apps / fintravel.');
    });

    test('an open form is retranslated in place, values and all, and stops when disposed', async () => {
        const form = document.createElement('form');
        const plain = setDatasetFormText(document.createElement('span'), 'dataset_new_folder_open');
        const filled = setDatasetFormText(document.createElement('p'), 'dataset_created_in_folder', { dataset: 'blogs', folder: 'x' });
        form.append(plain, filled);
        document.body.appendChild(form);
        // Only a text without values may be left to the page's own translator.
        expect(plain.dataset.langKey).toBe('dataset_new_folder_open');
        expect(filled.dataset.langKey).toBeUndefined();

        const dispose = observeDatasetFormLanguage(form);
        document.documentElement.lang = 'fi';
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(plain.textContent).toBe('Uusi kansio…');
        expect(filled.textContent).toBe('Aineisto blogs luotiin kansioon x.');

        dispose();
        document.documentElement.lang = 'en';
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(plain.textContent).toBe('Uusi kansio…');
    });
});
