// publication_copy.test.js
// Proves publication terminology uses language keys with bundled-language fallbacks.
// Connects site-authored translations and locale selection to the same release panel.
// Prevents the publication rename from becoming hardcoded English or Finnish UI text.
import { beforeEach, expect, test, vi } from 'vitest';
const { translated } = vi.hoisted(() => ({ translated: vi.fn() }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: translated }));
import { resolvePublicationCopy } from './publication_copy.js';
beforeEach(() => { translated.mockReset().mockImplementation((_key, options) => options.fallback); });
test.each([['fi', 'Julkaisut'], ['en', 'Publications'], ['ch', '发布'], ['yue', '發佈']])('uses %s publication copy', (language, title) => {
    expect(resolvePublicationCopy(language).goal).toBe(title);
    expect(translated).toHaveBeenCalledWith('workline_publication_goal', { fallback: title, countUsage: false });
});
test('uses the installation translation ahead of fallback copy', () => {
    translated.mockImplementation((key, options) => key === 'workline_publication_goal' ? 'Site publications' : options.fallback);
    expect(resolvePublicationCopy('fi').goal).toBe('Site publications');
});
