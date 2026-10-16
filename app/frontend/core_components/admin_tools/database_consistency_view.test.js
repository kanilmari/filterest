// database_consistency_view.test.js
// Verifies translated pause notices and truthful single/bulk repair controls.
// Connects the report DOM to real seeded fi/en copy and mocked routed requests.
// Protects report-only orphans and skips from appearing as completed deletions.
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generate_database_consistency_view } from './database_consistency_view.js';
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { showConfirmModal } from '../../reusable_components/modal/confirm_modal_builder.js';

vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
vi.mock('../../reusable_components/modal/confirm_modal_builder.js', () => ({ showConfirmModal: vi.fn() }));
const dictionary = vi.hoisted(() => ({ language: 'fi', copy: {} }));
vi.mock('../lang/component_language_dictionary.js', () => ({
    getTranslationForKey: key => dictionary.copy[key]?.[dictionary.language] || key,
}));
const seed = readFileSync(resolve('server_tools/migrations/20261015000004_seed_lang_key_archiving_paused_language_keys.sql'), 'utf8');
for (const match of seed.matchAll(/^ {4}\('([^']+)', '([^']+)', '([^']+)'\)/gm)) {
    dictionary.copy[match[1]] = { fi: match[2], en: match[3] };
}
const orphan = { id: 'cat8_42', table: 'unused_key', description: 'en: "Copy"', description_lang_keys: [
    'consistency_orphan_archiving_paused', 'consistency_orphan_age_days+400',
] };
const garbage = { id: 'cat7_43', table: '<p>old key</p>', description: 'metadata' };
function report(includeOther = false) {
    return { total_count: includeOther ? 3 : 2, categories: [
        { number: 7, title: 'Garbage', issues: [garbage] },
        { number: 8, title: 'Orphans', issues: [orphan] },
        ...(includeOther ? [{ number: 1, title: 'Other', issues: [{ id: 'cat1_old', table: 'old' }] }] : []),
    ] };
}
async function openReport(data = report()) {
    const host = document.createElement('div'); document.body.append(host);
    vi.mocked(endpoint_router).mockResolvedValueOnce(data);
    await generate_database_consistency_view(host);
    host.querySelector('button').click();
    await vi.waitFor(() => expect(host.textContent).toContain('unused_key'));
    return host;
}
beforeEach(() => { document.body.replaceChildren(); vi.clearAllMocks(); dictionary.language = 'fi'; });
afterEach(() => { vi.unstubAllGlobals(); document.documentElement.removeAttribute('data-theme'); });

test.each(['fi', 'en'].flatMap(language => [
    { language, theme: 'light', osDark: false },
    { language, theme: 'dark', osDark: true },
    { language, theme: 'light', osDark: true },
]))('pause copy and controls in $language / $theme / OS dark=$osDark', async ({ language, theme, osDark }) => {
    dictionary.language = language;
    document.documentElement.dataset.theme = theme;
    vi.stubGlobal('matchMedia', () => ({ matches: osDark }));
    const host = await openReport();
    const notice = host.querySelector('[data-lang-key="consistency_orphan_archiving_paused"]');
    expect(notice?.textContent).toBe(dictionary.copy.consistency_orphan_archiving_paused[language]);
    expect(host.querySelector('[data-lang-key="consistency_orphan_age_days+400"]').textContent)
        .toBe(dictionary.copy.consistency_orphan_age_days[language].replace('$count', '400'));
    expect(host.querySelector('[data-lang-key="fix_all"]')).toBeNull();
    expect(notice.parentElement.parentElement.querySelector('button')).toBeNull();
    expect(host.querySelectorAll('[data-lang-key="fix"]')).toHaveLength(1);
    expect(host.textContent).toContain('<p>old key</p>');
    const garbageLabel = [...host.querySelectorAll('span')].find(span => span.textContent === garbage.table);
    expect(garbageLabel.childElementCount).toBe(0);
});

test.each([0, 1])('a guarded single garbage fix reports fixed=%s truthfully', async fixed => {
    const host = await openReport();
    const button = host.querySelector('[data-lang-key="fix"]');
    vi.mocked(endpoint_router).mockResolvedValueOnce({ fixed, errors: [] });
    button.click();
    await vi.waitFor(() => expect(endpoint_router).toHaveBeenLastCalledWith('fixDbConsistency', {
        method: 'POST', body_data: { fix_ids: ['cat7_43'] },
    }));
    await vi.waitFor(() => expect(button.dataset.langKey).toBe(fixed ? 'done' : 'fix'));
    if (!fixed) { expect(button.disabled).toBe(false); expect(button.parentElement.style.opacity).toBe(''); }
});

test('Fix All remains available for other categories and uses the guarded server selection', async () => {
    const host = await openReport(report(true));
    vi.mocked(showConfirmModal).mockResolvedValueOnce(true);
    vi.mocked(endpoint_router).mockResolvedValueOnce({ fixed: 1, errors: [] });
    host.querySelector('[data-lang-key="fix_all"]').click();
    await vi.waitFor(() => expect(endpoint_router).toHaveBeenLastCalledWith('fixDbConsistency', {
        method: 'POST', body_data: { fix_all: true },
    }));
});

test.each(['fi', 'en'])('synthetic and counting-source notices use seeded %s copy', async language => {
    dictionary.language = language;
    const data = report();
    data.categories[1].issues = [{ ...orphan, description_lang_keys: [
        'consistency_synthetic_key_archiving_paused', 'consistency_lang_key_counting_source',
    ] }];
    const host = await openReport(data);
    for (const key of ['consistency_synthetic_key_archiving_paused', 'consistency_lang_key_counting_source']) {
        expect(host.querySelector(`[data-lang-key="${key}"]`).textContent).toBe(dictionary.copy[key][language]);
    }
});
