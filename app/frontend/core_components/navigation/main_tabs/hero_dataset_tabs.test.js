// hero_dataset_tabs.test.js
// Proves shared destinations, navigation, language and media-dependent button shape.
// Connects the approved tab projection and shell media flag to the hero and Home.
// Keeps translated labels and interaction styles intact as corners change.
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const mocks = vi.hoisted(() => ({
    snapshot: [], listeners: new Set(), unsubscribe: vi.fn(), open: vi.fn(),
}));
vi.mock('./main_dataset_tabs.js', () => ({
    getMainDatasetTabs: () => mocks.snapshot,
    subscribeMainDatasetTabs: (listener) => {
        mocks.listeners.add(listener);
        return () => { mocks.unsubscribe(); mocks.listeners.delete(listener); };
    },
}));
vi.mock('./main_tab_printer.js', () => ({ openNavTab: mocks.open }));
vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback }) => {
        const copies = { fi: { places: 'Paikat', articles: 'Artikkelit' },
            en: { places: 'Places', articles: 'Articles' } };
        return copies[document.documentElement.lang]?.[key] || fallback;
    },
}));
import { createHeroDatasetTabs } from './hero_dataset_tabs.js';
const directory = dirname(fileURLToPath(import.meta.url));
const heroCss = readFileSync(resolve(directory, 'hero_dataset_tabs.css'), 'utf8');
const homeCss = readFileSync(resolve(directory, '../../front_page/top_nav_home_button.css'), 'utf8');

const tab = (dataset, extras = {}) => Object.freeze({
    id: dataset, dataset, text: dataset, langKey: dataset, iconKey: 'table', ...extras,
});
const publish = (snapshot) => {
    mocks.snapshot = Object.freeze(snapshot);
    for (const listener of mocks.listeners) listener(mocks.snapshot);
};
let controls;
beforeEach(() => {
    document.body.replaceChildren();
    document.body.removeAttribute('data-view-has-presentation-media');
    document.documentElement.lang = 'fi';
    mocks.listeners.clear();mocks.unsubscribe.mockClear();mocks.open.mockReset();
    mocks.open.mockResolvedValue(undefined);
    mocks.snapshot = Object.freeze([tab('places'), tab('articles')]);
    controls = [];
});
afterEach(() => { for (const control of controls) control.destroy(); });
function mount(active = 'places') {
    const control = createHeroDatasetTabs(active);controls.push(control);
    document.body.appendChild(control.element);return control;
}
const buttons = (control) => [...control.element.querySelectorAll('button')];

