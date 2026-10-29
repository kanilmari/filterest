// record_title_resolver.test.js
// Proves precedence, visibility, localization and safe fallback for record names.
// Connects the shared resolver to realistic response metadata and relation aliases.
// Keeps every presentation's naming policy independent of record fetches.
import { beforeEach, expect, test, vi } from 'vitest';
vi.mock('../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback, language } = {}) =>
        ({ fi: { hello_key: 'Hei' }, en: { hello_key: 'Hello' } })[language]?.[key] ?? fallback ?? key,
}));
import { resolveRecordTitle } from './record_title_resolver.js';

beforeEach(() => localStorage.clear());
const text = (extra = {}) => ({ data_type: 'text', show_value_on_card: true, ...extra });
function title(rowItem, dataTypes, extra = {}) {
    return resolveRecordTitle({ rowItem, dataTypes, columns: Object.keys(dataTypes), preferredLanguage: 'en', ...extra });
}

test('keeps every usable configured header in layout order and the first as summary', () => {
    const result = title({ name: 'Name', a: '', b: 'Second', c: 'Third' }, {
        name: text(), a: text({ card_element: 'header' }),
        b: text({ card_element: 'header', co_number: 4 }), c: text({ card_element: 'header', co_number: 1 }),
    });
    expect(result.text).toBe('Second');
    expect(result.headers.map(item => item.text)).toEqual(['Second', 'Third']);
    expect(result.initial).toBe('S');
});
test('tries all exact names in priority order, then natural label, then stable text order', () => {
    const types = { other: text({ co_number: 2 }), label: text({ co_number: 1 }),
        key: text(), title: text(), name: text(), display_name: text() };
    const row = { other: 'Other', label: 'Natural', key: 'Key', title: 'Title', name: 'Name', display_name: 'Display' };
    for (const column of ['display_name', 'name', 'title', 'key']) {
        expect(title(row, types, { tableMeta: { fk_display_column: 'label' } }).column).toBe(column);
        row[column] = '';
    }
    expect(title(row, types, { tableMeta: { fk_display_column: 'label' } }).text).toBe('Natural');
    expect(title(row, types).column).toBe('label');
    expect(title(row, types, { columns: ['other', 'label'] }).column).toBe('label');
});
test('reads natural label from the existing table metadata cache', () => {
    localStorage.setItem('notes_tableMeta', JSON.stringify({ fk_display_column: 'label' }));
    expect(title({ first: 'First', label: 'Natural' }, { first: text(), label: text() }, { tableName: 'notes' }).text).toBe('Natural');
});
test.each([
    { show_value_on_card: false }, { hide_everywhere: true }, { hide_on_small_card: true },
    { authorized: false }, { selectable: false }, { restricted: true }, { is_hidden: true },
    { client_delivery_mode: 'server_only' }, { card_element: 'hidden' }, { card_element: 'hidden2,header' },
])('excludes unavailable candidates even when configured: %j', flags => {
    const result = title({ name: 'Private', safe: 'Safe' }, { name: text({ card_element: 'header', ...flags }), safe: text() });
    expect(result.text).toBe('Safe');
});
test('never inspects row keys outside the presentation or fields without metadata', () => {
    expect(title({ name: 'Private', safe: 'Safe' }, { safe: text() }, { columns: ['safe', 'name'] }).text).toBe('Safe');
    expect(title({ name: 'Private', safe: 'Safe' }, { name: text(), safe: text() }, { columns: ['safe'] }).text).toBe('Safe');
});
test.each(['password', 'access_token', 'secret', 'api_key', 'credentials', 'embedding_vector'])('excludes sensitive/body column %s', column => {
    expect(title({ [column]: 'Unsafe', safe: 'Safe' }, { [column]: text({ card_element: 'header' }), safe: text() }).text).toBe('Safe');
});
test.each([
    ['bytea', 'secret'], ['vector', '[1,2]'], ['jsonb', '{"key":"secret"}'],
    ['text', 'line\nline'], ['text', 'x'.repeat(161)], ['text', { arbitrary: 'object' }],
    ['integer', 42], ['text', ['item']],
])('excludes unsafe type/value %s %j and continues candidates', (data_type, value) => {
    expect(title({ name: value, title: 'Safe' }, { name: text({ data_type }), title: text() }).text).toBe('Safe');
});
test('numeric relation labels require their already-authorized generated alias', () => {
    const types = { category_id: text({ data_type: 'integer', foreign_table: 'categories', foreign_display_column: 'name',
        foreign_display_metadata: { data_type: 'text', hide_everywhere: false, client_delivery_mode: 'include', is_multilingual: false } }), fallback: text() };
    const extra = { tableMeta: { fk_display_column: 'category_id' } };
    expect(title({ category_id: 4, fallback: 'Safe' }, types, extra).text).toBe('Safe');
    expect(title({ category_id: 4, 'category_name (ln)': 'Category', fallback: 'Safe' }, types, extra).text).toBe('Category');
    expect(title({ category_id: 4, 'category_name (ln)': 'Private', fallback: 'Safe' }, {
        ...types, category_id: { ...types.category_id, hide_everywhere: true },
    }, extra).text).toBe('Safe');
});
test('relation aliases cannot conceal a secret or body source column', () => {
    for (const foreign_display_column of ['api_token', 'description', 'content']) {
        const types = { category_id: text({ data_type: 'integer', foreign_table: 'categories', foreign_display_column,
            foreign_display_metadata: { data_type: 'text', hide_everywhere: false, client_delivery_mode: 'include', is_multilingual: false } }), safe: text() };
        expect(title({ category_id: 4, 'category_name (ln)': 'Private', safe: 'Safe' }, types,
            { tableMeta: { fk_display_column: 'category_id' } }).text).toBe('Safe');
    }
});
test.each([
    ['fi-FI', { fi: 'Suomi', en: 'English' }, 'Suomi'],
    ['fi-FI', { 'fi-fi': 'Alue', fi: 'Suomi', en: 'English' }, 'Alue'],
    ['de', { fi: 'Suomi', en: 'English' }, 'English'],
    ['de', { fi: 'Suomi' }, 'Suomi'],
    ['fi', { fi: '', en: 'English' }, 'Next'],
])('resolves locale maps and honors explicit empty %s %j', (language, value, expected) => {
    expect(title({ name: value, title: 'Next' }, { name: text({ data_type: 'jsonb', is_multilingual: true }), title: text() }, { preferredLanguage: language }).text).toBe(expected);
});
test('translations apply only to +lang_key fields; ordinary keys stay data', () => {
    const row = { key: 'hello_key' };
    expect(title(row, { key: text({ card_element: 'header+lang_key' }) }, { preferredLanguage: 'fi' }).text).toBe('Hei');
    expect(title(row, { key: text() }, { preferredLanguage: 'fi' }).text).toBe('hello_key');
});
test.each([['en', 'Record 0'], ['fi', 'Tietue 0'], ['zh-TW', '記錄 0']])('localizes authorized ID fallback in %s', (language, expected) => {
    expect(title({ id: 0 }, { id: { data_type: 'integer' } }, { preferredLanguage: language }).text).toBe(expected);
});
test('missing, hidden and unauthorized IDs never become fallback values', () => {
    expect(title({ id: 3 }, {}).text).toBe('Record');
    expect(title({ id: 3 }, { id: { hide_everywhere: true } }).text).toBe('Record');
    expect(title({ id: 3 }, { id: { card_element: 'hidden' } }).text).toBe('Record');
});
test('article ownership visibility is honored without losing article-only names', () => {
    const types = { name: text({ hide_on_bg_crd_if_not_own: true, hide_on_small_card: true }), safe: text() };
    expect(title({ name: 'Own', safe: 'Safe' }, types, { surface: 'article' }).text).toBe('Safe');
    expect(title({ name: 'Own', safe: 'Safe' }, types, { surface: 'article', rowIsViewersOwn: true }).text).toBe('Own');
});

