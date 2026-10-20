// row_article_page_css.test.js
// Guards the opt-in Page sizing and theme boundaries without changing IFAV rules.
// Connects the page image DOM classes to the shared stylesheet import.
// Browser P1-P4 supply actual geometry and theme evidence on the native target.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
const directory = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(directory, 'row_article_page.css'), 'utf8');
test('Page contains its image within forty percent of the viewport and 360px', () => {
    expect(css).toMatch(/max-height:\s*min\(40dvh, 360px\)/);
    expect(css).toMatch(/object-fit:\s*contain/);
    expect(css).toMatch(/@media \(width <= 480px\)/);
    expect(css).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(css).toMatch(/color:\s*var\(--text_color\)/);
    expect(css).toMatch(/background:\s*var\(--bg_color\)/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|@keyframes|animation:/i);
    expect(readFileSync(join(directory, '../../../styles/imports.css'), 'utf8')).toContain('row_article_page.css');
});
