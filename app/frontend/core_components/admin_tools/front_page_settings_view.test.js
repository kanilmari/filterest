// front_page_settings_view.test.js
// Exercises the Home editor's translated drafts, account scopes and strict API writes.
// Connects realistic response fixtures to native controls and asynchronous lifecycle guards.
// Prevents lost edits, silent conflict overwrites and login-name leaks in administration.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    endpoint: vi.fn(), confirm: vi.fn(), auth: vi.fn(), navbar: vi.fn(), open: vi.fn(),
    picker: vi.fn(), language: 'fi', copy: {}, refresh: null,
}));
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: mocks.endpoint }));
vi.mock('../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, options = {}) => mocks.copy[key]?.[mocks.language] || options.fallback || key,
}));
vi.mock('../table_views/dataset_value_localizer.js', () => ({
    bindDatasetLanguageRenderer: (_element, callback) => { mocks.refresh = callback; callback(); },
}));
vi.mock('../../reusable_components/modal/confirm_modal_builder.js', () => ({ showConfirmModal: mocks.confirm }));
vi.mock('./auth_mode_handler.js', () => ({ setAuthModes: mocks.auth }));
vi.mock('../front_page/front_page_navigation.js', () => ({ openFrontPage: mocks.open }));
vi.mock('../front_page/navbar_front_page.js', () => ({ renderNavbarFrontPage: mocks.navbar }));
vi.mock('../../reusable_components/image_source_picker/image_source_picker.js', () => ({ openImageSourcePicker: mocks.picker }));

import { generate_front_page_settings_view } from './front_page_settings_view.js';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(resolve(currentDirectory, '../../../server_tools/migrations/20261005000033_seed_front_page_language_keys.sql'), 'utf8')
    + readFileSync(resolve(currentDirectory, '../../../server_tools/migrations/20261005000086_seed_front_page_hero_language_keys.sql'), 'utf8');
for (const match of migration.matchAll(/\('([^']+)', '([^']*)', '([^']*)'(?:,|\))/g)) {
    mocks.copy[match[1]] = { fi: match[2], en: match[3] };
}
Object.assign(mocks.copy, {
    save: { fi: 'Tallenna', en: 'Save' }, saving: { fi: 'Tallennetaan…', en: 'Saving…' },
    settings_saved: { fi: 'Asetukset tallennettu.', en: 'Settings saved.' },
    unsaved_changes: { fi: 'Tallentamattomia muutoksia', en: 'Unsaved changes' },
    loading: { fi: 'Ladataan…', en: 'Loading…' }, cancel: { fi: 'Peruuta', en: 'Cancel' },
    enabled: { fi: 'Käytössä', en: 'Enabled' }, dataset: { fi: 'Aineisto', en: 'Dataset' },
    search: { fi: 'Haku', en: 'Search' }, pick_image_from_web: { fi: 'Valitse kuva verkosta', en: 'Pick image from web' },
    alpha: { fi: 'Uutiset', en: 'News' }, beta: { fi: 'Tapahtumat', en: 'Events' },
});

let common;
let personal;
let target;
let serial;
const backgroundFixture = { storage_key: 'site_media/front_page/original/landscape.png',
    original_name: 'landscape.png', mime_type: 'image/png', focal_x: 0.5, focal_y: 0.5 };

function fixture(overrides = {}) {
    return {
        settings: { separate_front_page: true, front_page_button_shows_site_name: false, front_page_show_blocks: true },
        hero: { title: { lang_key: 'site_front_page_title', fi: '', en: '', usage_explanation: '' },
            slogan: { lang_key: 'site_front_page_slogan', fi: '', en: '', usage_explanation: '' } },
        background: null, background_error: '', scope: { user_id: null, display_name: '' },
        saved: true, inherits_common: false, source: 'common', version: 'common-v1',
        blocks: [
            { id: 1, dataset: 'alpha', result_limit: 5, sort_order: 1, enabled: true, can_read: true },
            { id: 2, dataset: 'beta', result_limit: 3, sort_order: 2, enabled: false, can_read: true },
        ],
        datasets: [
            { dataset: 'alpha', newest_capable: true, can_read: true },
            { dataset: 'beta', newest_capable: true, can_read: false },
            { dataset: 'gamma', newest_capable: true, can_read: false },
            { dataset: 'legacy', newest_capable: false, can_read: true },
        ], ...overrides,
    };
}

