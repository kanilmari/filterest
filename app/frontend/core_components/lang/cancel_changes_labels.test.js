// @vitest-environment jsdom
// cancel_changes_labels.test.js
// Executes the production label declarations for every J8 discard call site.
// Connects those declarations, shared builders and the real FI/EN page translator.
// Keeps label regressions small without booting unrelated settings and media APIs.
import { afterEach, expect, test, vi } from 'vitest';
import { runInNewContext } from 'node:vm';

vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn(async () => ({})) }));
vi.mock('../table_views/card_view/card_view_printer.js', () => ({ refreshCardLanguages: vi.fn(async () => {}) }));
vi.mock('./dev_lang_key_editor.js', () => ({ initDevLangKeyEditor: vi.fn() }));
vi.mock('../../reusable_components/notifications/toast_notification_printer.js', () => ({ showWarningToast: vi.fn(), showToast: vi.fn() }));
vi.mock('../../icons/icon_loader.js', () => ({ setElementSvgContent: vi.fn(async () => {}) }));

import { getTranslationForKey, translatePage } from './translation_handler.js';
import { setLanguage } from '../state_stores/lang_preference_reader.js';
import { setDatasetFormText } from '../general_tables/dataset_form/dataset_form_text.js';
import { hideModal } from '../../reusable_components/modal/modal_builder.js';
import { showConfirmModal } from '../../reusable_components/modal/confirm_modal_builder.js';

// Raw imports also connect every label owner to automatic relevant-check discovery.
import assetLinkingSource from '../admin_tools/asset_linking/asset_linking_view.js?raw';
import foreignKeysSource from '../admin_tools/foreign_keys_view.js?raw';
import rowSubmissionSource from '../general_tables/gt_1_row_crud/gt_1_1_row_create/row_submission_handler.js?raw';
import articleLanguagesSource from '../table_views/article_view/article_language_editor.js?raw';
import attachmentsSource from '../table_views/card_view/row_article_attachment_list.js?raw';
import imageMetadataSource from '../table_views/card_view/row_article_image_metadata_editor.js?raw';
import articleOpenerSource from '../table_views/card_view/row_article_opener.js?raw';
import renameTreeSource from '../vanilla_tree/van_tr_components/tree_node_rename_editor.js?raw';
import rowAccessSource from '../admin_tools/row_access_editor.js?raw';
import rowGroupsSource from '../admin_tools/row_group_assignment_editor.js?raw';
import datasetFormSource from '../general_tables/dataset_form/dataset_form.js?raw';
import permissionsSource from '../admin_tools/permission_editor.js?raw';
import cardVisibilitySource from '../admin_tools/card_visibility_view.js?raw';
import childTabsSource from '../admin_tools/child_tab_config_view.js?raw';
import devLanguagesSource from './dev_lang_key_editor.js?raw';
import fieldViewSource from '../admin_tools/field_view_editor.js?raw';

const copy = { fi: 'Peruuta muutokset', en: 'Cancel changes' };
const sourceByPath = {
    'core_components/admin_tools/asset_linking/asset_linking_view.js': assetLinkingSource,
    'core_components/admin_tools/foreign_keys_view.js': foreignKeysSource,
    'core_components/general_tables/gt_1_row_crud/gt_1_1_row_create/row_submission_handler.js': rowSubmissionSource,
    'core_components/table_views/article_view/article_language_editor.js': articleLanguagesSource,
    'core_components/table_views/card_view/row_article_attachment_list.js': attachmentsSource,
    'core_components/table_views/card_view/row_article_image_metadata_editor.js': imageMetadataSource,
    'core_components/table_views/card_view/row_article_opener.js': articleOpenerSource,
    'core_components/vanilla_tree/van_tr_components/tree_node_rename_editor.js': renameTreeSource,
    'core_components/admin_tools/row_access_editor.js': rowAccessSource,
    'core_components/admin_tools/row_group_assignment_editor.js': rowGroupsSource,
    'core_components/general_tables/dataset_form/dataset_form.js': datasetFormSource,
    'core_components/admin_tools/permission_editor.js': permissionsSource,
    'core_components/admin_tools/card_visibility_view.js': cardVisibilitySource,
    'core_components/admin_tools/child_tab_config_view.js': childTabsSource,
    'core_components/lang/dev_lang_key_editor.js': devLanguagesSource,
    'core_components/admin_tools/field_view_editor.js': fieldViewSource,
};
const source = path => sourceByPath[path];
const direct = [
    ['core_components/admin_tools/asset_linking/asset_linking_view.js', 'cancelButton'],
    ['core_components/admin_tools/foreign_keys_view.js', 'cancelButton'],
    ['core_components/general_tables/gt_1_row_crud/gt_1_1_row_create/row_submission_handler.js', 'cancel_button'],
    ['core_components/table_views/article_view/article_language_editor.js', 'cancel'],
    ['core_components/table_views/card_view/row_article_attachment_list.js', 'cancelButton'],
    ['core_components/table_views/card_view/row_article_image_metadata_editor.js', 'resetButton'],
    ['core_components/table_views/card_view/row_article_opener.js', 'cancelButton'],
    ['core_components/vanilla_tree/van_tr_components/tree_node_rename_editor.js', 'cancelBtn'],
];

async function language(code) {
    document.body.replaceChildren();
    document.documentElement.lang = code;
    setLanguage(code);
    window.translationPromises = Object.fromEntries(Object.entries(copy).map(([key, text]) =>
        [key, Promise.resolve({ cancel_changes: text, cancel: key === 'fi' ? 'Peruuta' : 'Cancel', close: 'Close' })]));
    await translatePage(code);
}

