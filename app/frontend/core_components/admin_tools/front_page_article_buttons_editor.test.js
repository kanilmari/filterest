// front_page_article_buttons_editor.test.js
// Exercises article selection, strict revisions, unavailable targets and keyed copy.
// Connects the real editor/dropdown to actor-owned canonical result fixtures.
// Prevents copied labels, stale writes and hidden catalogue entries from entering settings.
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createFrontPageArticleButtonsEditor, validArticleButtonConfiguration } from './front_page_article_buttons_editor.js';
import { resolveArticleButtonLabel } from './front_page_article_row_picker.js';
import { articleButtonCopy, ARTICLE_BUTTON_COPY } from './front_page_article_buttons_copy.js';
import { refreshLocalizedDatasetValues } from '../table_views/dataset_value_localizer.js';

const mocks = vi.hoisted(() => ({ request: vi.fn(), saved: vi.fn(), confirm: vi.fn() }));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: mocks.request }));
vi.mock('../user_tools/current_user_profile_fetcher.js', () => ({ fetchCurrentUserProfile: async () => ({ user_id: 42 }) }));
vi.mock('../../reusable_components/modal/confirm_modal_builder.js', () => ({ showConfirmModal: mocks.confirm }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: (key, options = {}) =>
    key === 'contact_key' ? ({ fi: 'Yhteys', en: 'Contact' })[localStorage.getItem('chosen_language')] : options.fallback || key }));
let editor, original, catalogue, results;
const item = (id = '1', uid = 7) => ({ table_uid: uid, row_id: id, enabled: true });
const value = (items = []) => ({ schema_version: 1, placement: 'below_text', items });
const control = id => editor.element.querySelector(`[data-testid="front-page-article-${id}"]`);
function writes() { return mocks.request.mock.calls.filter(([, options]) => options?.method === 'POST'); }
async function mount() {
    editor = createFrontPageArticleButtonsEditor({ onSaved: mocks.saved });
    document.body.append(editor.element); await editor.load();
}
async function selectAndAdd() {
    control('dataset').value = '7'; control('dataset').dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(control('row').disabled).toBe(false));
    await vi.waitFor(() => expect(editor.element.querySelector('.msd-option')).not.toBeNull());
    control('row').click();
    await vi.waitFor(() => expect(editor.element.querySelector('.msd-option')?.textContent).toContain('Yhteys'));
    editor.element.querySelector('.msd-option').click(); control('add').click();
}
beforeEach(() => {
    document.body.replaceChildren(); localStorage.clear(); localStorage.setItem('chosen_language', 'fi');
    original = { article_buttons: value(), version: 'revision-1', unavailable_items: [], configuration_error: '' };
    catalogue = { datasets: [{ table_uid: 7, dataset_name: 'system_about', can_read_rows: true, is_in_current_project: true },
        { table_uid: 8, dataset_name: 'hidden', can_read_rows: false }] };
    results = { columns: ['id', 'heading'], types: { heading: { card_element: 'header+lang-key' } },
        data: [{ id: 1, heading: 'contact_key' }], resultsPerLoad: 1, row_count: 1 };
    mocks.request.mockReset().mockImplementation(async (route, options) => {
        if (route === 'adminFrontPageArticleButtons') return options?.method === 'POST' ? { version: 'revision-2' } : structuredClone(original);
        if (route === 'fetchContentTables') return catalogue;
        if (route === 'getResults') {
            const id = new URLSearchParams(options.url_params).get('id');
            return id ? { ...results, data: [{ ...results.data[0], id: Number(id) }] } : results;
        }
        throw new Error(`Unexpected route ${route}`);
    });
    mocks.saved.mockReset().mockResolvedValue(); mocks.confirm.mockReset().mockResolvedValue(true);
});
afterEach(() => { editor?.destroy(); vi.useRealTimers(); });

