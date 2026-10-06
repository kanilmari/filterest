// favorites_css.test.js
// Guards star layout, shared administration colours and CSP-safe icon masks.
// Bridges favourites styles with navbar button rules and same-origin icon files.
// Keeps the touch target unmasked, aligned and visible during interaction.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, 'favorites.css'), 'utf8');
const navbarCss = readFileSync(resolve(here, '../navbar/navbar_layout.css'), 'utf8');
const favoriteControls = '#navbar :is(#admin_tools_tree, #navbarFavoritesSection)';
const adminTools = ':is(#admin_tools_tree, #navbarFavoritesSection) .general_button_admin';

function declarationsFor(selector, stylesheet = css) {
    const rules = [...stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    return rules.filter((match) => match[1].trim().endsWith(selector))
        .map((match) => match[2]).join('\n');
}

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

test('keeps an unmasked 44px button around a decorative masked icon', () => {
    const button = declarationsFor(`${favoriteControls} .favorite-star`);
    expect(button).toContain('flex: 0 0 44px;');
    expect(button).toContain('width: 44px;');
    expect(button).toContain('height: 44px;');
    expect(button).toContain('background-color: transparent;');
    expect(button).toContain('border-radius: var(--border_radius_small);');
    expect(button).not.toMatch(/\bmask(?:-image)?:/);
    const icon = declarationsFor(`${favoriteControls} .favorite-star-icon`);
    expect(icon).toContain("mask: url('/frontend/icons/symbols/star.svg')");
    expect(icon).toContain('pointer-events: none;');
    expect(icon).toContain('background-color: var(--empty_field_text_color);');
    const selected = declarationsFor(`${favoriteControls} .favorite-star[aria-pressed='true'] > .favorite-star-icon`);
    expect(selected).toContain('background-color: var(--primary_color);');
    expect(selected).toContain("mask-image: url('/frontend/icons/general/star-filled-icon.svg');");
});

test('aligns stars across nested rows while preserving content-sized tree tiles', () => {
    const nodes = declarationsFor('#admin_tools_tree .node:has(.favorite-star)');
    expect(nodes).toContain('width: 100%;');
    expect(nodes).toContain('box-sizing: border-box;');
    expect(declarationsFor(`${favoriteControls} .favorite-star`)).toContain('margin: 0 0 0 auto !important;');
    expect(declarationsFor('#admin_tools_tree .favorite-tool-label')).toContain('flex: 0 1 auto;');
    expect(declarationsFor('#navbarFavoritesSection li > .navigation_buttons')).toContain('flex: 1 1 auto;');
});

test('paints hover behind the star and keyboard focus on the unmasked controls', () => {
    const hover = declarationsFor(`${favoriteControls} .favorite-star:hover:not(:disabled)`);
    expect(hover).toContain('background-color: var(--button_hover_bg_color);');
    expect(hover).not.toMatch(/\bmask|width:|height:|margin:|padding:|transform:/);
    expect(css).toContain(`${favoriteControls} .favorite-star:focus-visible,`);
    const focus = declarationsFor('#navbarFavoritesSection .general_button_admin:focus-visible');
    expect(focus).toContain('outline: 3px solid var(--interaction-focus-ring);');
    expect(focus).toContain('outline-offset: 2px;');
    expect(declarationsFor(`${favoriteControls} .favorite-star:focus-visible`)).toContain('outline-offset: -3px;');
    expect(css).not.toContain(':has(> .favorite-star:focus-visible)');
});

test('quick-list tools share the administration palette rather than defining a second one', () => {
    expect(declarationsFor(adminTools, navbarCss)).toContain('background-color: rgb(63 50 120 / 0.15);');
    expect(declarationsFor(`${adminTools}:hover`, navbarCss)).toContain('background-color: rgb(75 60 160 / 0.3);');
    const active = declarationsFor(`${adminTools}:is(.active, :active, :focus-visible)`, navbarCss);
    expect(active).toContain('background-color: rgb(75 50 180 / 0.25);');
    expect(active).toContain('color: var(--button_active_text_color);');
    expect(declarationsFor('#navbarFavoritesSection li > .navigation_buttons')).not.toMatch(/background(?:-color)?:/);
});