afterEach(() => {
    hideModal();
    document.body.replaceChildren();
    delete window.translationPromises;
    localStorage.clear();
});

for (const code of ['fi', 'en']) {
    test.each(['dictionary', 'fallback', 'authored'])(`field editor renders %s discard copy in ${code}`, async mode => {
        await language(code);
        const authored = code === 'fi' ? 'Oma peruutusteksti' : 'Site discard text';
        const lookup = vi.fn((key, options = {}) => {
            if (mode === 'fallback') return options.fallback;
            if (mode === 'authored' && key === 'cancel_changes') return authored;
            return getTranslationForKey(key, options);
        });
        const definitions = fieldViewSource.slice(fieldViewSource.indexOf('const FIELD_VIEW_TEXT'),
            fieldViewSource.indexOf('function resolveLockText('));
        const text = runInNewContext(`${definitions}\nuiText()`, {
            getLanguageWithBrowserFallback: () => code, getTranslationForKey: lookup,
        });
        const node = document.createElement('button');
        const assignments = fieldViewSource.match(/^\s*cancelButton\.(?:dataset\.langKey|textContent)\s*=.*;/gm);
        runInNewContext(assignments.join('\n'), { cancelButton: node, text });
        expect(lookup).toHaveBeenCalledWith('cancel_changes', { fallback: copy[code] });
        expect(node.dataset.langKey).toBe('cancel_changes');
        expect(node.textContent).toBe(mode === 'authored' ? authored : copy[code]);
        document.body.append(node);
        await translatePage(code);
        expect(node.textContent).toBe(copy[code]);
    });

    test.each(direct)(`%s renders the discard label in ${code}`, async (path, variable) => {
        await language(code);
        const node = document.createElement('button');
        // Execute the actual assignments, including the real key and fallback.
        const statements = source(path).match(new RegExp(`^\\s*${variable}\\.(?:dataset\\.langKey|textContent)\\s*=.*;`, 'gm'));
        expect(statements?.join('\n')).toContain('cancel_changes');
        runInNewContext(statements.join('\n'), {
            [variable]: node, getTranslationForKey,
            copy: (key, fallback) => getTranslationForKey(key, { fallback }),
        });
        document.body.append(node);
        await translatePage(code);
        expect(node.textContent).toBe(copy[code]);
    });

    test(`row permissions, row groups and dataset form builders render ${code}`, async () => {
        await language(code);
        const rowAccess = source('core_components/admin_tools/row_access_editor.js');
        const rowGroups = source('core_components/admin_tools/row_group_assignment_editor.js');
        const dataset = source('core_components/general_tables/dataset_form/dataset_form.js');
        const cases = [
            [rowAccess.slice(rowAccess.indexOf('function translatedText('), rowAccess.indexOf('function translatedVariableText(')),
                rowAccess.match(/const cancelButton = (createTranslatedElement\([^;]+\));/)[1]],
            [rowGroups.slice(rowGroups.indexOf('function text('), rowGroups.indexOf('function invalidResponse(')),
                rowGroups.match(/const cancel = (button\([^;]+\));/)[1]],
            [dataset.slice(dataset.indexOf('function button('), dataset.indexOf('function hint(')),
                dataset.match(/const cancel = (button\([^;]+\));/)[1]],
        ];
        for (const [helpers, expression] of cases) {
            expect(expression).toContain('cancel_changes');
            const node = runInNewContext(`${helpers}\n${expression}`, { document, getTranslationForKey, setDatasetFormText });
            expect(node.dataset.langKey).toBe('cancel_changes');
            expect(node.textContent).toBe(copy[code]);
        }
    });

    test(`both permission tables and card settings pass translated ${code} cancelLabel`, async () => {
        await language(code);
        for (const [path, count] of [['permission_editor.js', 2], ['card_visibility_view.js', 1]]) {
            const expressions = [...source(`core_components/admin_tools/${path}`).matchAll(/cancelLabel: (.*),/g)];
            expect(expressions).toHaveLength(count);
            for (const [, expression] of expressions) {
                expect(expression).toContain('cancel_changes');
                expect(runInNewContext(expression, { getTranslationForKey })).toBe(copy[code]);
            }
        }
    });

    test(`all five save-or-discard prompts pass ${code} copy to the shared modal`, async () => {
        await language(code);
        for (const [path, count] of [['permission_editor.js', 1], ['card_visibility_view.js', 1], ['child_tab_config_view.js', 3]]) {
            const options = [...source(`core_components/admin_tools/${path}`).matchAll(/cancelLangKey: (['"]cancel_changes['"]),\s*cancelText: (['"][^'"\n]+['"]),/g)];
            expect(options).toHaveLength(count);
            for (const [, key, text] of options) {
                const result = showConfirmModal(runInNewContext(`({cancelLangKey: ${key}, cancelText: ${text}})`));
                await translatePage(code);
                const cancel = document.querySelector('[data-testid="confirm-modal-cancel-button"]');
                expect(cancel.textContent).toBe(copy[code]);
                cancel.click();
                expect(await result).toBe(false);
            }
        }
    });

    test(`the development translation editor marks its discard button for ${code}`, async () => {
        await language(code);
        const html = source('core_components/lang/dev_lang_key_editor.js').match(/<button class="dev-lang-editor-cancel"[^>]*>[^<]*<\/button>/)[0];
        document.body.innerHTML = html;
        await translatePage(code);
        expect(document.querySelector('button').textContent).toBe(copy[code]);
    });
}