test('selects a readable system_about row, previews it, and saves only identities with the read revision', async () => {
    await mount(); expect([...control('dataset').options].map(option => option.value)).toEqual(['', '7']);
    await selectAndAdd(); expect(control('preview').textContent).toContain('Yhteys');
    control('save').click(); await vi.waitFor(() => expect(mocks.saved).toHaveBeenCalledOnce());
    expect(writes()[0]).toEqual(['adminFrontPageArticleButtons', expect.objectContaining({ body_data: {
        version: 'revision-1', article_buttons: value([item()]),
    } })]);
    expect(editor.dirty()).toBe(false);
    const read = mocks.request.mock.calls.find(([route]) => route === 'getResults');
    expect(new URLSearchParams(read[1].url_params).get('view_key')).toBe('article_view');
});
test('duplicates, noncanonical identities and over-limit lists are refused', async () => {
    expect(validArticleButtonConfiguration(value([item('01')]))).toBe(false);
    expect(validArticleButtonConfiguration(value([item('1', -1)]))).toBe(false);
    expect(validArticleButtonConfiguration(value([item(), item()]))).toBe(false);
    expect(validArticleButtonConfiguration(value(Array.from({ length: 11 }, (_, i) => item(String(i)))))).toBe(false);
    expect(validArticleButtonConfiguration({ ...value(), placement: 'unknown' })).toBe(false);
    await mount(); await selectAndAdd(); control('add').click();
    expect(control('list').children).toHaveLength(1); expect(control('status').textContent).toBe(articleButtonCopy('invalid'));
    expect(writes()).toHaveLength(0);
});
test('enable, reorder, placement and remove preserve the item identities and focus', async () => {
    original.article_buttons = value([item(), item('2')]); await mount();
    control('1-up').click(); expect(control('list').firstChild.dataset.identity).toBe('7:2');
    expect(document.activeElement).toBe(control('0-down'));
    control('0-enabled').checked = false; control('0-enabled').dispatchEvent(new Event('change'));
    control('placement').value = 'top_row'; control('placement').dispatchEvent(new Event('change'));
    control('1-remove').click(); control('save').click();
    await vi.waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1].body_data.article_buttons).toEqual({ ...value([{ ...item('2'), enabled: false }]), placement: 'top_row' });
});
test('409 retains the draft, shows the existing conflict key, and blocks retries until confirmed reload', async () => {
    await mount(); await selectAndAdd();
    mocks.request.mockImplementation(async (route, options) => {
        if (options?.method === 'POST') throw Object.assign(new Error('stale'), { status: 409 });
        if (route === 'adminFrontPageArticleButtons') return { ...original, version: 'new-revision' };
        if (route === 'fetchContentTables') return catalogue;
        return results;
    });
    control('save').click(); await vi.waitFor(() => expect(control('status').textContent).toBe(articleButtonCopy('conflict')));
    expect(control('list').children).toHaveLength(1); expect(control('save').disabled).toBe(true);
    control('save').click(); expect(writes()).toHaveLength(1);
    control('reload').click(); await vi.waitFor(() => expect(control('list').children).toHaveLength(0));
    expect(mocks.confirm).toHaveBeenCalledOnce();
});
test('unavailable administrator items warn, remain private and must be removed before a save', async () => {
    original.article_buttons = value([item('9', 99)]);
    original.unavailable_items = [{ index: 0, table_uid: 99, row_id: '9', reason: 'dataset_missing_or_unavailable' }];
    await mount(); const warning = control('list').querySelector('.front-page-settings-warning');
    expect(warning.hidden).toBe(false); expect(warning.textContent).toBe(articleButtonCopy('unavailable'));
    expect(control('0-enabled').disabled).toBe(true);
    control('placement').value = 'top_row'; control('placement').dispatchEvent(new Event('change'));
    control('save').click(); expect(writes()).toHaveLength(0);
    control('0-remove').click(); control('save').click();
    await vi.waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1].body_data.article_buttons.items).toEqual([]);
});
test('canonical pages use the server page size and searchable query, without offering an unreadable row', async () => {
    await mount(); results.row_count = 2;
    control('dataset').value = '7'; control('dataset').dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(control('next').disabled).toBe(false));
    control('row').click();
    await vi.waitFor(() => expect(control('next').disabled).toBe(false));
    control('next').click();
    await vi.waitFor(() => expect(mocks.request.mock.calls.some(([route, options]) => route === 'getResults'
        && new URLSearchParams(options.url_params).get('offset') === '1')).toBe(true));
    control('search').value = 'needle'; control('search').dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(mocks.request.mock.calls.some(([route, options]) => route === 'getResults'
        && new URLSearchParams(options.url_params).get('search') === 'needle'
        && new URLSearchParams(options.url_params).get('offset') === '0')).toBe(true));
    await vi.waitFor(() => expect(editor.element.querySelector('.msd-option')?.textContent).toContain('Yhteys'));
});
test('failed saves preserve the revision and a post-save Home refresh failure reports the successful write', async () => {
    await mount(); await selectAndAdd(); mocks.saved.mockRejectedValueOnce(new Error('Home failed'));
    control('save').click(); await vi.waitFor(() => expect(control('status').textContent).toBe(articleButtonCopy('refreshFailed')));
    expect(editor.dirty()).toBe(false);
});
test('all new copy has four translations and language refresh re-resolves the saved preview', async () => {
    Object.values(ARTICLE_BUTTON_COPY).forEach(translations => {
        expect(translations).toHaveLength(4); expect(translations.every(text => typeof text === 'string' && text.trim())).toBe(true);
    });
    original.article_buttons = value([item()]); await mount();
    expect(control('list').textContent).toContain('Yhteys');
    localStorage.setItem('chosen_language', 'en'); await refreshLocalizedDatasetValues('en');
    expect(control('list').textContent).toContain('Contact'); expect(editor.dirty()).toBe(false);
});
test('title selection honors article field order, visibility, language metadata and proven row ownership', () => {
    const row = { first: '', second: { fi: 'Otsikko', en: 'Title' }, owner: 42 };
    const types = { first: { card_element: 'header' }, second: { card_element: 'header', is_multilingual: true,
        hide_on_bg_crd_if_not_own: true }, owner: { is_row_owner: true } };
    expect(resolveArticleButtonLabel(row, ['first', 'second'], types, 'fi', 42)).toBe('Otsikko');
    expect(resolveArticleButtonLabel(row, ['first', 'second'], types, 'en', 13)).toBe('');
    types.second.hide_everywhere = true;
    expect(resolveArticleButtonLabel(row, ['second'], types, 'fi', 42)).toBe('');
});

