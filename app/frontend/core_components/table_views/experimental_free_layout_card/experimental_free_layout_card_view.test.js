// @vitest-environment jsdom
// experimental_free_layout_card_view.test.js
// Proves language selection through the actual experimental card builder and rebuilder.
// Connects explicit refresh language to multilingual fields while browser preference differs.
// Prevents a card refresh from silently rereading an unrelated stored language.
import { afterEach, expect, test, vi } from 'vitest';
import { createExperimentalFreeLayoutCard, rebuildExperimentalFreeLayoutCard, clearExperimentalFreeLayoutWorkingCache } from './experimental_free_layout_card_view.js';
import { disposeCardResources } from '../card_view/card_resource_lifecycle.js';

vi.mock('../card_view/row_article_opener.js', () => ({ openRowArticleView: vi.fn() }));
vi.mock('../card_view/card_avatar_builder.js', () => ({
    create_seeded_avatar: vi.fn(async () => document.createElement('span')),
    createImageElement: vi.fn(() => document.createElement('img')),
}));

afterEach(() => {
    document.querySelectorAll('.card').forEach(disposeCardResources);
    document.body.innerHTML = ''; localStorage.clear();
    clearExperimentalFreeLayoutWorkingCache('events');
});

test('an explicit rebuild language wins; a rebuild without it still uses browser preference', async () => {
    localStorage.setItem('chosen_language', 'en');
    const card = await createExperimentalFreeLayoutCard({
        rowItem: { id: 7, title: { en: 'Article', fi: 'Artikkeli' } }, columns: ['title'], tableName: 'events',
        dataTypes: { title: { card_element: 'header', show_value_on_card: true, is_multilingual: true } },
        renderContext: { hasDeleteRight: false, tableHasImageRole: false },
    });
    document.body.append(card); card.classList.add('small-card');
    expect(card._renderedLanguage).toBe('en'); expect(card.textContent).toContain('Article');
    const finnish = await rebuildExperimentalFreeLayoutCard(card, vi.fn(), 'fi');
    document.body.append(finnish);
    expect(finnish._renderedLanguage).toBe('fi'); expect(finnish.textContent).toContain('Artikkeli');
    expect(finnish.classList.contains('small-card')).toBe(true);
    const english = await rebuildExperimentalFreeLayoutCard(finnish, vi.fn());
    document.body.append(english);
    expect(english._renderedLanguage).toBe('en'); expect(english.textContent).toContain('Article');
});
