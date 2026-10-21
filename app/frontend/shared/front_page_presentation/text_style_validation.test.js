// text_style_validation.test.js
// Exercises the exact same accepted and refused presentations as Go.
// Connects v4 strict writes with read-only v1–v3 compatibility fixtures.
// Protects nested key/type/bounds validation and independent default copies.
import { expect, test } from 'vitest';
import examples from '../../../testing/shared_contracts/home_presentation_validation_examples.json' with { type: 'json' };
import { isValidHomePresentation, readHomePresentation, DEFAULT_HOME_PRESENTATION } from './validator.js';

for (const example of examples) test(example.name, () => {
    expect(isValidHomePresentation(example.value)).toBe(example.valid);
    if (example.readable) {
        const value = readHomePresentation(example.value);
        expect(value.schema_version).toBe(4);
        expect(isValidHomePresentation(value)).toBe(true);
        if (example.value.schema_version < 3) expect(value.text_style).toEqual(DEFAULT_HOME_PRESENTATION.text_style);
    } else expect(() => readHomePresentation(example.value)).toThrow();
});

test('returned defaults and saved text styles cannot mutate another visit', () => {
    for (const source of [null, DEFAULT_HOME_PRESENTATION]) {
        const value = readHomePresentation(source);
        value.text_style.reveal.start_ms = 12;
        expect(readHomePresentation(source).text_style.reveal.start_ms).toBe(3000);
    }
});
