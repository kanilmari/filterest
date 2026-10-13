// card_and_filterbar_language_rendering.test.js
// Exercises actual card and filterbar renderers against the migration's dictionaries.
// Connects Finnish/English live language changes to selected sorts, dataset names and empty dates.
// Proves each card path uses one accessible placeholder without a database or network.
// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { translatePage } from '../../lang/translation_handler.js';
import { createSingleCard } from './card_row_builder.js';
import { renderDatasetAppearance } from '../dataset_appearance_renderer.js';
import { DEFAULT_DATASET_APPEARANCE } from '../../../shared/dataset_appearance/validator.js';
import { disposeCardResources } from './card_resource_lifecycle.js';
import { buildRowArticleContent } from './row_article_content_builder.js';
import { ROW_ARTICLE_PERMISSION_ROUTES } from './row_article_permission_checker.js';
import { renderModernCardDetails } from './card_detail_tile_builder.js';
import { renderSingleLineCardDetails } from './card_detail_single_line_helpers.js';
import { createKeyValueElement, enableEditing, disableEditing, cancelEditing } from './card_field_formatter.js';
import { createRowArticleNavigableElement } from './row_article_ui_handler.js';
import { createKvPairBuilders } from '../../../reusable_components/key_value_container/kv_pair_builder.js';
import { createSortDropdown } from '../../filterbar/top_row_buttons/sort_dropdown_builder.js';
import { createAddRowButton } from '../../general_tables/gt_toolbar/toolbar_button_creator.js';
import { createFieldViewEditorButton, openFieldViewEditor } from '../../admin_tools/field_view_editor.js';
import { getMainTabLangKey } from '../../navigation/main_tabs/main_tab_lang_keys.js';
import { setResultsCount } from '../../../reusable_components/results_count/results_count_printer.js';

vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn(async () => ({})) }));
vi.mock('./card_view_printer.js', () => ({ refreshCardLanguages: vi.fn() }));
vi.mock('../../lang/dev_lang_key_editor.js', () => ({ initDevLangKeyEditor: vi.fn() }));
vi.mock('../../dev_tools/function_counter.js', () => ({ count_this_function: vi.fn() }));
vi.mock('./row_article_presentation_settings.js', () => ({
    resolveRowArticleTimestampDisplayOptions: vi.fn(async () => ({ locale: 'fi' })),
}));
vi.mock('../../endpoints/stable_endpoint_router.js', async importOriginal => ({
    ...await importOriginal(), fetchCardVisibility: vi.fn(async () => ({ columns: [] })),
}));
vi.mock('../../filterbar/top_row_buttons/dataset_sort_default_controller.js', () => ({
    applyDatasetSortDefault: vi.fn(), createDatasetSortDefaultAction: vi.fn(() => null),
}));
vi.mock('../../filterbar/top_row_buttons/sort_sync_state.js', () => ({
    getDatasetSortSelection: () => '__newest:DESC', emitDatasetSortSelection: vi.fn(),
    subscribeDatasetSortSelection: (_name, callback) => { callback('__newest:DESC'); return () => {}; },
}));

// The authored migration is the copy authority; assertions below independently
// check the Finnish and English text the owner expects to see.
const seed = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../server_tools/migrations/20261013000002_seed_card_and_filterbar_language_keys.sql'), 'utf8');
const copy = Object.fromEntries(['fi', 'en', 'ch', 'yue'].map((language, index) => [language,
    Object.fromEntries(seed.split('\n').filter(line => line.startsWith("    ('")).slice(0, 23).map(line => {
        const values = [...line.matchAll(/'((?:''|[^'])*)'/g)].map(match => match[1].replaceAll("''", "'"));
        return [values[0], values[[1, 2, 3, 5][index]]];
    })),
]));
let sort;

beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
    // These rendering fixtures exercise administrator-visible Details. Guest
    // delivery has its own real-bootstrap regression in the content builder tests.
    sessionStorage.setItem('user_permissions', JSON.stringify(Object.values(ROW_ARTICLE_PERMISSION_ROUTES)));
    window.translationPromises = Object.fromEntries(Object.entries(copy).map(([language, dictionary]) =>
        [language, Promise.resolve({ ...dictionary,
            // Existing heading/search copy must not decide the count's grammar.
            result: 'Site result heading', results: 'Tulokset',
            result_in_text_search: 'Text heading', results_in_text_search: 'Text headings',
            result_in_ai_search: 'AI heading', results_in_ai_search: 'AI headings',
            travel_deals: language === 'fi' ? 'Matkatarjoukset' : 'Travel deals',
            users: language === 'fi' ? 'Käyttäjät' : 'Users' })]));
});
afterEach(() => { sort?.destroy(); sort = null; document.body.replaceChildren(); });

test('selected sort, every built-in option and count follow live Finnish/English switches', async () => {
    sort = createSortDropdown('demo', ['updated'], {});
    document.body.append(sort);
    const count = document.createElement('div'); count.id = 'demo_results_count'; document.body.append(count);
    setResultsCount('demo', 124);
    const trigger = sort.querySelector('.vdw-dropdown-input');
    for (const [language, label, results] of [['fi', 'Uusimmat ensin', '124 tulosta'], ['en', 'Newest first', '124 results'], ['fi', 'Uusimmat ensin', '124 tulosta']]) {
        await translatePage(language);
        expect(trigger.value).toBe(label);
        expect(count.textContent).toBe(results);
        trigger.click();
        for (const key of ['sort_newest', 'sort_oldest', 'sort_updated_newest', 'sort_updated_oldest', 'sort_images_first', 'search_relevance']) {
            const option = document.body.querySelector(`.vdw-option [data-lang-key="${key}"], .vdw-option[data-lang-key="${key}"]`);
            expect(option.textContent).toBe(copy[language][key]);
        }
        trigger.click();
    }
});

test('dedicated count keys translate singular, plural and search breakdowns despite existing headings', async () => {
    const count = document.createElement('div'); count.id = 'demo_results_count'; document.body.append(count);
    for (const [value, expected] of [
        [1, '1 tulos'], [2, '2 tulosta'], [0, '0 tulosta'],
        [{ mode: 'search-breakdown', textCount: 1, aiCount: 2 }, '1 tulos tekstihaulla + 2 tulosta tekoälyhaulla'],
        [{ mode: 'search-breakdown', textCount: 2, aiCount: 1 }, '2 tulosta tekstihaulla + 1 tulos tekoälyhaulla'],
    ]) {
        setResultsCount('demo', value);
        await translatePage('fi');
        expect(count.textContent).toBe(expected);
    }
});

test('add-row uses the tab key and editor button/title use dictionary copy in both languages', async () => {
    const add = createAddRowButton(1, 'travel_deals');
    const users = createAddRowButton(2, 'system_users');
    const tab = document.createElement('span'); tab.dataset.langKey = getMainTabLangKey('travel_deals');
    document.body.append(add, users, tab);
    for (const [language, name, people, heading] of [['fi', 'Matkatarjoukset', 'Käyttäjät', 'Muokkaa kenttänäkymää'], ['en', 'Travel deals', 'Users', 'Edit fields view']]) {
        localStorage.setItem('chosen_language', language);
        await translatePage(language);
        expect(add.textContent).toBe(`${language === 'fi' ? 'Lisää rivi' : 'Add row'}: ${tab.textContent}`);
        expect(tab.textContent).toBe(name);
        expect(users.textContent).toContain(people);
        expect(add.dataset.langVariableKey).toBe(getMainTabLangKey('travel_deals'));
        const editor = createFieldViewEditorButton('demo'); document.body.append(editor);
        expect(editor.textContent).toBe(heading);
        await openFieldViewEditor('demo');
        expect(document.querySelector('#custom_modal_title').textContent).toBe(heading);
        expect(document.querySelector('#custom_modal_title').dataset.langKey).toBe('edit_fields_view');
    }
});

