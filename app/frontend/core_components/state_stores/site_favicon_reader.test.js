// site_favicon_reader.test.js
// Proves display icons use the server's chosen variant and fallback.
// Connects both identity builders to real head metadata without guessing filenames.
// Guards old heads and absent icons alongside the two-size contract.
import { afterEach, expect, test } from 'vitest';
import { getSiteDisplayFaviconHref } from './site_favicon_reader.js';
afterEach(() => document.head.replaceChildren());

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
