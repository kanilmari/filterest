// @vitest-environment jsdom
// cell_editor_layout_resolver.test.js
// Verifies inline editor shape decisions from cell size, value length, and input type.
// Bridges synthetic rendered cell geometry with the production editor-layout resolver.
// Exists to keep multiline text adaptive without turning typed controls into textareas.

import { describe, expect, test, vi } from 'vitest';
import { resolveCellEditorLayout } from './cell_editor_layout_resolver.js';

describe('resolveCellEditorLayout', () => {
    test('uses a cell-sized textarea for long text while preserving non-text input types', () => {
        const cell = document.createElement('td');
        cell.style.padding = '8px 10px';
        cell.textContent = 'A long description '.repeat(10);
        cell.getBoundingClientRect = vi.fn(() => rect(320, 112));
        document.body.appendChild(cell);

        expect(resolveCellEditorLayout(cell, {
            inputType: 'text',
            value: cell.textContent,
        })).toEqual({
            useTextarea: true,
            widthPx: 300,
            heightPx: 96,
        });
        expect(resolveCellEditorLayout(cell, {
            inputType: 'number',
            value: cell.textContent,
        }).useTextarea).toBe(false);
    });
});

function rect(width, height) {
    return {
        width,
        height,
        top: 0,
        right: width,
        bottom: height,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
    };
}
