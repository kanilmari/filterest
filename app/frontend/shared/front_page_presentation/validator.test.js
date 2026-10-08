// validator.test.js
// Exercises Home's strict shared definition and compatibility boundary.
// Connects browser acceptance to the same cases exercised by Go Parse.
// Rejects invalid, partial and coerced settings instead of adopting arbitrary geometry.
import { expect, test } from 'vitest';
import { DEFAULT_HOME_PRESENTATION as defaults, HOME_PRESENTATION_DEFINITION as rules, isValidHomePresentation } from './validator.js';

test('accepts nine anchors, both layouts and inclusive bounds', () => {
    for (const anchor of rules.anchors) for (const paragraph_layout of rules.paragraph_layouts) {
        for (const margin_px of [0, 40, 320]) for (const max_width_px of [320, 1120, 1600]) {
            expect(isValidHomePresentation({ ...defaults, anchor, paragraph_layout, margin_px, max_width_px })).toBe(true);
        }
    }
});

test('rejects missing, extra, null, wrong-type, fractional and off-step fields', () => {
    for (const value of [null, {}, [], { ...defaults, extra: 1 },
        ...['schema_version', 'anchor', 'margin_px', 'paragraph_layout', 'max_width_px'].flatMap(key => {
            const missing = { ...defaults }; delete missing[key];
            return [missing, { ...defaults, [key]: null }];
        }), ...[-1, 321, 1.5, '40'].map(margin_px => ({ ...defaults, margin_px })),
        ...[319, 1601, 321, '1120'].map(max_width_px => ({ ...defaults, max_width_px })),
        { ...defaults, schema_version: 2 }, { ...defaults, anchor: 'left' }, { ...defaults, paragraph_layout: 'center' }]) {
        expect(isValidHomePresentation(value)).toBe(false);
    }
});