function query(id) { return target.querySelector(`[data-testid="front-page-${id}"]`); }
function row(dataset) { return Array.from(query('block-list').children).find(item => item.dataset.dataset === dataset); }
function input(element, value, event = 'input') {
    if (element.type === 'checkbox') element.checked = value;
    else element.value = value;
    element.dispatchEvent(new Event(event, { bubbles: true }));
}
function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
async function settled() {
    await new Promise(resolve => setTimeout(resolve, 0));
    await vi.waitFor(() => expect(target.getAttribute('aria-busy')).toBe('false'));
}
async function click(id) { query(id).click(); await settled(); }
function writes(route = 'adminFrontPage') {
    return mocks.endpoint.mock.calls.filter(([name, options]) => name === route && options?.method && options.method !== 'GET');
}
async function chooseUser() {
    input(query('user-search'), 'Aino Å');
    query('user-search-button').click();
    await vi.waitFor(() => expect(query('scope').options.length).toBe(2));
    input(query('scope'), '42', 'change');
    await settled();
}
function setFile(file) {
    Object.defineProperty(query('background-file'), 'files', { configurable: true, value: [file] });
    query('background-file').dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    mocks.language = 'fi';
    common = fixture();
    personal = fixture({ scope: { user_id: 42, display_name: 'Aino Åström' }, version: 'user-v1',
        saved: false, inherits_common: true, source: 'common' });
    personal.blocks[1].can_read = false;
    serial = 1;
    document.body.innerHTML = '<div class="content_div"><main id="target"></main></div>';
    target = document.getElementById('target');
    localStorage.clear();
    localStorage.setItem('separate_front_page', 'true');
    localStorage.setItem('button_state', 'logout');
    URL.createObjectURL = vi.fn(() => 'blob:home-preview');
    URL.revokeObjectURL = vi.fn();
    mocks.confirm.mockResolvedValue(true);
    mocks.picker.mockReturnValue({ hide: vi.fn() });
    mocks.auth.mockImplementation(async () => {
        localStorage.setItem('separate_front_page', String(common.settings.separate_front_page));
    });
    mocks.endpoint.mockImplementation(async (name, options = {}) => {
        if (name === 'adminFrontPageBackground') {
            if (options.method === 'DELETE') common.background = null;
            else common.background = { ...backgroundFixture, focal_x: Number(options.body_data.get('focal_x')),
                focal_y: Number(options.body_data.get('focal_y')) };
            common.background_error = '';
            return { background: structuredClone(common.background) };
        }
        if (name !== 'adminFrontPage') throw new Error(`Unexpected route ${name}`);
        if (options.method === 'POST') {
            const body = options.body_data;
            if (body.hero) { common.hero = structuredClone(body.hero); return { version: "" }; }
            if (body.settings) { common.settings = { ...body.settings }; return { version: '' }; }
            const view = body.user_id ? personal : common;
            view.version = `saved-v${++serial}`;
            if (body.reset) {
                view.blocks = structuredClone(common.blocks); view.saved = false; view.inherits_common = true;
            } else if (body.copy_from_common) {
                view.blocks = structuredClone(common.blocks); view.saved = true; view.inherits_common = false;
            } else {
                view.blocks = body.blocks.length ? structuredClone(body.blocks) : structuredClone(common.blocks);
                view.saved = body.blocks.length > 0; view.inherits_common = Boolean(body.user_id && !view.saved);
            }
            return { version: view.version };
        }
        const params = new URLSearchParams(options.url_params);
        if (params.has('user_query')) return { users: [{ user_id: 42, display_name: 'Aino Åström', login_name: 'private-login' }] };
        return structuredClone(params.has('user_id') ? personal : common);
    });
});

afterEach(() => { target?.closest('.content_div')?.__cleanupListeners?.(); vi.restoreAllMocks(); });

