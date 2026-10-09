// validator.test.js
// Proves the browser side of the shared appearance contract and leaf inventory.
// Connects bounds and mask ordering to the Go tests using the same examples.
// Keeps compatible reads separate from strict values and advisory slider steps.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { DATASET_APPEARANCE_PATHS, DEFAULT_DATASET_APPEARANCE, datasetAppearanceField,
    isValidDatasetAppearance, isValidDatasetAppearanceLeaf, isReadableDatasetAppearance,
    inheritLegacyDatasetAppearanceBlur, deriveDatasetAppearanceCompatibilityValues } from './validator.js';

const contract = JSON.parse(readFileSync('testing/shared_contracts/dataset_appearance_examples.json', 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));

test.each(contract.cases)('shared validation: $name', example => {
    const config = clone(DEFAULT_DATASET_APPEARANCE);
    for (const [path, value] of Object.entries(example.set)) {
        const [owner, key] = path.split('.');
        config[owner] ||= {};
        config[owner][key] = value;
    }
    for (const path of example.unset) {
        const [owner, key] = path.split('.');
        delete config[owner][key];
    }
    expect(isValidDatasetAppearance(config, { development: example.development })).toBe(example.valid);
    if (example.legacy_blur) {
        const inherited = inheritLegacyDatasetAppearanceBlur(config);
        for (const [owner, value] of Object.entries(example.legacy_blur)) expect(inherited[owner].image_blur).toBe(value);
        expect(isValidDatasetAppearance(inherited)).toBe(example.stored_valid);
        // Conversion is a future stored-reader helper; current public cache reads stay unchanged.
        expect(config).not.toEqual(inherited);
        expect(isReadableDatasetAppearance(config)).toBe(false);
    }
});

test('inventories 44 canonical leaves, excluding visibility aliases and legacy blur', () => {
    expect(DATASET_APPEARANCE_PATHS).toHaveLength(44);
    expect(DATASET_APPEARANCE_PATHS.filter(path => path.startsWith('light.'))).toHaveLength(13);
    expect(DATASET_APPEARANCE_PATHS.filter(path => path.startsWith('dark.'))).toHaveLength(13);
    expect(DATASET_APPEARANCE_PATHS.filter(path => path.startsWith('shared.'))).toHaveLength(18);
    expect(DATASET_APPEARANCE_PATHS).not.toContain('shared.image_blur');
    expect(datasetAppearanceField('shared.image_blur')).toMatchObject({ derived_from: 'light.image_blur', min: 0, max: 24 });
    for (const unknown of ['light.unknown', 'unknown.image_blur', 'shared.toString', 'light.__proto__', 'light.image_blur.extra']) {
        expect(isValidDatasetAppearanceLeaf(unknown, 1)).toBe(false);
    }
});

test('keeps the original browser serialization byte for byte', () => {
    expect(JSON.stringify(DEFAULT_DATASET_APPEARANCE)).toBe(contract.baseline_browser_json);
});

test('derives only the compatibility blur from light, including explicit zero', () => {
    const config = clone(DEFAULT_DATASET_APPEARANCE);
    config.light.image_blur = 0;
    config.dark.image_blur = 12;
    config.shared.image_blur = 9;
    deriveDatasetAppearanceCompatibilityValues(config);
    expect(config.shared.image_blur).toBe(0);
    expect(config.dark.image_blur).toBe(12);
    expect(Object.keys(config.shared)).toEqual(Object.keys(DEFAULT_DATASET_APPEARANCE.shared));
});

test('all leaves enforce types, inclusive bounds and enum choices; steps remain UI hints', () => {
    for (const [owner, fields] of Object.entries(DEFAULT_DATASET_APPEARANCE)) {
        for (const [key, value] of Object.entries(fields)) {
            const path = `${owner}.${key}`;
            const field = datasetAppearanceField(path);
            expect(isValidDatasetAppearanceLeaf(path, value)).toBe(true);
            for (const invalid of [null, [], {}]) expect(isValidDatasetAppearanceLeaf(path, invalid)).toBe(false);
            if (['number', 'integer'].includes(field.type)) {
                for (const bound of [field.min, field.max]) expect(isValidDatasetAppearanceLeaf(path, bound)).toBe(true);
                for (const invalid of [field.min - 1, field.max + 1, '1', true, NaN, Infinity]) {
                    expect(isValidDatasetAppearanceLeaf(path, invalid)).toBe(false);
                }
                if (field.type === 'integer') expect(isValidDatasetAppearanceLeaf(path, field.min + 0.5)).toBe(false);
            } else if (field.type === 'string') {
                for (const choice of field.values) expect(isValidDatasetAppearanceLeaf(path, choice)).toBe(true);
            }
        }
    }
    for (const invalid of [null, [], false, {}]) expect(isValidDatasetAppearance(invalid)).toBe(false);
    const inherited = Object.assign(Object.create({ light: DEFAULT_DATASET_APPEARANCE.light }), {
        dark: DEFAULT_DATASET_APPEARANCE.dark, shared: DEFAULT_DATASET_APPEARANCE.shared, extra: {},
    });
    expect(isValidDatasetAppearance(inherited)).toBe(false);
});

test('preserves the old public read guard, including clamped outliers and ignored extras', () => {
    const config = clone(DEFAULT_DATASET_APPEARANCE);
    config.shared.filterbar_content_top_space = 4000;
    config.light.center_stop = 90;
    config.shared.card_description_lines = 2.5;
    config.shared.label_value_layout = null;
    config.shared.image_blur = 'legacy';
    config.light.extra = true;
    delete config.shared.card_image_presentation;
    expect(isReadableDatasetAppearance(config)).toBe(true);
    expect(isValidDatasetAppearance(config)).toBe(false);
});