describe('hero dataset tabs', () => {
    test('the one shell CSS rule squares hero and Home buttons while preserving selection and copy', () => {
        const style = document.createElement('style');
        // jsdom does not resolve custom-property fallbacks in border-radius.
        style.textContent = (heroCss + homeCss).replaceAll('var(--navigation-radius, 8px)', '8px');
        document.body.append(style);
        const control = mount();
        const home = document.createElement('a');
        home.className = 'navbar-front-page-link top-nav-home-button';
        home.setAttribute('aria-current', 'page');
        home.textContent = 'Etusivu';
        control.element.prepend(home);
        const destinations = [home, ...buttons(control)];
        const before = destinations.map(button => getComputedStyle(button).borderRadius);
        expect(before).toEqual(['8px', '8px', '8px']);
        document.body.setAttribute('data-view-has-presentation-media', 'true');
        expect(destinations.map(button => getComputedStyle(button).borderRadius)).toEqual(['0px', '0px', '0px']);
        expect(home.getAttribute('aria-current')).toBe('page');
        expect(buttons(control)[0].getAttribute('aria-current')).toBe('page');
        expect(buttons(control).map(button => button.textContent)).toEqual(['Paikat', 'Artikkelit']);
        document.body.setAttribute('data-view-has-presentation-media', 'false');
        expect(destinations.map(button => getComputedStyle(button).borderRadius)).toEqual(before);
    });

    test('uses only the ordered shared snapshot and keeps navbar geometry classes separate', () => {
        const control = mount();
        expect(buttons(control).map(button => button.dataset.dataset)).toEqual(['places', 'articles']);
        expect(buttons(control).map(button => button.textContent)).toEqual(['Paikat', 'Artikkelit']);
        expect(control.element.querySelector('.navtablinks')).toBeNull();
        expect(control.element.getAttribute('aria-label')).toBe('Aineistot');
        expect(buttons(control)[0].getAttribute('aria-current')).toBe('page');
        expect(buttons(control)[1].hasAttribute('aria-current')).toBe(false);
        expect(mocks.open).not.toHaveBeenCalled();
    });

    test('updates snapshot order and removals while preserving reused focused buttons', () => {
        const control = mount();
        const focused = buttons(control)[1];focused.focus();
        publish([tab('articles'), tab('places'), tab('extra', { text: 'Extra' })]);
        expect(buttons(control)[0]).toBe(focused);
        expect(document.activeElement).toBe(focused);
        publish([tab('articles')]);
        expect(buttons(control)).toEqual([focused]);
        expect(document.activeElement).toBe(focused);
    });

    test('updates FI→EN→FI in place without navigation or losing focus', async () => {
        const control = mount();
        const focused = buttons(control)[1];focused.focus();
        document.documentElement.lang = 'en';await Promise.resolve();
        expect(focused.textContent).toBe('Articles');
        expect(control.element.getAttribute('aria-label')).toBe('Datasets');
        expect(document.activeElement).toBe(focused);
        document.documentElement.lang = 'fi';await Promise.resolve();
        expect(focused.textContent).toBe('Artikkelit');
        expect(document.activeElement).toBe(focused);
        expect(mocks.open).not.toHaveBeenCalled();
    });

    test.each([['ch','数据集'],['yue','資料集'],['fr','Datasets']])('has a safe navigation-label fallback for %s', (language, label) => {
        document.documentElement.lang = language;
        expect(mount().element.getAttribute('aria-label')).toBe(label);
    });

    test('delegates one click through openNavTab and never changes current state on dirty cancellation', async () => {
        mocks.open.mockResolvedValue({ abort: true, reason: 'dirty_check_failed' });
        const control = mount();
        buttons(control)[1].querySelector('span').click();await Promise.resolve();
        expect(mocks.open).toHaveBeenCalledExactlyOnceWith('articles');
        expect(buttons(control)[0].getAttribute('aria-current')).toBe('page');
        expect(buttons(control)[1].hasAttribute('aria-current')).toBe(false);
        expect(control.element.hasAttribute('aria-busy')).toBe(false);
        expect(buttons(control).every(button => button.type === 'button')).toBe(true);
    });

    test('does not duplicate navigation while the current dirty check is pending', async () => {
        let finish;
        mocks.open.mockReturnValue(new Promise(resolve => { finish = resolve; }));
        const control = mount();
        buttons(control)[1].click();buttons(control)[1].click();
        expect(mocks.open).toHaveBeenCalledTimes(1);
        expect(control.element.getAttribute('aria-busy')).toBe('true');
        finish({ abort: true });await Promise.resolve();
        buttons(control)[1].click();
        expect(mocks.open).toHaveBeenCalledTimes(2);
    });

    test('handles empty snapshots and uses safe text and metadata icon fallback', () => {
        mocks.snapshot = Object.freeze([]);
        const control = mount();expect(control.element.hidden).toBe(true);
        publish([tab('unknown', { text: '<img src=x onerror=alert(1)>', iconKey: '../bad.svg' })]);
        expect(control.element.hidden).toBe(false);
        expect(buttons(control)[0].textContent).toBe('<img src=x onerror=alert(1)>');
        expect(control.element.querySelector('img')).toBeNull();
        expect(control.element.querySelector('[data-symbol-key]').dataset.symbolKey).toBe('table');
        publish([]);expect(control.element.hidden).toBe(true);
    });

    test('destroy unsubscribes, disconnects language observation and ignores late updates/clicks', async () => {
        const control = mount();
        const oldButton = buttons(control)[1];
        control.destroy();control.destroy();
        expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
        expect(mocks.listeners.size).toBe(0);
        publish([tab('new')]);
        document.documentElement.lang = 'en';await Promise.resolve();
        oldButton.click();
        expect(oldButton.textContent).toBe('Artikkelit');
        expect(mocks.open).not.toHaveBeenCalled();
        expect(control.element.isConnected).toBe(false);
    });
});