test.each(['fi', 'en', 'ch', 'yue'])('empty dates reach the shared dash, tooltip and accessible label in every renderer (%s)', async language => {
    localStorage.setItem('chosen_language', language);
    const metadata = { expiry: { data_type: 'date', card_element: 'details', show_value_on_card: true, show_key_on_card: true } };
    const context = { hasDeleteRight: false, canManageRowAccess: false, canManageRowGroups: false, tableHasImageRole: true, timestampDisplayOptions: {} };
    for (const rawValue of [null, undefined, '']) {
        const row = { id: 1, expiry: rawValue };
        const renderers = {
            list: async host => host.append(await createSingleCard(row, ['expiry'], 'demo', metadata, context)),
            tile: host => renderModernCardDetails(host, [{ column: 'expiry', label: 'Expiry', rawValue }], metadata),
            single: host => renderSingleLineCardDetails(host, [{ column: 'expiry', label: 'Expiry', rawValue }], metadata),
            article: async host => host.append((await buildRowArticleContent(row, 'demo', metadata, ['expiry'], '', '', true)).rowArticleContentElement),
            generic: host => host.append(createKeyValueElement('Expiry', rawValue, 'expiry', false, 'detail', rawValue, metadata.expiry)),
            link: host => host.append(createRowArticleNavigableElement({ label: 'Expiry', value: rawValue, column: 'expiry', href: '/demo/1' })),
            ...Object.fromEntries(Object.entries(createKvPairBuilders({ translate: key => copy[language][key] })).map(([name, build]) =>
                [name, host => host.append(build({ key: 'expiry', value: rawValue }))])),
        };
        for (const [name, render] of Object.entries(renderers)) {
            const host = document.createElement('div'); document.body.append(host);
            await render(host); await translatePage(language);
            const values = host.querySelectorAll('[data-title-lang-key="unknown"]');
            expect(values.length, `${name}: missing empty date`).toBeGreaterThan(0);
            for (const value of values) {
                expect(value.textContent, name).toBe('—');
                expect(value.title, name).toBe(copy[language].unknown);
                expect(value.getAttribute('aria-label'), name).toBe(copy[language].unknown);
                expect(value.querySelector('a'), name).toBeNull();
            }
            host.remove();
        }
    }
});

test.each([
    ['modern', 'conditional_multiline'], ['standard', 'conditional_multiline'],
    ['standard', 'single_line'], ['standard', 'stacked'], ['standard', 'inline'],
])('empty date visibility is independent of card style/layout (%s / %s)', async (style, layout) => {
    localStorage.setItem('chosen_language', 'fi');
    localStorage.setItem('demo_tableMeta', JSON.stringify({ card_style_variant: style, card_details_layout: layout }));
    const field = { data_type: 'date', card_element: 'details', show_value_on_card: true,
        show_key_on_card: true, hide_false_null_on_sml_crd: false, hide_false_null_on_big_crd: false };
    const metadata = { expiry: { ...field }, departure: { ...field } };
    const row = { id: 1, expiry: null, departure: '2026-10-12' };
    const context = { hasDeleteRight: false, canManageRowAccess: false, canManageRowGroups: false,
        tableHasImageRole: true, timestampDisplayOptions: {} };
    const appearance = showAll => ({ ...DEFAULT_DATASET_APPEARANCE,
        shared: { ...DEFAULT_DATASET_APPEARANCE.shared, card_show_all_fields: showAll, card_style_variant: style } });
    const host = document.createElement('div'); document.body.append(host);
    try {
        const card = await createSingleCard(row, ['expiry', 'departure'], 'demo', metadata, context);
        host.append(card);
        // Match a native installation that hides empty fields in its appearance:
        // ordinary field/name visibility cannot override this earlier selection.
        renderDatasetAppearance(card, appearance(false));
        expect(card.querySelector('[data-lang-key="expiry"]')).toBeNull();
        expect(card.querySelector('[data-title-lang-key="unknown"]')).toBeNull();
        expect(card.querySelector('[data-lang-key="departure"]')).not.toBeNull();

        // The opened article is independent of the result card's empty-row gate.
        const article = (await buildRowArticleContent(row, 'demo', metadata, ['expiry', 'departure'], '', '', true)).rowArticleContentElement;
        host.append(article); await translatePage('fi');
        const articleDate = article.querySelector('.two_line_value[data-column="expiry"]');
        expect(articleDate.textContent).toBe('—');
        expect(articleDate.title).toBe(copy.fi.unknown);
        expect(articleDate.getAttribute('aria-label')).toBe(copy.fi.unknown);

        // C16's explicit show-all setting restores the date in the full card
        // builder, including standard conditional KV and the public modern style.
        renderDatasetAppearance(card, appearance(true));
        await translatePage('fi');
        expect(card.querySelector('[data-lang-key="expiry"]')).not.toBeNull();
        const date = card.querySelector('[data-title-lang-key="unknown"]');
        expect(date.textContent).toBe('—');
        expect(date.title).toBe(copy.fi.unknown);
        expect(date.getAttribute('aria-label')).toBe(copy.fi.unknown);
        expect(date.querySelector('a')).toBeNull();
        expect(card.querySelector('[data-lang-key="departure"]')).not.toBeNull();

        // A per-column hide-null choice still wins even with show-all enabled.
        const hidden = await createSingleCard(row, ['expiry', 'departure'], 'demo', {
            ...metadata, expiry: { ...field, hide_false_null_on_sml_crd: true },
        }, context);
        host.append(hidden); renderDatasetAppearance(hidden, appearance(true));
        expect(hidden.querySelector('[data-lang-key="expiry"]')).toBeNull();
        expect(hidden.querySelector('[data-title-lang-key="unknown"]')).toBeNull();
        expect(hidden.querySelector('[data-lang-key="departure"]')).not.toBeNull();
    } finally {
        disposeCardResources(host); host.remove();
    }
});

