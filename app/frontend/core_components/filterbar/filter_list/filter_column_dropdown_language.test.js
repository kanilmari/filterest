// filter_column_dropdown_language.test.js
// Verifies all shared filter dropdown labels during Finnish/English language switching.
// Connects the real translation refresh to retained raw options and stable multiselect nodes.
// Prevents language changes from resetting queries, focus or include/exclude selections.
// @vitest-environment jsdom

import { afterEach, expect, test, vi } from 'vitest';
import { createColumnFilterInput } from './filter_column_input_builder.js';
import { translatePage } from '../../lang/translation_handler.js';

vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
vi.mock('../../table_views/card_view/card_view_printer.js', () => ({ refreshCardLanguages: vi.fn() }));
vi.mock('../../../reusable_components/notifications/toast_notification_printer.js', () => ({ showToast: vi.fn() }));
vi.mock('../../lang/dev_lang_key_editor.js', () => ({ initDevLangKeyEditor: vi.fn() }));

const copy = {
    fi: { search: 'Haku', selected: 'valittu', excluded: 'poissuljettu', no_results: 'Ei tuloksia',
        clear_selection: 'Tyhjennä valinta', filter_value_placeholder: 'Suodata arvoa',
        exclude: 'Poissulje', reset: 'Palauta', priority: 'Tärkeys',
        exclude_filter_option: 'Poissulje arvo', reset_filter_option: 'Palauta arvo' },
    en: { search: 'Search', selected: 'selected', excluded: 'excluded', no_results: 'No results',
        clear_selection: 'Clear selection', filter_value_placeholder: 'Filter value',
        exclude: 'Exclude', reset: 'Reset', priority: 'Priority',
        exclude_filter_option: 'Exclude value', reset_filter_option: 'Reset value' },
};
afterEach(() => { document.body.replaceChildren(); localStorage.clear(); delete window.translationPromises; });

test('live language switches update all five labels and raw option names without changing selection, query or focus', async () => {
    document.body.replaceChildren(); localStorage.clear();
    window.translationPromises = Object.fromEntries(Object.entries(copy).map(([language, labels]) => [language, Promise.resolve(labels)]));
    localStorage.setItem('chosen_language', 'fi');
    await translatePage('fi');
    const onRefresh = vi.fn();
    const element = createColumnFilterInput('choice_dataset', 'priority', { data_type: 'text',
        filter_options: ['a', 'b', 'c'].map(value => ({ value, label: { fi: `Asia i ${value}`, en: `Item i ${value}` } })),
    }, { updateFilterAndRefresh: onRefresh });
    document.body.append(element);
    const mount = element.querySelector('#choice_dataset_priority');
    await vi.waitFor(() => expect(mount.__dropdown?.getLabelsForValues(['a'])).toEqual(['Asia i a']));
    const dropdown = mount.__dropdown;
    dropdown.setValue({ includeValues: ['a', 'b'], excludeValues: ['c'] });
    dropdown.open();
    const popup = document.getElementById(mount.querySelector('input').getAttribute('aria-controls')).parentElement;
    const search = popup.querySelector('.msd-dropdown-search-input');
    search.value = 'i'; search.dispatchEvent(new Event('input')); search.setSelectionRange(1, 1);
    const row = popup.querySelector('[data-option-value="a"]'); row.focus();
    popup.querySelector('[role="listbox"]').scrollTop = 76;
    for (const language of ['fi', 'en', 'fi']) {
        localStorage.setItem('chosen_language', language);
        await translatePage(language);
        expect(search.placeholder).toBe(copy[language].search);
        expect(search.getAttribute('aria-label')).toBe(copy[language].search);
        expect(mount.querySelector('input').value).toBe(`2 ${copy[language].selected}, 1 ${copy[language].excluded}`);
        expect(mount.querySelector('.msd-clear-btn').title).toBe(copy[language].clear_selection);
        expect(mount.querySelector('.msd-clear-btn').getAttribute('aria-label')).toBe(copy[language].clear_selection);
        expect(popup.querySelector('.msd-no-results').textContent).toBe(copy[language].no_results);
        expect(row.querySelector('.msd-option-label').textContent).toBe(language === 'fi' ? 'Asia i a' : 'Item i a');
        expect(popup.querySelector('[data-option-value="a"]')).toBe(row);
        expect(document.activeElement).toBe(row);
        expect(search.value).toBe('i'); expect(search.selectionStart).toBe(1);
        expect(popup.querySelector('[role="listbox"]').scrollTop).toBe(76);
        expect(dropdown.getState()).toEqual({ includeValues: ['a', 'b'], excludeValues: ['c'] });
    }
    expect(onRefresh).not.toHaveBeenCalled();
    element.destroy();
    await translatePage('en'); expect(popup.isConnected).toBe(false);
});
