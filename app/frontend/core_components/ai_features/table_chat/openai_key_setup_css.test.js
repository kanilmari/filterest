// openai_key_setup_css.test.js
// Verifies the missing-OpenAI-key form remains inside its chat message at narrow widths.
// Bridges the generated setup DOM with the reusable table-chat stylesheet.
// Exists to prevent viewport-based minimum widths and controls from overflowing the sidebar.

import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const cssPath = path.join(
    currentDirectory,
    '../../../reusable_components/ai_features/table_chat/chat.css'
);
const css = fs.readFileSync(cssPath, 'utf8');

function ruleBody(selectorPattern) {
    return css.match(new RegExp(`${selectorPattern}\\s*\\{(?<body>[^}]+)\\}`, 's'))
        ?.groups?.body || '';
}

describe('OpenAI key setup chat layout', () => {
    test('lets the form and password field shrink to the message width', () => {
        const formRule = ruleBody('\\.chat-openai-key-setup');
        const inputRule = ruleBody('\\.chat-openai-key-setup input');

        expect(formRule).toContain('width: 100%');
        expect(formRule).toContain('min-width: 0');
        expect(formRule).toContain('max-width: 100%');
        expect(formRule).toContain('overflow-wrap: anywhere');
        expect(formRule).not.toContain('vw');
        expect(inputRule).toContain('box-sizing: border-box');
        expect(inputRule).toContain('max-width: 100%');
    });

    test('allows long action labels and links to wrap inside the form', () => {
        const actionItemRule = ruleBody('\\.chat-openai-key-setup__actions > \\*');

        expect(actionItemRule).toContain('min-width: 0');
        expect(actionItemRule).toContain('max-width: 100%');
        expect(actionItemRule).toContain('overflow-wrap: anywhere');
        expect(actionItemRule).toContain('white-space: normal');
    });
});
