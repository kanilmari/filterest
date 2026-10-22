// validator.test.js
// Proves the shared version-five policy and read-only version-one through four conversion.
// Connects browser field, choice and numeric cases to the Go parser tests.
// Protects default, independent themes and strict writes from coercion.
import { expect, test } from 'vitest';
import { DEFAULT_HOME_PRESENTATION as defaults, HOME_PRESENTATION_DEFINITION as rules,
    isValidHomePresentation, readHomePresentation } from './validator.js';

const numericKeys = Object.keys(defaults).filter(key => rules[key]?.step);

test('accepts nine anchors, four alignments and each inclusive numeric bound', () => {
    for (const anchor of rules.anchors) for (const alignment of rules.alignments) for (const phone_alignment of rules.phone_alignments) {
        expect(isValidHomePresentation({ ...defaults, anchor, alignment, phone_alignment })).toBe(true);
    }
    for (const key of numericKeys) for (const value of [rules[key].min, rules[key].max]) {
        expect(isValidHomePresentation({ ...defaults, [key]: value })).toBe(true);
    }
});

test('v2/v3 reads map physical alignment without changing the source or accepting old writes', () => {
    for (const schema_version of [2, 3]) for (const [alignment, logical] of Object.entries({ left: 'start', right: 'end', center: 'center', justify: 'justify' })) {
        const old = { ...defaults, schema_version, alignment };
        delete old.phone_alignment; delete old.phone_story_size;
        if (schema_version === 2) delete old.text_style;
        const before = JSON.stringify(old);
        const converted = readHomePresentation(old);
        expect(converted).toEqual({ ...defaults, alignment: logical });
        expect(readHomePresentation(converted)).toEqual(converted);
        expect(JSON.stringify(old)).toBe(before);
        expect(isValidHomePresentation(old)).toBe(false);
    }
});

test('rejects partial, extra, null, coerced, fractional and off-step fields', () => {
    for (const value of [null, {}, [], { ...defaults, extra: 1 },
        { ...defaults, schema_version: 1 }, { ...defaults, anchor: 'left' }, { ...defaults, alignment: 'artistic' }]) {
        expect(isValidHomePresentation(value)).toBe(false);
    }
    for (const key of Object.keys(defaults)) {
        const missing = { ...defaults }; delete missing[key];
        expect(isValidHomePresentation(missing)).toBe(false);
        expect(isValidHomePresentation({ ...defaults, [key]: null })).toBe(false);
    }
    for (const key of numericKeys) for (const value of [-1, rules[key].max + 1, 1.5, String(defaults[key])]) {
        expect(isValidHomePresentation({ ...defaults, [key]: value })).toBe(false);
    }
    expect(isValidHomePresentation({ ...defaults, max_width_px: 321 })).toBe(false);
});

test('v4 reads retain logical and phone alignment with 15px without mutating the stored value', () => {
    for (const alignment of rules.alignments) for (const phone_alignment of rules.phone_alignments) {
        const old = { ...defaults, schema_version: 4, alignment, phone_alignment };
        delete old.phone_story_size;
        const before = JSON.stringify(old);
        expect(readHomePresentation(old)).toEqual({ ...defaults, alignment, phone_alignment });
        expect(JSON.stringify(old)).toBe(before);
        expect(isValidHomePresentation(old)).toBe(false);
        expect(() => readHomePresentation({ ...old, phone_story_size: 15 })).toThrow();
    }
});

test('all seven phone sizes are integers and incomplete or coerced v5 sizes fail', () => {
    for (let phone_story_size = 12; phone_story_size <= 18; phone_story_size++) {
        expect(isValidHomePresentation({ ...defaults, phone_story_size })).toBe(true);
    }
    for (const phone_story_size of [11, 19, 15.5, '15', null, undefined, false]) {
        const value = { ...defaults, phone_story_size };
        expect(isValidHomePresentation(value)).toBe(false);
        expect(() => readHomePresentation(value)).toThrow();
    }
});

test('missing defaults centre the start-aligned block and brighten only the light theme', () => {
    expect(readHomePresentation(null)).toEqual(defaults);
    expect(defaults).toMatchObject({ schema_version: 5, phone_story_size: 15, anchor: 'center-center', alignment: 'start', phone_alignment: 'inherit',
        horizontal_margin_px: 40, vertical_margin_px: 40, max_width_px: 1120, dark_wash: 0, dark_opacity: 20 });
    expect(defaults.light_opacity).toBeGreaterThan(defaults.dark_opacity);
});

test('converts normal/artistic and one margin on reads, refuses version-one writes and invalid conversion', () => {
    for (const [paragraph_layout, alignment] of [['normal', 'start'], ['artistic', 'center']]) {
        const old = { schema_version: 1, anchor: 'bottom-right', margin_px: 71, paragraph_layout, max_width_px: 700 };
        expect(readHomePresentation(old)).toEqual({ ...defaults, anchor: 'bottom-right',
            horizontal_margin_px: 71, vertical_margin_px: 71, alignment, max_width_px: 700 });
        expect(isValidHomePresentation(old)).toBe(false);
        for (const invalid of [{ ...old, extra: true }, { ...old, margin_px: '71' },
            { ...old, paragraph_layout: 'justify' }, { ...old, paragraph_layout: ['normal'] }, { ...old, anchor: 'left' }, { ...old, margin_px: null }]) {
            expect(() => readHomePresentation(invalid)).toThrow();
        }
    }
});
