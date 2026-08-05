// @vitest-environment jsdom
// logo_grid_builder.test.js
// Verifies the Serlog fallback logo grid keeps its shared glow metadata stable.
// Bridges project metadata and generated logo DOM without loading the full filterbar.
// Exists so visual logo polish does not quietly regress back to isolated corner tiles.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildLogoLetterGrid } from './logo_grid_builder.js';

describe('buildLogoLetterGrid', () => {
    beforeEach(() => {
        document.head.innerHTML = '<meta property="og:site_name" content="Serlog">';
        document.body.className = 'dark-mode';
        document.body.replaceChildren();
    });

    afterEach(() => {
        document.head.innerHTML = '';
        document.body.className = '';
        document.body.replaceChildren();
    });

    test('adds one shared Serlog glow grid with per-cell background coordinates', () => {
        const wrapper = buildLogoLetterGrid();
        const grid = wrapper.querySelector('.logo-letter-backgrounds-container');
        const cells = Array.from(wrapper.querySelectorAll('.logo-letter-background'));

        expect(grid).toBeTruthy();
        expect(grid.classList.contains('logo-letter-backgrounds-container--serlog-glow')).toBe(true);
        expect(grid.classList.contains('logo-letter-backgrounds-container--theme-dark')).toBe(true);
        expect(cells).toHaveLength(16);
        expect(cells[0].textContent).toBe('THE');
        expect(cells[0].classList.contains('logo-letter-background--endcap-label')).toBe(true);
        expect(cells[0].style.getPropertyValue('--logo-cell-column')).toBe('0');
        expect(cells[0].style.getPropertyValue('--logo-cell-row')).toBe('0');
        expect(cells[15].textContent).toBe('.COM');
        expect(cells[15].classList.contains('logo-letter-background--endcap-label')).toBe(true);
        expect(cells[15].style.getPropertyValue('--logo-cell-column')).toBe('7');
        expect(cells[15].style.getPropertyValue('--logo-cell-row')).toBe('1');
    });

    test('marks light-mode Serlog blue letters as the only extra shadow targets', () => {
        document.body.className = 'light-mode';

        const wrapper = buildLogoLetterGrid();
        const grid = wrapper.querySelector('.logo-letter-backgrounds-container');
        const blueLetters = Array.from(wrapper.querySelectorAll('.logo-letter-background--blue-letter'))
            .map((cell) => cell.textContent)
            .join('');
        const monochromeLetters = Array.from(wrapper.querySelectorAll('.logo-letter-background--monochrome-letter'))
            .map((cell) => cell.textContent)
            .join('');

        expect(grid.classList.contains('logo-letter-backgrounds-container--theme-light')).toBe(true);
        expect(blueLetters).toBe('SERLOG');
        expect(monochromeLetters).toBe('VICECATA');
    });
});