describe('Home settings and scope drafts', () => {
    test('renders Finnish keys, native labels, seeded checkboxes and clean live results', async () => {
        await generate_front_page_settings_view(target);
        expect(target.querySelector('h2').textContent).toBe('Etusivun asetukset');
        expect(query('open').textContent).toBe('Avaa etusivu');
        expect(query('enabled').checked).toBe(true);
        expect(query('site-name').checked).toBe(false);
        expect(query('settings-save').disabled).toBe(true);
        expect(query('blocks-save').disabled).toBe(true);
        expect(query('status').getAttribute('aria-live')).toBe('polite');
        expect(query('status').getAttribute('aria-atomic')).toBe('true');
        expect(row('alpha').textContent).toContain('Uutiset');
        expect(query('reset').hidden).toBe(true);
        expect(query('copy').hidden).toBe(true);
        target.querySelectorAll('input, select').forEach(control => expect(target.querySelector(`label[for="${control.id}"]`)).not.toBeNull());
    });

    test('leaves the title to the dialog and drops Open Home inside it', async () => {
        await generate_front_page_settings_view(target, { modal: true });
        expect(target.querySelector('h2')).toBeNull();
        expect(query('open').hidden).toBe(true);
        expect(query('reload').hidden).toBe(false);
        expect(query('hero-save')).not.toBeNull();
        target.__cleanupListeners?.();
    });

    test('keeps drafts and focus while switching rendered language', async () => {
        await generate_front_page_settings_view(target);
        const count = row('alpha').querySelector('input[type="number"]');
        input(count, '7'); count.focus();
        mocks.language = 'en'; mocks.refresh();
        expect(target.querySelector('h2').textContent).toBe('Home settings');
        expect(count.value).toBe('7');
        expect(document.activeElement).toBe(count);
        expect(row('alpha').querySelector('[data-front-page-action="down"]').getAttribute('aria-label')).toBe('Move down: News');
        input(count, '5');
        mocks.refresh();
        expect(query('blocks-status').textContent).toBe('');
    });

    test('searches display names only, switches user/common and shows inheritance/access warnings', async () => {
        await generate_front_page_settings_view(target);
        await chooseUser();
        expect(mocks.endpoint).toHaveBeenCalledWith('adminFrontPage', expect.objectContaining({ url_params: '?user_query=Aino+%C3%85' }));
        expect(mocks.endpoint).toHaveBeenCalledWith('adminFrontPage', expect.objectContaining({ url_params: '?user_id=42' }));
        expect(query('scope').selectedOptions[0].textContent).toBe('Aino Åström');
        expect(target.textContent).not.toContain('private-login');
        expect(query('source').textContent).toBe('Käyttää yhteistä etusivua');
        expect(row('beta').querySelector('.front-page-settings-warning').hidden).toBe(false);
        expect(row('alpha').querySelector('.front-page-settings-warning').hidden).toBe(true);
        input(query('scope'), '', 'change'); await settled();
        expect(row('beta').querySelector('.front-page-settings-warning').hidden).toBe(true);
        expect(query('source').textContent).toBe('');
    });

    test('declined scope switch keeps edited blocks and the original version; settings survive accepted switch', async () => {
        await generate_front_page_settings_view(target);
        input(row('alpha').querySelector('input[type="number"]'), '9');
        input(query('site-name'), true, 'change');
        mocks.confirm.mockResolvedValueOnce(false);
        await chooseUser();
        expect(query('scope').value).toBe('');
        expect(row('alpha').querySelector('input[type="number"]').value).toBe('9');
        expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ messageLangKey: 'front_page_discard_changes' }));
        input(query('scope'), '42', 'change'); await settled();
        expect(query('scope').value).toBe('42');
        expect(row('alpha').querySelector('input[type="number"]').value).toBe('5');
        expect(query('site-name').checked).toBe(true);
        expect(query('settings-save').disabled).toBe(false);
    });

    test('button reorder retains focus, supports up/down and removes/adds newest-capable unique datasets', async () => {
        await generate_front_page_settings_view(target);
        row('alpha').querySelector('[data-front-page-action="down"]').click();
        expect(Array.from(query('block-list').children, item => item.dataset.dataset)).toEqual(['beta', 'alpha']);
        expect(document.activeElement.closest('li').dataset.dataset).toBe('alpha');
        row('alpha').querySelector('[data-front-page-action="up"]').click();
        expect(query('blocks-save').disabled).toBe(true);
        expect(row('alpha').querySelector('[data-front-page-action="up"]').disabled).toBe(true);
        expect(row('beta').querySelector('[data-front-page-action="down"]').disabled).toBe(true);
        expect(Array.from(query('dataset').options, option => option.value)).toEqual(['gamma']);
        row('beta').querySelector('[data-front-page-action="remove"]').click();
        expect(Array.from(query('dataset').options, option => option.value)).toEqual(['beta', 'gamma']);
        input(query('dataset'), 'gamma', 'change'); await click('add');
        expect(row('gamma')).toBeDefined();
        expect(query('dataset').options[0].value).toBe('beta');
        expect(target.textContent).not.toContain('legacy');
    });

    test.each(['', '0', '21', '2.5'])('refuses invalid count %s with translated validation and focused input', async invalid => {
        await generate_front_page_settings_view(target);
        const count = row('alpha').querySelector('input[type="number"]');
        input(count, invalid); await click('blocks-save');
        expect(writes()).toHaveLength(0);
        expect(query('status').textContent).toBe(mocks.copy.front_page_limit_invalid.fi);
        expect(count.getAttribute('aria-invalid')).toBe('true');
        expect(document.activeElement).toBe(count);
    });

    test('shows why a saved dataset without newest sorting cannot be resaved and caps additions at 20', async () => {
        common.blocks[0].dataset = 'legacy';
        await generate_front_page_settings_view(target);
        input(row('legacy').querySelector('input[type="number"]'), '8'); await click('blocks-save');
        expect(query('status').textContent).toBe(mocks.copy.front_page_blocks_invalid.fi);
        expect(writes()).toHaveLength(0);
        target.closest('.content_div').__cleanupListeners();
        common = fixture({ blocks: Array.from({ length: 20 }, (_, index) => ({ dataset: `d${index}`, result_limit: 1, enabled: true })),
            datasets: Array.from({ length: 21 }, (_, index) => ({ dataset: `d${index}`, newest_capable: true })) });
        await generate_front_page_settings_view(target);
        expect(query('add').disabled).toBe(true);
        expect(query('dataset').disabled).toBe(true);
    });

    test('restoring a changed value clears dirty state; writes only common blocks with the loaded revision', async () => {
        await generate_front_page_settings_view(target);
        const count = row('alpha').querySelector('input[type="number"]');
        input(count, '8'); expect(query('blocks-save').disabled).toBe(false);
        input(count, '5'); expect(query('blocks-save').disabled).toBe(true);
        input(count, '8');
        input(row('beta').querySelector('input[type="checkbox"]'), true, 'change');
        await click('blocks-save');
        expect(writes()[0][1].body_data).toEqual({ user_id: null, version: 'common-v1', blocks: [
            { dataset: 'alpha', result_limit: 8, sort_order: 1, enabled: true },
            { dataset: 'beta', result_limit: 3, sort_order: 2, enabled: true },
        ] });
        expect(query('blocks-save').disabled).toBe(true);
        expect(query('status').textContent).toBe('Asetukset tallennettu.');
        input(count, '10'); await click('blocks-save');
        expect(writes()[1][1].body_data.version).toBe('saved-v2');
    });

    test('saves global flags separately and immediately refreshes the Home presentation', async () => {
        await generate_front_page_settings_view(target);
        input(query('enabled'), false, 'change'); input(query('site-name'), true, 'change');
        await click('settings-save');
        expect(writes()[0][1].body_data).toEqual({ settings: { separate_front_page: false, front_page_button_shows_site_name: true, front_page_show_blocks: true } });
        expect(mocks.auth).toHaveBeenCalledOnce();
        expect(mocks.navbar).toHaveBeenCalledWith({ isLoggedIn: true });
        expect(query('open').disabled).toBe(true);
        expect(query('settings-save').disabled).toBe(true);
        expect(writes()).toHaveLength(1);
    });

    test('a user save includes its revision and drops response-only fields; newly added unreadable block warns', async () => {
        await generate_front_page_settings_view(target); await chooseUser();
        await click('add');
        expect(row('gamma').querySelector('.front-page-settings-warning').hidden).toBe(false);
        await click('blocks-save');
        expect(writes()[0][1].body_data).toMatchObject({ user_id: 42, version: 'user-v1' });
        expect(writes()[0][1].body_data.blocks[2]).toEqual({ dataset: 'gamma', result_limit: 5, sort_order: 3, enabled: true });
        expect(query('source').textContent).toBe('');
    });

    test('409 keeps the draft, disables all scope writes and requires an explicit confirmed reload', async () => {
        await generate_front_page_settings_view(target); await chooseUser();
        input(row('alpha').querySelector('input[type="number"]'), '11');
        mocks.endpoint.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }));
        await click('blocks-save');
        expect(query('status').textContent).toBe(mocks.copy.front_page_save_conflict.fi);
        expect(row('alpha').querySelector('input[type="number"]').value).toBe('11');
        expect(query('blocks-save').disabled).toBe(true);
        expect(query('copy').disabled).toBe(true);
        expect(query('reset').disabled).toBe(true);
        await click('blocks-save'); expect(writes()).toHaveLength(1);
        mocks.confirm.mockResolvedValueOnce(false); await click('reload');
        expect(row('alpha').querySelector('input[type="number"]').value).toBe('11');
        personal.version = 'server-newer';
        await click('reload');
        input(row('alpha').querySelector('input[type="number"]'), '12'); await click('blocks-save');
        expect(writes().at(-1)[1].body_data.version).toBe('server-newer');
    });

    test('reset/copy use strict versioned user payloads and refresh inheritance, including the next revision', async () => {
        personal.saved = true; personal.inherits_common = false;
        await generate_front_page_settings_view(target); await chooseUser();
        await click('reset');
        expect(writes()[0][1].body_data).toEqual({ user_id: 42, version: 'user-v1', reset: true });
        expect(query('source').textContent).toBe(mocks.copy.front_page_inherits.fi);
        await click('copy');
        expect(writes()[1][1].body_data).toEqual({ user_id: 42, version: 'saved-v2', copy_from_common: true });
        expect(query('source').textContent).toBe('');
        expect(query('blocks-save').disabled).toBe(true);
    });

    test('a successful copy followed by a failed GET reports saved changes and blocks writes until reload', async () => {
        await generate_front_page_settings_view(target); await chooseUser();
        mocks.endpoint.mockResolvedValueOnce({ version: 'copied-v2' }).mockRejectedValueOnce(new Error('read failed'));
        await click('copy');
        expect(query('status').textContent).toBe(mocks.copy.front_page_refresh_failed.fi);
        expect(query('copy').disabled).toBe(true);
        expect(query('reset').disabled).toBe(true);
        expect(query('blocks-save').disabled).toBe(true);
        await click('reload');
        expect(query('copy').disabled).toBe(false);
    });

    test('common default is marked unsaved; stale duplicate/oversized lists cannot be written', async () => {
        common.saved = false; common.source = 'default';
        common.blocks = Array.from({ length: 21 }, () => ({ dataset: 'alpha', result_limit: 5, enabled: true }));
        await generate_front_page_settings_view(target);
        expect(query('source').textContent).toBe(mocks.copy.front_page_default_not_saved.fi);
        input(row('alpha').querySelector('input[type="number"]'), '6'); await click('blocks-save');
        expect(writes()).toHaveLength(0);
        expect(query('status').textContent).toBe(mocks.copy.front_page_blocks_invalid.fi);
    });

    test('saving an empty user list reloads inheritance rather than leaving an apparently blank list', async () => {
        await generate_front_page_settings_view(target); await chooseUser();
        row('alpha').querySelector('[data-front-page-action="remove"]').click();
        row('beta').querySelector('[data-front-page-action="remove"]').click();
        await click('blocks-save');
        expect(writes()[0][1].body_data).toEqual({ user_id: 42, version: 'user-v1', blocks: [] });
        expect(query('source').textContent).toBe(mocks.copy.front_page_inherits.fi);
        expect(query('block-list').children).toHaveLength(2);
    });
});

