// favorites_css.test.js
// Guards the favourites stylesheet against images the content-security policy refuses.
// Bridges favorites.css and the application's CSP (img-src 'self' blob:), which applies to mask images.
// A refused mask image hides the whole star button, so every image must be a same-origin file that exists.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, 'favorites.css'), 'utf8');

test('the favourites stylesheet uses no data: images', () => {
    expect(css).not.toMatch(/url\(\s*['"]?data:/i);
});

test('every image the favourites stylesheet names is a file under /frontend/', () => {
    const urls = [...css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((match) => match[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
        expect(url.startsWith('/frontend/')).toBe(true);
        expect(existsSync(resolve(here, '../../../..', url.slice(1)))).toBe(true);
    }
});
