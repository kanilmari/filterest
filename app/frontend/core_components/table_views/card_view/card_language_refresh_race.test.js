// @vitest-environment jsdom
// card_language_refresh_race.test.js
// Exercises overlapping card language builds through the real page translator and refresher.
// Delays only card construction and dictionary responses; keeps card resource disposal real.
// Ensures a newer refresh wins even when it retains already-current mounted cards.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const boundary = vi.hoisted(() => ({ build: vi.fn(), experimental: vi.fn(), article: vi.fn(), endpoint: vi.fn() }));
vi.mock('./card_row_builder.js', () => ({ createSingleCard: boundary.build }));
vi.mock('../experimental_free_layout_card/experimental_free_layout_card_view.js', () => ({
    createExperimentalFreeLayoutCard: vi.fn(), createExperimentalFreeLayoutToolbar: vi.fn(),
    rebuildExperimentalFreeLayoutCard: boundary.experimental,
}));
vi.mock('./row_article_opener.js', () => ({ openRowArticleView: boundary.article }));
vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: boundary.endpoint }));

import { refreshCardLanguages } from './card_view_printer.js';
import { registerCardResource, disposeCardResources } from './card_resource_lifecycle.js';
import { translatePage } from '../../lang/translation_handler.js';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function cardFor(language, experimental = false, id = 7) {
    const card = document.createElement('div');
    card.className = experimental ? 'card experimental-free-layout-card' : 'card';
    card.dataset.id = String(id);
    card._row = { id, title: { en: 'Article', fi: 'Artikkeli', ch: '文章' } };
    card._columns = ['title']; card._table_name = 'events'; card._data_types = { title: { is_multilingual: true } };
    card._hasLocalizedRowData = true; card._renderedLanguage = language;
    card.textContent = card._row.title[language];
    return card;
}
function delayNextBuild(experimental, language) {
    const replacement = cardFor(language, experimental);
    const disposed = vi.fn(), mounted = vi.fn();
    registerCardResource(replacement, disposed);
    replacement.addEventListener('easelect:card-mounted', mounted);
    let finish;
    (experimental ? boundary.experimental : boundary.build)
        .mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve(replacement); }));
    return { replacement, disposed, mounted, finish: () => finish() };
}

beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = ''; localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('chosen_language', 'en');
    window.translationPromises = { en: Promise.resolve({}), ch: Promise.resolve({}) };
    boundary.build.mockImplementation(async (row, _columns, _table, _types, _context, _index, language) => cardFor(language, false, row.id));
    boundary.experimental.mockImplementation(async (card, _selection, language) => cardFor(language, true, card._row.id));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    document.querySelectorAll('.card').forEach(disposeCardResources);
    document.body.innerHTML = ''; delete window.translationPromises;
    vi.restoreAllMocks();
});

test.each([false, true])('failed Finnish dictionary then English retains the English card; experimental=%s', async experimental => {
    const original = cardFor('en', experimental), originalDisposed = vi.fn();
    document.body.append(original); registerCardResource(original, originalDisposed);
    const delayed = delayNextBuild(experimental, 'fi');
    let rejectFinnish;
    window.translationPromises.fi = new Promise((_resolve, reject) => { rejectFinnish = reject; });
    localStorage.setItem('chosen_language', 'fi');
    const failedFinnish = translatePage('fi');
    rejectFinnish(new Error('dictionary unavailable'));
    await failedFinnish;
    await vi.waitFor(() => expect(experimental ? boundary.experimental : boundary.build).toHaveBeenCalledOnce());
    localStorage.setItem('chosen_language', 'en');
    await translatePage('en');
    expect(document.querySelector('.card')).toBe(original);
    delayed.finish(); await settle(); await settle();
    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('.card')).toBe(original);
    expect(original._renderedLanguage).toBe('en'); expect(original.textContent).toBe('Article');
    expect(originalDisposed).not.toHaveBeenCalled();
    expect(delayed.disposed).toHaveBeenCalledOnce(); expect(delayed.mounted).not.toHaveBeenCalled();
    // A subsequent real switch still builds and mounts the requested language.
    window.translationPromises.fi = Promise.resolve({}); localStorage.setItem('chosen_language', 'fi');
    await translatePage('fi');
    expect(document.querySelector('.card')).not.toBe(original);
    expect(document.querySelector('.card')._renderedLanguage).toBe('fi');
    expect(document.querySelector('.card').textContent).toBe('Artikkeli');
    expect(originalDisposed).toHaveBeenCalledOnce();
});

test.each([false, true].flatMap(experimental => ['en', 'ch'].map(language => [experimental, language])))(
    'a newer refresh to %s/%s wins over every older build and remaining card', async (experimental, language) => {
        const original = cardFor('en', experimental), second = cardFor('en', experimental, 8);
        document.body.append(original, second);
        const delayed = delayNextBuild(experimental, 'fi');
        const older = refreshCardLanguages('fi');
        await vi.waitFor(() => expect(experimental ? boundary.experimental : boundary.build).toHaveBeenCalledOnce());
        await refreshCardLanguages(language);
        const currentCards = [...document.querySelectorAll('.card')];
        delayed.finish(); await older;
        expect([...document.querySelectorAll('.card')]).toEqual(currentCards);
        expect(currentCards.map(card => card._renderedLanguage)).toEqual([language, language]);
        expect(delayed.disposed).toHaveBeenCalledOnce(); expect(delayed.mounted).not.toHaveBeenCalled();
        expect(experimental ? boundary.experimental : boundary.build).toHaveBeenCalledTimes(language === 'en' ? 1 : 3);
    }
);

test.each([false, true])('a detached card cannot accept a delayed language build; experimental=%s', async experimental => {
    const original = cardFor('en', experimental); document.body.append(original);
    const delayed = delayNextBuild(experimental, 'fi'), pending = refreshCardLanguages('fi');
    await vi.waitFor(() => expect(experimental ? boundary.experimental : boundary.build).toHaveBeenCalledOnce());
    original.remove(); delayed.finish(); await pending;
    expect(document.querySelector('.card')).toBeNull();
    expect(delayed.disposed).toHaveBeenCalledOnce(); expect(delayed.mounted).not.toHaveBeenCalled();
});

test('article hydration receives the language-refresh lifetime even when the newer pass skips cards', async () => {
    document.body.innerHTML = '<div class="article_view_wrapper"><article class="active_row_article"></article></div>';
    const big = document.querySelector('article'); big._row = { id: 7 }; big._table_name = 'events';
    const card = cardFor('en'); big.parentElement.append(card);
    let finish;
    boundary.article.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const older = refreshCardLanguages('en');
    await vi.waitFor(() => expect(boundary.article).toHaveBeenCalledOnce());
    const guard = boundary.article.mock.calls[0][3]?.isCurrent;
    expect(guard?.()).toBe(true);
    // Its own successful replacement must not cancel later article hydration.
    big.replaceWith(big.cloneNode(true));
    expect(guard()).toBe(true);
    await refreshCardLanguages('en');
    expect(guard()).toBe(false);
    finish(); await older;
});