describe('Background and editor lifecycle', () => {
    test('file upload is staged and saved as multipart with focal coordinates, then revokes the preview', async () => {
        await generate_front_page_settings_view(target);
        const file = new File(['png'], 'scene.png', { type: 'image/png' });
        setFile(file); input(query('focal-x'), '25'); input(query('focal-y'), '75');
        expect(writes('adminFrontPageBackground')).toHaveLength(0);
        expect(target.querySelector('img').src).toBe('blob:home-preview');
        await click('background-save');
        const options = writes('adminFrontPageBackground')[0][1];
        expect(options.method).toBe('POST'); expect(options.body_data).toBeInstanceOf(FormData);
        expect(options.body_data.get('background_image')).toBe(file);
        expect(options.body_data.get('focal_x')).toBe('0.25');
        expect(options.body_data.get('focal_y')).toBe('0.75');
        expect(query('background-save').disabled).toBe(true);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:home-preview');
    });

    test('web picker supplies a File to the same staged upload and local files can cancel a new selection', async () => {
        await generate_front_page_settings_view(target); await click('background-web');
        const pickerOptions = mocks.picker.mock.calls[0][0];
        expect(pickerOptions.endpointRouter).toBe(mocks.endpoint);
        expect(pickerOptions.getTranslation('image_source_picker_help')).toBe(mocks.copy.front_page_background_picker_help.fi);
        const file = new File(['jpeg'], 'web-photo.jpg', { type: 'image/jpeg' });
        await pickerOptions.onSelect({ file, selection: { provider: 'pexels' } });
        await click('background-remove');
        expect(query('background-save').disabled).toBe(true);
        expect(writes('adminFrontPageBackground')).toHaveLength(0);
        await pickerOptions.onSelect({ file }); await click('background-save');
        expect(writes('adminFrontPageBackground')[0][1].body_data.get('background_image')).toBe(file);
    });

    test('updates an existing focal point without a file, validates percentages and stages DELETE', async () => {
        common.background = backgroundFixture;
        await generate_front_page_settings_view(target);
        input(query('focal-x'), '101'); await click('background-save');
        expect(query('status').textContent).toBe(mocks.copy.front_page_focal_invalid.fi);
        expect(writes('adminFrontPageBackground')).toHaveLength(0);
        input(query('focal-x'), '20'); await click('background-save');
        expect(writes('adminFrontPageBackground')[0][1].body_data.has('background_image')).toBe(false);
        await click('background-remove');
        expect(writes('adminFrontPageBackground')).toHaveLength(1);
        await click('background-save');
        expect(writes('adminFrontPageBackground')[1][1]).toMatchObject({ method: 'DELETE' });
        expect(writes('adminFrontPageBackground')[1][1]).not.toHaveProperty('body_data');
        expect(target.querySelector('img').hidden).toBe(true);
    });

    test('renders background_error as translated repair guidance and permits removal of invalid configuration', async () => {
        common.background_error = 'invalid front_page_background';
        await generate_front_page_settings_view(target);
        expect(query('background-error').textContent).toBe(mocks.copy.front_page_background_error.fi);
        expect(target.textContent).not.toContain('invalid front_page_background');
        expect(query('background-remove').disabled).toBe(false);
        await click('background-remove'); await click('background-save');
        expect(writes('adminFrontPageBackground')[0][1].method).toBe('DELETE');
        expect(query('background-error').hidden).toBe(true);
    });

    test('background save failures keep the selected file for retry and an unchanged focal point stays clean', async () => {
        common.background = { ...backgroundFixture, focal_x: 0.29123, focal_y: 0.44123 };
        await generate_front_page_settings_view(target);
        expect(query('background-save').disabled).toBe(true);
        const file = new File(['x'], 'retry.png', { type: 'image/png' });
        setFile(file);
        mocks.endpoint.mockRejectedValueOnce(Object.assign(new Error('upload failed'), { status: 400 }));
        await click('background-save');
        expect(query('status').textContent).toBe(mocks.copy.front_page_background_save_failed.fi);
        expect(query('background-save').disabled).toBe(false);
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        await click('background-save');
        expect(writes('adminFrontPageBackground').at(-1)[1].body_data.get('background_image')).toBe(file);
    });

    test.each([
        () => new File(['svg'], 'bad.svg', { type: 'image/svg+xml' }),
        () => new File([], 'empty.png', { type: 'image/png' }),
        () => new File([new Uint8Array(10 * 1024 * 1024)], 'large.png', { type: 'image/png' }),
    ])('rejects an unsupported, empty or oversized image before any request', async makeFile => {
        await generate_front_page_settings_view(target); setFile(makeFile());
        expect(query('status').textContent).toBe(mocks.copy.front_page_background_invalid.fi);
        expect(query('background-save').disabled).toBe(true);
        expect(writes('adminFrontPageBackground')).toHaveLength(0);
    });

    test('a failed write keeps drafts/revision; controls cannot edit during a pending save', async () => {
        await generate_front_page_settings_view(target);
        input(row('alpha').querySelector('input[type="number"]'), '13');
        const pending = deferred(); mocks.endpoint.mockReturnValueOnce(pending.promise);
        query('blocks-save').click();
        expect(target.querySelectorAll('fieldset:disabled')).toHaveLength(4);
        expect(query('reload').disabled).toBe(true);
        pending.reject(Object.assign(new Error('failed'), { status: 500 })); await settled();
        expect(query('status').textContent).toBe(mocks.copy.front_page_save_failed.fi);
        expect(query('blocks-save').disabled).toBe(false);
        await click('blocks-save');
        expect(writes().at(-1)[1].body_data.version).toBe('common-v1');
    });

    test('failed initial load leaves controls closed and can be retried by Reload', async () => {
        mocks.endpoint.mockRejectedValueOnce(new Error('offline'));
        await generate_front_page_settings_view(target);
        expect(query('status').textContent).toBe(mocks.copy.front_page_load_failed.fi);
        expect(target.querySelectorAll('fieldset:disabled')).toHaveLength(4);
        expect(query('reload').disabled).toBe(false);
        await click('reload');
        expect(row('alpha')).toBeDefined();
    });

    test('late account-search results never replace the most recent search or leak visitor/login identity', async () => {
        await generate_front_page_settings_view(target);
        const stale = deferred(); mocks.endpoint.mockReturnValueOnce(stale.promise);
        input(query('user-search'), 'Old'); query('user-search-button').click();
        input(query('user-search'), 'New'); query('user-search-button').click();
        await vi.waitFor(() => expect(query('scope').options.length).toBe(2));
        stale.resolve({ users: [{ user_id: 9, display_name: 'Old account' }, { user_id: 1, login_name: 'visitor' }] });
        await Promise.resolve(); await Promise.resolve();
        expect(query('scope').textContent).not.toContain('Old account');
        expect(target.textContent).not.toContain('visitor');
    });

    test('cleanup aborts stale loads, releases previews/picker/dirty hook and opens Home through its owner', async () => {
        await generate_front_page_settings_view(target);
        await click('open'); expect(mocks.open).toHaveBeenCalledWith({ forceReload: true });
        setFile(new File(['x'], 'draft.png', { type: 'image/png' }));
        mocks.confirm.mockResolvedValueOnce(false);
        expect(await window.check_manage_permissions_dirty()).toBe(false);
        const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        const stale = deferred(); mocks.endpoint.mockReturnValueOnce(stale.promise);
        query('user-search').value = 'Aino'; query('user-search-button').click();
        const signal = mocks.endpoint.mock.calls.at(-1)[1].signal;
        target.closest('.content_div').__cleanupListeners();
        expect(signal.aborted).toBe(true);
        expect(window.check_manage_permissions_dirty).toBeUndefined();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:home-preview');
        stale.resolve({ users: [{ user_id: 42, display_name: 'Aino' }] });
        await Promise.resolve(); await Promise.resolve(); expect(target.children).toHaveLength(0);
    });
});


