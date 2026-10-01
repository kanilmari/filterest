// card_keyword_label_color_css.test.js
// Guards the keyword chip colour and the vertical centring of a card's description.
// Connects the theme token in variables.css with the card and article chip rules.
// Exists so the owner-named keyword colour stays one token in every theme and a
// one-line description keeps sitting in the middle of its icon row.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const CARDS_CSS = readFileSync(resolve(CURRENT_DIR, 'cards.css'), 'utf8');
const VARIABLES_CSS = readFileSync(resolve(CURRENT_DIR, '../../../styles/variables.css'), 'utf8');

// Returns the declarations of the rule whose selector starts a line exactly as given.
function ruleBody(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^${escaped} \\{`, 'm').exec(css);
    expect(match, selector).not.toBeNull();
    const open = match.index + match[0].length;
    return css.slice(open, css.indexOf('}', open));
}

// Returns one top-level theme block of variables.css, from its opening line to its closing brace.
function themeBlock(opening) {
    const start = VARIABLES_CSS.indexOf(opening);
    expect(start, opening).toBeGreaterThanOrEqual(0);
    return VARIABLES_CSS.slice(start, VARIABLES_CSS.indexOf('\n}', start));
}

describe('keyword chip colour and description centring', () => {
    test('every theme block defines its own keyword chip colour', () => {
        // The light default on :root, the dark preference, and both explicit theme classes.
        expect(VARIABLES_CSS.match(/--keyword_label_bg_color:/g) || []).toHaveLength(4);
        expect(themeBlock(':root {')).toContain('--keyword_label_bg_color:');
        expect(themeBlock('@media (prefers-color-scheme: dark) {')).toContain('--keyword_label_bg_color:');
        expect(themeBlock('body.light-mode {')).toContain('--keyword_label_bg_color:');
        expect(themeBlock('body.dark-mode {')).toContain('--keyword_label_bg_color:');
    });

    test('card and article keyword chips take that colour', () => {
        expect(ruleBody(CARDS_CSS, '.card--modern .keyword_tag'))
            .toContain('background: var(--keyword_label_bg_color)');
        expect(ruleBody(CARDS_CSS, '.keyword_tag'))
            .toContain('background-color: var(--keyword_label_bg_color)');
    });

    test('the Glowy description row centres its text against the icon', () => {
        expect(ruleBody(CARDS_CSS, '.card--modern .card_description_container'))
            .toContain('align-items: center');
    });
});
