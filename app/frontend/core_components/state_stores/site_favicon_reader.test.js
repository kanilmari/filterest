// site_favicon_reader.test.js
// Proves display icons use the server's chosen variant and fallback.
// Connects both identity builders to real head metadata without guessing filenames.
// Guards old heads and absent icons alongside the two-size contract.
import { afterEach, expect, test, vi } from 'vitest';
import * as reader from './site_favicon_reader.js';
const { getSiteDisplayFaviconHref } = reader;
afterEach(() => { document.head.replaceChildren(); document.body.replaceChildren(); document.body.className = ''; vi.restoreAllMocks(); });

test('prefers the resolved 128px head link regardless of head order', () => {
    for (const reverse of [false, true]) {
        const links = ['<link rel="icon" sizes="16x16" href="/chosen-16.png">',
            '<link rel="icon" sizes="128x128" href="/chosen-128.png">'];
        document.head.innerHTML = (reverse ? links.reverse() : links).join('');
        expect(getSiteDisplayFaviconHref()).toMatch(/\/chosen-128\.png$/);
    }
});

test('uses the server fallback and supports old or absent head links', () => {
    document.head.innerHTML = '<link rel="icon" sizes="128x128" href="/fallback-16.png">';
    expect(getSiteDisplayFaviconHref()).toMatch(/\/fallback-16\.png$/);
    document.head.innerHTML = '<link rel="icon" href="/legacy.png">';
    expect(getSiteDisplayFaviconHref()).toMatch(/\/legacy\.png$/);
    document.head.replaceChildren();
    expect(getSiteDisplayFaviconHref()).toBe('');
});

const tick = () => new Promise(resolve => queueMicrotask(resolve));
function homeIcon(theme = 'light', metadata = ' data-home-dark-href="/chosen-128-dark-v1.png"') {
    document.head.innerHTML = `<link rel="icon" sizes="128x128" href="/chosen-128.png"${metadata}>`;
    document.body.className = `${theme}-mode`;
    const icon = document.createElement('img'); document.body.append(icon);
    return { icon, destroy: reader.bindHomeSiteFavicon(icon) };
}

test.each(['light', 'dark'])('Home initially follows %s despite the opposite OS theme, then follows body changes', async theme => {
    const system = new EventTarget(); system.matches = theme === 'light';
    const media = vi.fn(() => system);
    vi.stubGlobal('matchMedia', media);
    const { icon, destroy } = homeIcon(theme);
    try {
        const suffix = theme === 'dark' ? '-128-dark-v1.png' : '-128.png';
        expect(icon.src.endsWith(suffix)).toBe(true);
        system.matches = !system.matches; system.dispatchEvent(new Event('change')); await tick();
        expect(icon.src.endsWith(suffix)).toBe(true);
        expect(getSiteDisplayFaviconHref()).toMatch(/chosen-128\.png$/);
        document.body.className = `${theme === 'light' ? 'dark' : 'light'}-mode`;
        await tick();
        expect(icon.src.endsWith('-128-dark-v1.png')).toBe(theme === 'light');
        expect(media).not.toHaveBeenCalled();
        expect(icon.hasAttribute('style')).toBe(false);
        expect(icon.hasAttribute('onerror')).toBe(false);
    } finally { destroy(); vi.unstubAllGlobals(); }
});

test('missing dark metadata and old heads retain their original image', async () => {
    const { icon, destroy } = homeIcon('dark', '');
    try {
        expect(icon.src).toMatch(/chosen-128\.png$/);
        document.body.className = 'light-mode'; await tick();
        expect(icon.src).toMatch(/chosen-128\.png$/);
    } finally { destroy(); }
    document.head.replaceChildren();
    const absent = document.createElement('img');
    const cleanup = reader.bindHomeSiteFavicon(absent);
    expect(absent.hidden).toBe(true); expect(absent.hasAttribute('src')).toBe(false); cleanup();
});

test('a failed dark image falls back once for this binding, including later toggles', async () => {
    const { icon, destroy } = homeIcon('dark');
    try {
        expect(icon.src).toMatch(/chosen-128-dark-v1\.png$/);
        icon.dispatchEvent(new Event('error'));
        expect(icon.src).toMatch(/chosen-128\.png$/);
        const changed = vi.spyOn(icon, 'src', 'set');
        icon.dispatchEvent(new Event('error'));
        document.body.className = 'light-mode'; await tick();
        document.body.className = 'dark-mode'; await tick();
        expect(icon.src).toMatch(/chosen-128\.png$/);
        expect(changed).not.toHaveBeenCalled();
    } finally { destroy(); }
});

test('teardown disconnects the body observer and removes the error listener', async () => {
    const { icon, destroy } = homeIcon('dark');
    document.body.className = 'light-mode'; // A queued observer delivery must also be cancelled.
    destroy(); await tick();
    icon.dispatchEvent(new Event('error'));
    expect(icon.src).toMatch(/chosen-128-dark-v1\.png$/);
});
