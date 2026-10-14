// @vitest-environment jsdom
// menu_button_css.test.js
// Proves shell controls release paint with ownership during panel transitions.
// Connects accessibility attributes to the real opener/closer stylesheet.
// Models intermediate ancestor opacity because jsdom does not animate CSS.
import { afterEach, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let style;
afterEach(() => {
    style?.remove();
    document.body.replaceChildren();
    document.body.className = '';
});

test.each(['light', 'dark'].flatMap(theme => ['showMenuButton', 'hideMenuButton'].map(id => ({ theme, id }))))(
    '$theme releases $id paint immediately throughout its ancestor fade', ({ theme, id }) => {
    style = document.createElement('style');
    style.textContent = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'menu_button.css'), 'utf8');
    document.head.append(style);
    document.body.className = `${theme}-mode`;
    document.body.innerHTML = `<div class="body_content navbar-transitions-ready"><div id="navbar">
        <div><button id="${id}" class="menu-toggle-visible" aria-hidden="false" tabindex="0">
        <span class="environment-badge">TEST</span></button></div></div></div>`;
    const button = document.getElementById(id);
    const host = button.parentElement;
    expect(getComputedStyle(button).visibility).toBe('visible');
    button.setAttribute('aria-hidden', 'true'); button.tabIndex = -1;
    for (const opacity of [1, 0.5, 0]) {
        host.style.opacity = String(opacity);
        expect(getComputedStyle(button).visibility).toBe('hidden');
        expect(getComputedStyle(button.firstElementChild).visibility).toBe('hidden');
    }
    button.setAttribute('aria-hidden', 'false'); button.tabIndex = 0;
    host.style.opacity = '1';
    expect(getComputedStyle(button).visibility).toBe('visible');
});
