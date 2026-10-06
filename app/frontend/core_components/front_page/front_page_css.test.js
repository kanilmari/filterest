// front_page_css.test.js
// Guards Home's responsive surfaces, sized backgrounds and long accessible labels.
// Reads the shipped styles because jsdom cannot lay out a phone viewport or ellipsis.
// Complements DOM tests; native light/dark browser proofs remain the integration check.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(currentDirectory, 'front_page.css'), 'utf8');
const navbar = readFileSync(resolve(currentDirectory, '../navigation/navbar/navbar_layout.css'), 'utf8');

test('Home uses the reserved grid area and a phone-sized single column', () => {
    expect(navbar).toMatch(/#navbar > #navbarFrontPage\s*\{\s*grid-area: front-page;/);
    expect(css).toMatch(/@media \(width <= 600px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/);
    expect(css).toContain('min-height: 44px;');
    // The shared paragraph rule sets display, which otherwise overrides HTML hidden.
    expect(css).toMatch(/\.front-page-blocks \.supplemental-dataset-group p\[hidden\]\s*\{\s*display: none;/);
});

test('visual truncation preserves full DOM text and keyboard focus styling', () => {
    expect(css).toMatch(/\.navbar-front-page-label\s*\{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
    expect(css).toMatch(/\.navbar-front-page-link:focus-visible\s*\{[^}]*2px solid var\(--primary_color\)/);
});

test('text has theme surfaces and background sizing follows width, never OS theme', () => {
    expect(css).toContain('background: var(--bg_color_2);');
    expect(css).toContain('filter: blur(var(--dataset-background-image-blur, 0));');
    expect(css).toContain('opacity: 0.2;');
    expect(css).toContain('background-image: var(--front-page-background-2160);');
    expect(css).toMatch(/@media \(width < 1000px\)[\s\S]*--front-page-background-1000/);
    expect(css).not.toMatch(/prefers-color-scheme|background-attachment:\s*fixed/);
});


test('only Home content scrolls, with a fixed sibling background and no structural top-row line', () => {
    const scroller = css.match(/\.front-page-scroller\s*\{([^}]+)\}/)?.[1];
    const row = css.match(/\.front-page-top-row\s*\{([^}]+)\}/)?.[1];
    expect(scroller).toContain('overflow: hidden auto');
    expect(scroller).toContain('display: block');
    expect(scroller).toContain('padding: 0');
    expect(scroller).toContain('min-height: 0');
    expect(row).toContain('flex: 0 0 auto');
    expect(row).toContain('border-bottom: 0');
    expect(row).toContain('box-shadow: none');
    expect(css).toMatch(/\.front-page-background\s*\{[^}]*position: absolute;[^}]*inset:/);
    expect(css).toMatch(/\.front-page-background video\s*\{[^}]*object-fit: cover;/);
    expect(css).toContain('image-rendering: auto');
    expect(css).not.toContain('padding-top: calc(12px + 44px');
});