test.each([
    ['fi-FI', { fi: 'Contact', en: 'Other' }, 'fi'],
    ['fi-FI', { 'FI_fi': 'Contact', fi: 'Other' }, 'fi-fi'],
    ['fi', { fi: null, en: 'Contact' }, 'en'],
    ['fi', { sv: 'Contact' }, 'sv'],
])('returns the actual related-label language for %s %j', (language, label, expectedLanguage) => {
    const row = { category_id: 9, category_name: JSON.stringify(label) };
    const types = { category_id: text({ card_element: 'header', data_type: 'integer', foreign_table: 'categories',
        foreign_display_column: 'name', foreign_display_metadata: { data_type: 'text',
            hide_everywhere: false, client_delivery_mode: 'include', is_multilingual: true } }) };
    const result = title(row, types, { preferredLanguage: language });
    expect(result).toMatchObject({ text: 'Contact', language: expectedLanguage });
    expect(result.headers[0].language).toBe(expectedLanguage);
});

test('plain text, dictionary titles and generated titles expose an unknown comparison language', () => {
    expect(title({ name: 'Contact' }, { name: text() }).language).toBe('');
    expect(title({ name: 'hello_key' }, { name: text({ card_element: 'header+lang_key' }) }).language).toBe('');
    expect(title({ id: 5 }, { id: { data_type: 'integer' } }).language).toBe('');
});

