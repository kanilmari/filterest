// article_view_access_translation.test.js
// Exercises denied openers with the real toast and DOM translation observer.
// Connects settled page localization to title/image pointer and keyboard notices.
// Guards against a notice refreshing cards, permissions or ancestor selection.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { refreshCards, endpoint } = vi.hoisted(() => ({
    refreshCards: vi.fn().mockResolvedValue(undefined), endpoint: vi.fn(),
}));
vi.mock('./card_view_printer.js', () => ({ refreshCardLanguages: refreshCards }));
vi.mock('../../endpoints/endpoint_router.js', () => ({ endpoint_router: endpoint }));
vi.mock('../../lang/dev_lang_key_editor.js', () => ({ initDevLangKeyEditor: vi.fn() }));

const NativeObserver = globalThis.MutationObserver;
let observers;
beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers();
    sessionStorage.clear(); localStorage.clear(); document.body.replaceChildren();
    localStorage.setItem('chosen_language', 'en');
    window.translationPromises = { en: Promise.resolve({ article_view_permission_missing: 'Reviewed article denial' }) };
    observers = [];
    vi.stubGlobal('MutationObserver', class extends NativeObserver {
        constructor(callback) { super(callback); observers.push(this); }
    });
});
afterEach(() => {
    observers.forEach(observer => observer.disconnect());
    vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
    delete window.translationPromises;
    document.body.replaceChildren(); sessionStorage.clear(); localStorage.clear();
});

describe.each(['login', 'logout'])('settled denied notices in %s mode', mode => {
    test.each(['title', 'image'])('%s notices translate without refreshing the retained view', async part => {
        localStorage.setItem('button_state', mode);
        const { translatePage } = await import('../../lang/translation_handler.js');
        const { bindArticleViewActivation } = await import('./article_view_access.js');
        const { bindImageFirstViewActivation } = await import('./image_first_view_activation.js');
        const { getSessionGeneration } = await import('../../auth/session_generation_store.js');
        const card = document.createElement('div'); card.className = 'card selected';
        const title = document.createElement('div'), image = document.createElement('img');
        title.dataset.retainedDenialProof = 'yes'; card.append(title, image); document.body.append(card);
        const open = vi.fn(), ancestor = vi.fn(); card.addEventListener('click', ancestor);
        card.addEventListener('keydown', ancestor);
        bindArticleViewActivation(title, open); bindImageFirstViewActivation(image, { imageSrc: '/photo.jpg' }, open);
        await translatePage('en');
        refreshCards.mockClear(); endpoint.mockClear();
        const generation = getSessionGeneration(), address = location.href;
        const target = part === 'title' ? title : image;
        for (const key of ['click', 'Enter', ' ']) {
            const before = document.querySelectorAll('[data-lang-key="article_view_permission_missing"]').length;
            if (key === 'click') target.click();
            else target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
            // Deliver native observer callbacks; fake timers keep earlier notices alive.
            await Promise.resolve(); await Promise.resolve();
            const explanations = document.querySelectorAll('[data-lang-key="article_view_permission_missing"]');
            expect(explanations).toHaveLength(before + 1);
            expect(explanations[before].textContent).toBe('Reviewed article denial');
            expect(refreshCards).not.toHaveBeenCalled(); expect(endpoint).not.toHaveBeenCalled();
            expect(document.querySelector('.card')).toBe(card);
            expect(card.querySelector('[data-retained-denial-proof="yes"]')).toBe(title);
            expect(card.className).toBe('card selected');
            expect(location.href).toBe(address); expect(getSessionGeneration()).toBe(generation);
            expect(open).not.toHaveBeenCalled(); expect(ancestor).not.toHaveBeenCalled();
        }
    });
});