test('switching datasets aborts a slow old page and cannot offer its row under the new identity', async () => {
    await mount();
    // The loaded catalogue already includes only readable entries; add another
    // readable dataset before reloading that same catalogue.
    catalogue.datasets.push({ table_uid: 9, dataset_name: 'news', can_read_rows: true });
    await editor.load();
    let finishOld;
    mocks.request.mockImplementation(async (route, options) => {
        if (route !== 'getResults') throw new Error('Only picker reads expected');
        if (new URLSearchParams(options.url_params).get('dataset') === 'system_about') {
            return new Promise(resolve => { finishOld = resolve; });
        }
        return { ...results, types: { heading: { card_element: 'header' } }, data: [{ id: 2, heading: 'News article' }] };
    });
    control('dataset').value = '7'; control('dataset').dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(finishOld).toBeTypeOf('function'));
    const oldSignal = mocks.request.mock.calls.at(-1)[1].signal;
    control('dataset').value = '9'; control('dataset').dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(editor.element.querySelector('.msd-option')?.textContent).toContain('News article'));
    finishOld(results); await Promise.resolve();
    expect(oldSignal.aborted).toBe(true);
    expect(editor.element.querySelector('.msd-option').textContent).not.toContain('Yhteys');
});
test('a refused save keeps the draft and revision for a successful retry', async () => {
    await mount(); await selectAndAdd();
    const respond = mocks.request.getMockImplementation();
    mocks.request.mockImplementationOnce(async () => { throw new Error('temporary refusal'); });
    control('save').click();
    await vi.waitFor(() => expect(control('status').textContent).toBe(articleButtonCopy('saveFailed')));
    expect(editor.dirty()).toBe(true); expect(control('save').disabled).toBe(false);
    mocks.request.mockImplementation(respond); control('save').click();
    await vi.waitFor(() => expect(mocks.saved).toHaveBeenCalledOnce());
    expect(writes().map(([, options]) => options.body_data.version)).toEqual(['revision-1', 'revision-1']);
});
test('a failed canonical picker read offers no stale option and allows a new search', async () => {
    await mount();
    mocks.request.mockImplementation(async () => { throw new Error('read denied'); });
    control('dataset').value = '7'; control('dataset').dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(editor.element.textContent).toContain(articleButtonCopy('rowsFailed')));
    expect(editor.element.querySelector('.msd-option')).toBeNull(); expect(control('add').disabled).toBe(true);
});