test.each(['fi', 'en'])('generated creator/owner labels translate through normal field keys (%s)', async language => {
    for (const key of ['created_by_name', 'owner_name (ln)', 'search_for_created_by_name', 'search_for_owner_name (ln)']) {
        const field = document.createElement('span'); field.dataset.langKey = key; document.body.append(field);
        await translatePage(language);
        expect(field.textContent).toBe(copy[language][key]);
    }
});

test.each(['fi', 'en'])('singular and split search counts use the page dictionary (%s)', async language => {
    const host = document.createElement('div'); host.id = 'demo_results_count'; document.body.append(host);
    setResultsCount('demo', 1); await translatePage(language);
    expect(host.textContent).toBe(language === 'fi' ? '1 tulos' : '1 result');
    setResultsCount('demo', { mode: 'search-breakdown', textCount: 1, aiCount: 3 }); await translatePage(language);
    expect(host.textContent).toBe(language === 'fi'
        ? '1 tulos tekstihaulla + 3 tulosta tekoälyhaulla'
        : '1 result in text search + 3 results in AI search');
});

test('empty dates keep their placeholder after edit/cancel and populated dates clear its accessible copy', async () => {
    const metadata = { expiry: { data_type: 'date', editable_in_ui: true } };
    const host = document.createElement('div'); document.body.append(host);
    host.append(createKeyValueElement('Expiry', '', 'expiry', false, 'detail', '', metadata.expiry));
    const value = host.querySelector('[data-column="expiry"]');
    for (const finish of [cancelEditing, disableEditing]) {
        enableEditing(host, 'demo', metadata); finish(host); await translatePage('fi');
        expect(value.textContent).toBe('—'); expect(value.title).toBe('Tuntematon');
        expect(value.getAttribute('aria-label')).toBe('Tuntematon');
    }
    enableEditing(host, 'demo', metadata); value.querySelector('input').value = '2026-10-12';
    const changes = disableEditing(host);
    expect(changes).toEqual({ expiry: '2026-10-12' });
    expect(value.textContent).not.toBe('—');
    expect(value.dataset.titleLangKey).toBeUndefined();
    expect(value.hasAttribute('aria-label')).toBe(false);
});