test('shows fi/en fixed hero keys, saves only hero copy and refreshes visible Home after successful save', async () => {
    const onSaved = vi.fn();
    await generate_front_page_settings_view(target, { onSaved });
    expect(query('title-keyInput').value).toBe('site_front_page_title');
    expect(query('slogan-keyInput').value).toBe('site_front_page_slogan');
    expect(query('title-keyInput').readOnly).toBe(true);
    expect(target.querySelectorAll('.dataset-header-config-language-caption')).toHaveLength(4);
    input(query('title-fiInput'), 'Oma otsikko'); input(query('title-enInput'), 'Our title');
    input(query('slogan-fiInput'), 'Oma iskulause');
    await click('hero-save');
    expect(writes()[0][1].body_data).toEqual({ hero: {
        title: { fi: 'Oma otsikko', en: 'Our title', usage_explanation: '' },
        slogan: { fi: 'Oma iskulause', en: '', usage_explanation: '' },
    } });
    expect(onSaved).toHaveBeenCalledOnce();
    expect(query('hero-save').disabled).toBe(true);
});

test('the slogan has full-width multi-line fields that save typed line breaks; the title stays one line', async () => {
    await generate_front_page_settings_view(target);
    for (const language of ['fi', 'en']) {
        expect(query(`slogan-${language}Input`).tagName).toBe('TEXTAREA');
        expect(query(`title-${language}Input`).tagName).toBe('INPUT');
    }
    expect(query('slogan-fiInput').closest('.dataset-header-config-translation-grid--multiline')).not.toBeNull();
    expect(query('title-fiInput').closest('.dataset-header-config-translation-grid--multiline')).toBeNull();
    input(query('slogan-fiInput'), 'Ensimmäinen rivi\ntoinen rivi');
    await click('hero-save');
    expect(writes()[0][1].body_data.hero.slogan.fi).toBe('Ensimmäinen rivi\ntoinen rivi');
});

