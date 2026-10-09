// validator_v2.test.js
// Proves the three appearance places and the additive version-two validators.
// Connects browser and Go validation through identical ownership and value examples.
// Protects complete tab-local masks and explicit overrides without runtime cutover.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { DATASET_APPEARANCE_PATHS, DATASET_APPEARANCE_PATHS_BY_PLACE,
    datasetAppearanceField, datasetAppearancePlace, datasetAppearanceDefaultsForPlace,
    isValidDatasetAppearanceLeaf, isValidDatasetAppearanceTabValuesV2,
    isValidDatasetAppearanceSiteValuesV2, isValidDatasetAppearanceDefaultsV2,
    isValidDatasetAppearanceOverridesV2 } from './validator.js';

const contract = JSON.parse(readFileSync('testing/shared_contracts/dataset_appearance_v2_examples.json', 'utf8'));
const validators = { tab_values: isValidDatasetAppearanceTabValuesV2, site_values: isValidDatasetAppearanceSiteValuesV2,
    defaults: isValidDatasetAppearanceDefaultsV2, overrides: isValidDatasetAppearanceOverridesV2 };
const places = { tab_values: 'tab_only', site_values: 'site_only', defaults: 'site_default' };

test('every canonical value belongs to exactly one place: 28 / 7 / 9', () => {
    const all = [];
    for (const [place, count] of Object.entries({ tab_only: 28, site_only: 7, site_default: 9 })) {
        const paths = DATASET_APPEARANCE_PATHS_BY_PLACE[place];
        expect(paths).toHaveLength(count);
        expect(paths).toEqual(contract.places[place]);
        expect(Object.isFrozen(paths)).toBe(true);
        const defaults = datasetAppearanceDefaultsForPlace(place);
        expect(Object.keys(defaults)).toEqual(paths);
        for (const path of paths) {
            expect(datasetAppearancePlace(path)).toBe(place);
            expect(datasetAppearanceField(path).place).toBe(place);
            expect(defaults[path]).toBe(datasetAppearanceField(path).default);
        }
        defaults[paths[0]] = null;
        expect(datasetAppearanceDefaultsForPlace(place)[paths[0]]).not.toBe(null);
        all.push(...paths);
    }
    expect(new Set(all).size).toBe(44);
    expect(all.sort()).toEqual(DATASET_APPEARANCE_PATHS);
    expect(Object.isFrozen(DATASET_APPEARANCE_PATHS_BY_PLACE)).toBe(true);
    for (const unknown of ['unknown', '__proto__', 'toString']) {
        expect(datasetAppearanceDefaultsForPlace(unknown)).toEqual({});
    }
});

test('aliases inherit ownership without stored leaves; derived blur has only compatibility rules', () => {
    for (const [path, alias] of Object.entries(contract.aliases)) {
        expect(datasetAppearancePlace(path)).toBe(alias.place);
        expect(datasetAppearancePlace(path)).toBe(datasetAppearancePlace(alias.canonical));
        expect(DATASET_APPEARANCE_PATHS).not.toContain(path);
        expect(isValidDatasetAppearanceLeaf(path, false)).toBe(false);
    }
    for (const path of contract.derived) {
        expect(datasetAppearancePlace(path)).toBeUndefined();
        expect(datasetAppearanceField(path).place).toBeUndefined();
        expect(datasetAppearanceField(path).derived_from).toBeTruthy();
        expect(DATASET_APPEARANCE_PATHS).not.toContain(path);
        expect(isValidDatasetAppearanceLeaf(path, 0)).toBe(true);
    }
    for (const unknown of ['unknown.image_blur', 'shared.toString', 'light.show_cover_photo.extra', 'shared.show_cover_photo']) {
        expect(datasetAppearancePlace(unknown)).toBeUndefined();
    }
});

test.each(contract.cases)('version-two $target: $name', example => {
    const values = datasetAppearanceDefaultsForPlace(places[example.target]);
    Object.assign(values, example.set);
    for (const path of example.unset || []) delete values[path];
    const raw = Object.hasOwn(example, 'raw') ? example.raw : values;
    const before = JSON.stringify(raw);
    expect(validators[example.target](raw, { development: example.development })).toBe(example.valid);
    expect(JSON.stringify(raw)).toBe(before);
    for (const path of Object.keys(example.set || {})) {
        expect(Object.hasOwn(values, path)).toBe(true);
    }
});

test('complete groups refuse every missing value and every same-sized foreign-place replacement', () => {
    for (const [target, place] of Object.entries(places)) {
        for (const path of DATASET_APPEARANCE_PATHS_BY_PLACE[place]) {
            const values = datasetAppearanceDefaultsForPlace(place);
            delete values[path];
            expect(validators[target](values)).toBe(false);
        }
        for (const path of DATASET_APPEARANCE_PATHS) {
            if (datasetAppearancePlace(path) === place) continue;
            const values = datasetAppearanceDefaultsForPlace(place);
            delete values[DATASET_APPEARANCE_PATHS_BY_PLACE[place][0]];
            values[path] = datasetAppearanceField(path).default;
            expect(validators[target](values)).toBe(false);
        }
        // Prototype fields cannot fill a missing required value.
        const own = datasetAppearanceDefaultsForPlace(place);
        const path = DATASET_APPEARANCE_PATHS_BY_PLACE[place][0];
        delete own[path];
        const inherited = Object.assign(Object.create({ [path]: datasetAppearanceField(path).default }), own);
        expect(validators[target](inherited)).toBe(false);
    }
});

test('only the nine default paths may be overrides, including choices equal to defaults', () => {
    for (const path of DATASET_APPEARANCE_PATHS) {
        const overrides = { [path]: datasetAppearanceField(path).default };
        expect(isValidDatasetAppearanceOverridesV2(overrides)).toBe(datasetAppearancePlace(path) === 'site_default');
        expect(Object.hasOwn(overrides, path)).toBe(true);
    }
});

test.each(contract.tab_pairs)('tab-local masks: $name', pair => {
    const left = { ...datasetAppearanceDefaultsForPlace('tab_only'), ...pair.left_set };
    const right = { ...datasetAppearanceDefaultsForPlace('tab_only'), ...pair.right_set };
    expect(isValidDatasetAppearanceTabValuesV2(left)).toBe(pair.left_valid);
    expect(isValidDatasetAppearanceTabValuesV2(right)).toBe(pair.right_valid);
});

test('non-finite values are refused by every version-two number boundary', () => {
    for (const [target, path] of Object.entries({ tab_values: 'light.oval_width', site_values: 'shared.active_tab_glow_width',
        defaults: 'shared.card_image_width', overrides: 'shared.card_image_width' })) {
        for (const number of [NaN, Infinity, -Infinity]) {
            const values = datasetAppearanceDefaultsForPlace(places[target]);
            values[path] = number;
            expect(validators[target](values)).toBe(false);
        }
    }
});
