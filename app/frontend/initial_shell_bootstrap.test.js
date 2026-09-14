// @vitest-environment jsdom
// Exercises first-paint state with delayed modules and denied browser storage.
// The HTML owns these tiny nonce-authorized scripts; no external request is needed.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const html = readFileSync('frontend/index.html', 'utf8');
const shell = html.match(/<script id="initial-shell-bootstrap"[^>]*>([\s\S]*?)<\/script>/)[1];
const run = () => window.eval(shell);
const initialOpen = () => document.querySelector('.body_content')?.dataset.navbarInitialOpen;

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '<div class="body_content"></div>';
    document.documentElement.style.setProperty('--navbar-breakpoint', '1850px');
    vi.stubGlobal('innerWidth', 1900);
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('style');
});

describe('shell before application modules', () => {
    test.each([
        [1900, null, null, 'true'],
        [1000, null, null, 'false'],
        [1900, 'false', 'true', 'false'],
        [1000, 'false', 'true', 'true'],
        [1900, 'true', 'false', 'true'],
        [1000, 'true', 'false', 'false'],
    ])('restores viewport-specific visibility at width %i', (width, wide, narrow, expected) => {
        vi.stubGlobal('innerWidth', width);
        if (wide !== null) localStorage.setItem('navVisibleWide', wide);
        if (narrow !== null) localStorage.setItem('navVisibleNarrow', narrow);
        run();
        expect(initialOpen()).toBe(expected);
    });

    test('uses the CSS breakpoint including the exact boundary', () => {
        document.documentElement.style.setProperty('--navbar-breakpoint', '1500px');
        vi.stubGlobal('innerWidth', 1500);
        run();
        expect(initialOpen()).toBe('true');
    });

    test('keeps the narrow shell usable when storage is denied', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('denied'); });
        expect(run).not.toThrow();
        expect(initialOpen()).toBe('false');
    });

    test('uses the shared fallback if CSS cannot be read', () => {
        vi.spyOn(window, 'getComputedStyle').mockImplementation(() => { throw Error('unavailable'); });
        run();
        expect(initialOpen()).toBe('true');
    });

    test.each([['fi-FI', 'Hei IE-käyttäjä!'], ['en-US', 'Hello IE user!']])(
        'shows a localized unsupported-browser message for %s',
        (language, message) => {
            vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 Trident/7.0');
            vi.spyOn(navigator, 'language', 'get').mockReturnValue(language);
            run();
            expect(document.querySelector('h1')?.textContent).toBe(message);
            expect(document.querySelector('a')?.href).toBe('https://brave.com/download/');
        },
    );

    test('does not expose globals or depend on either external bootstrap', () => {
        run();
        run();
        expect(window.bootstrapInitialNavbarState).toBeUndefined();
        expect(html).not.toMatch(/src="[^"]*(?:initial_browser_check|site_presentation_bootstrap)\.js"/);
        expect(html.indexOf('id="site-presentation-bootstrap"')).toBeLessThan(html.indexOf('<link rel="stylesheet"'));
        expect(html.indexOf('id="initial-shell-bootstrap"')).toBeLessThan(html.indexOf('id="main-bundle"'));
    });
});
