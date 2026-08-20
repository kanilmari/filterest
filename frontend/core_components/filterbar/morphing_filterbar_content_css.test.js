// @vitest-environment node
// morphing_filterbar_content_css.test.js
// Locks the dataset-cover fade that keeps hero copy readable over photography.

import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

describe('morphing filterbar content CSS', () => {
    test('fades the cover from a transparent oval centre into visible edges', () => {
        const css = readFileSync(resolve(CURRENT_DIR, 'morphing_filterbar_content.css'), 'utf8');
        const coverRule = css.match(
            /\.filterbar-inline-hero--has-cover::before\s*\{([\s\S]*?)\n\}/,
        )?.[1] || '';

        expect(coverRule).toContain('mask-image: radial-gradient(');
        expect(coverRule).toContain('ellipse 68% 82% at 50% 48%');
        expect(coverRule).toMatch(/transparent 0%,\s*transparent 30%,/);
        expect(coverRule).toContain('#000 100%');
    });
});