test.each(['fi', 'en', 'ch', 'yue'])('renders editor controls and warnings in %s without runtime translation rows', async language => {
    original.article_buttons = value([item('9', 99)]);
    original.unavailable_items = [{ index: 0, table_uid: 99, row_id: '9', reason: 'dataset_unreadable' }];
    await mount(); localStorage.setItem('chosen_language', language); await refreshLocalizedDatasetValues(language);
    const index = ['fi', 'en', 'ch', 'yue'].indexOf(language);
    expect(editor.element.querySelector('legend').textContent).toBe(ARTICLE_BUTTON_COPY.title[index]);
    expect(control('save').textContent).toBe(ARTICLE_BUTTON_COPY.save[index]);
    expect(control('list').querySelector('.front-page-settings-warning').textContent).toBe(ARTICLE_BUTTON_COPY.unavailable[index]);
});

test('per-button presentation defaults to Article, renders existing keys and saves Page', async () => {
    original.article_buttons = value([item()]); await mount();
    expect(control('0-view').value).toBe('article_view');
    expect([...control('0-view').options].map(option => option.value)).toEqual(['article_view', 'image_first_page_view']);
    expect(control('0-view').labels[0].textContent).toContain(articleButtonCopy('presentation'));
    expect(articleButtonCopy('presentation')).toBe('article_presentations_title');
    expect(articleButtonCopy('article_view')).toBe('article_presentations_article');
    expect(articleButtonCopy('image_first_page_view')).toBe('article_presentations_page');
    control('0-view').value = 'image_first_page_view'; control('0-view').dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(control('save').disabled).toBe(false));
    control('save').click(); await vi.waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1].body_data.article_buttons.items).toEqual([{ ...item(), view: 'image_first_page_view' }]);
    expect(mocks.request.mock.calls.some(([route, options]) => route === 'getResults'
        && new URLSearchParams(options.url_params).get('view_key') === 'image_first_page_view')).toBe(true);
});
test('a newly picked Page carries its presentation through the save payload', async () => {
    await mount();
    control('new-view').value = 'image_first_page_view'; control('new-view').dispatchEvent(new Event('change'));
    await selectAndAdd();
    expect(control('0-view').value).toBe('image_first_page_view');
    control('save').click(); await vi.waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1].body_data.article_buttons.items[0].view).toBe('image_first_page_view');
    expect(validArticleButtonConfiguration(value([{ ...item(), view: 'unknown' }]))).toBe(false);
    expect(validArticleButtonConfiguration(value([{ ...item(), view: null }]))).toBe(false);
});