const relation = (target = {}, extra = {}) => text({
    data_type: 'integer', foreign_table: 'customers', foreign_display_column: 'name',
    foreign_display_metadata: { data_type: 'text', hide_everywhere: false,
        client_delivery_mode: 'include', is_multilingual: false, ...target }, ...extra,
});

test.each([
    ['hidden target', { hide_everywhere: true }],
    ['not delivered', { client_delivery_mode: 'server_only' }],
    ['unknown delivery', { client_delivery_mode: undefined }],
    ['unknown hiding', { hide_everywhere: undefined }],
    ['unknown type', { data_type: undefined }],
    ['numeric target', { data_type: 'integer' }],
    ['ordinary JSON', { data_type: 'jsonb', is_multilingual: false }],
    ['undeclared JSON', { data_type: 'jsonb', is_multilingual: undefined }],
    ['binary', { data_type: 'bytea', is_multilingual: true }],
])('rejects %s relation aliases for both configured and inferred titles', (_label, target) => {
    for (const card_element of ['header', 'details']) {
        for (const alias of ['Hidden', { en: 'Hidden', fi: 'Piilossa' }]) {
            expect(title({ customer_id: 1, 'customer_name (ln)': alias, safe: 'Safe' }, {
                customer_id: relation(target, { card_element }), safe: text(),
            }).text).toBe('Safe');
        }
    }
});
test.each([undefined, null, {}])('rejects an unproven relation target: %j', foreign_display_metadata => {
    for (const card_element of ['header', 'details']) {
        expect(title({ customer_id: 1, 'customer_name (ln)': 'Unproven', safe: 'Safe' }, {
            customer_id: relation({}, { foreign_display_metadata, card_element }), safe: text(),
        }).text).toBe('Safe');
    }
});
test('visible text aliases still win and declared multilingual aliases use target metadata', () => {
    const row = { customer_id: 1, 'customer_name (ln)': 'Customer', safe: 'Safe' };
    expect(title(row, { customer_id: relation(), safe: text() }).text).toBe('Customer');
    for (const preferredLanguage of ['en', 'fi-FI']) {
        const types = { customer_id: relation({ data_type: 'jsonb', is_multilingual: true }), safe: text() };
        const before = JSON.stringify(types);
        expect(title({ ...row, 'customer_name (ln)': { en: 'Customer', fi: 'Asiakas' } }, types,
            { preferredLanguage }).text).toBe(preferredLanguage === 'en' ? 'Customer' : 'Asiakas');
        expect(JSON.stringify(types)).toBe(before);
    }
    expect(title({ ...row, 'customer_name (ln)': { en: 'Customer', fi: '' } }, {
        customer_id: relation({ data_type: 'jsonb', is_multilingual: true }), safe: text(),
    }, { preferredLanguage: 'fi' }).text).toBe('Safe');
});
test.each(['api_token', 'password', 'private_key'])('rejects secret-like target %s even when configured', foreign_display_column => {
    expect(title({ customer_id: 1, 'customer_name (ln)': 'Private', safe: 'Safe' }, {
        customer_id: relation({}, { foreign_display_column, card_element: 'header' }), safe: text(),
    }).text).toBe('Safe');
});
test.each([
    ['integer', 42, '42'], ['numeric', 3.5, '3.5'], ['boolean', false, 'false'],
    ['date', '2026-10-15', '2026-10-15'], ['timestamp', '2026-10-15T09:00:00Z', '2026-10-15T09:00:00Z'],
    ['text', 'x'.repeat(161), 'x'.repeat(161)], ['text', 'first\nsecond', 'first\nsecond'],
    ['text', '{"note":"text"}', '{"note":"text"}'], ['text', '[ordinary text]', '[ordinary text]'],
])('configured %s headers preserve existing formatting and win over name', (data_type, raw, expected) => {
    const result = title({ code: raw, name: 'Name' }, { code: text({ data_type, card_element: 'header' }), name: text() });
    expect(result.text).toBe(expected);
    expect(result.headers.map(item => item.text)).toEqual([expected]);
});
test('numeric and long configured members all stay in layout order', () => {
    const result = title({ a: 'First', code: 42, long: 'x'.repeat(170), name: 'Name' }, {
        a: text({ card_element: 'header', co_number: 4 }),
        code: text({ data_type: 'integer', card_element: 'header', co_number: 1 }),
        long: text({ card_element: 'header', co_number: 2 }), name: text(),
    });
    expect(result.headers.map(item => item.text)).toEqual(['First', '42', 'x'.repeat(170)]);
});
test('a configured description is kept while inference still rejects body names and roles', () => {
    expect(title({ description: 'Chosen heading', name: 'Name' }, {
        description: text({ card_element: 'header,description' }), name: text(),
    }).text).toBe('Chosen heading');
    for (const column of ['description', 'kuvaus', 'content', 'body', 'translation', 'payload', 'metadata']) {
        expect(title({ [column]: 'Body', safe: 'Safe' }, { [column]: text(), safe: text() }).text).toBe('Safe');
    }
    expect(title({ name: 'Description role', safe: 'Safe' }, {
        name: text({ card_element: 'description' }), safe: text(),
    }).text).toBe('Safe');
});
test('surface and null/false visibility still exclude configured values', () => {
    expect(title({ code: 42, name: 'Safe' }, {
        code: text({ data_type: 'integer', card_element: 'header', hide_on_bg_crd_if_not_own: true }), name: text(),
    }, { surface: 'article' }).text).toBe('Safe');
    expect(title({ code: false, name: 'Safe' }, {
        code: text({ data_type: 'boolean', card_element: 'header', hide_false_null_on_sml_crd: true }), name: text(),
    }).text).toBe('Safe');
});

test.each(['bytea', 'vector', 'geometry', 'ARRAY', 'jsonb'])('unsafe %s stays excluded even as a configured header', data_type => {
    expect(title({ code: 'Unsafe', name: 'Safe' }, {
        code: text({ data_type, card_element: 'header' }), name: text(),
    }).text).toBe('Safe');
});
test('target schema without its actual column name is still unproven', () => {
    expect(title({ customer_id: 1, 'customer_name (ln)': 'Unproven', safe: 'Safe' }, {
        customer_id: relation({}, { foreign_display_column: undefined, card_element: 'header' }), safe: text(),
    }).text).toBe('Safe');
});
