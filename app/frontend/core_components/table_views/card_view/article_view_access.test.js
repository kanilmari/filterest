// article_view_access.test.js
// Proves route-gated semantics and explanations for signed-in and guest viewers.
// Connects the actual browser permission cache with click and keyboard activation.
// Protects existing opener behavior and state from denied activations.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { applyArticleViewAffordance, bindArticleViewActivation, createArticleOpenerElement } from './article_view_access.js';

vi.mock('../../lang/translation_handler.js', () => ({ getTranslationForKey: (_key, { fallback }) => fallback }));

beforeEach(() => {
    document.body.replaceChildren();
    sessionStorage.clear();
    localStorage.clear();
    localStorage.setItem('chosen_language', 'fi');
});

describe.each(['login', 'logout'])('article access in %s mode', mode => {
    test.each(['click', 'Enter', ' '])('denied %s explains without opening', activation => {
        localStorage.setItem('button_state', mode);
        const element = createArticleOpenerElement('button');
        const open = vi.fn();
        bindArticleViewActivation(element, open, { keyboard: true });
        document.body.append(element);
        expect(element.tagName).toBe('SPAN');
        expect(element.hasAttribute('role')).toBe(false);
        expect(element.hasAttribute('tabindex')).toBe(false);
        if (activation === 'click') element.click();
        else element.dispatchEvent(new KeyboardEvent('keydown', { key: activation, bubbles: true }));
        expect(open).not.toHaveBeenCalled();
        expect(document.querySelector('[role="alert"]').textContent).toContain('Artikkelia ei voi avata');
    });
    test.each(['click', 'Enter', ' '])('allowed %s keeps the opener', activation => {
        sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/article_view']));
        const element = createArticleOpenerElement('button');
        const open = vi.fn();
        bindArticleViewActivation(element, open, { keyboard: true });
        if (activation === 'click') element.click();
        else element.dispatchEvent(new KeyboardEvent('keydown', { key: activation }));
        expect(open).toHaveBeenCalledOnce();
        expect(element.tagName).toBe('BUTTON');
    });
});

test('an unavailable anchor has no link role or tab stop', () => {
    const link = document.createElement('a');
    link.href = '/events/1';
    link.tabIndex = 0;
    link.setAttribute('role', 'link');
    applyArticleViewAffordance(link);
    expect(link.hasAttribute('href')).toBe(false);
    expect(link.hasAttribute('role')).toBe(false);
    expect(link.hasAttribute('tabindex')).toBe(false);
});


test.each(['click', 'Enter', ' '])('a denied title child also explains %s activation', activation => {
    const title = document.createElement('div');
    const value = document.createElement('span'); value.textContent = 'Article'; title.append(value);
    const open = vi.fn(); bindArticleViewActivation(title, open); document.body.append(title);
    if (activation === 'click') value.click();
    else value.dispatchEvent(new KeyboardEvent('keydown', { key: activation, bubbles: true }));
    expect(open).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]').textContent).toContain('Artikkelia ei voi avata');
});

test('an independent field control inside a denied opener keeps its own activation', () => {
    const title = document.createElement('div');
    const button = document.createElement('button'); title.append(button);
    const edit = vi.fn(); const open = vi.fn(); button.addEventListener('click', edit);
    bindArticleViewActivation(title, open); document.body.append(title);
    button.click();
    const key = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }); button.dispatchEvent(key);
    expect(edit).toHaveBeenCalledOnce();
    expect(key.defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')).toBeNull();
});