test('boxes default on when absent, off disables and greys the list and settings save sends the switch', async () => {
    delete common.settings.front_page_show_blocks;
    await generate_front_page_settings_view(target);
    expect(query('show-blocks').checked).toBe(true);
    input(query('show-blocks'), false, 'change');
    const listSection = query('block-list').closest('fieldset');
    expect(listSection.disabled).toBe(true);
    expect(listSection.classList.contains('front-page-settings-section--disabled')).toBe(true);
    expect(query('blocks-save').disabled).toBe(true);
    await click('settings-save');
    expect(writes()[0][1].body_data.settings.front_page_show_blocks).toBe(false);
    input(query('show-blocks'), true, 'change');
    expect(listSection.disabled).toBe(false);
});

test('video picker accepts original-only previews and saves the existing upload payload; MIME mismatch is refused', async () => {
    await generate_front_page_settings_view(target);
    const video = new File(['movie'], 'background.webm', { type: 'video/webm' });
    setFile(video);
    expect(query('background-file').accept).toContain('video/mp4');
    expect(target.querySelector('video').hidden).toBe(false);
    expect(target.querySelector('img').hidden).toBe(true);
    await click('background-save');
    expect(writes('adminFrontPageBackground')[0][1].body_data.get('background_image')).toBe(video);
    setFile(new File(['wrong'], 'background.png', { type: 'video/webm' }));
    expect(query('status').textContent).toBe(mocks.copy.front_page_background_invalid.fi);
});

test('stored video previews request original and empty title/slogan can be saved intentionally', async () => {
    common.background = { ...backgroundFixture, storage_key: 'site_media/front_page/original/movie.mp4', mime_type: 'video/mp4' };
    common.hero.title.fi = 'Earlier title';
    await generate_front_page_settings_view(target);
    expect(target.querySelector('video').src).toContain('/original/movie.mp4');
    expect(target.querySelector('video').autoplay).toBe(false);
    input(query('title-fiInput'), '');
    await click('hero-save');
    expect(writes()[0][1].body_data.hero.title.fi).toBe('');
});
