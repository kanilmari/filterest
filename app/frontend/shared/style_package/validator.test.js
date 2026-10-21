// validator.test.js
// Exercises the same malformed-input examples and generated bounds as Go.
// Connects the browser draft/import checks to source-owned contract and ownership.
// Protects strict types, themes and budgets without a browser or publication service.
import { describe, expect, test } from 'vitest';
import examples from '../../../testing/shared_contracts/style_package_validation_examples.json' with { type: 'json' };
import datasetDefinition from '../dataset_appearance/definition.json' with { type: 'json' };
import homeDefinition from '../front_page_presentation/definition.json' with { type: 'json' };
import { isValidStylePackage, parseStylePackageJSON, reservedStyleTokenOwner, STYLE_PACKAGE_DEFINITION as rules } from './validator.js';

const font = '00000000-0000-0000-0000-000000000001';
const documentFor = (scope, key, value) => ({ schema_version: 1, scopes: {
    [scope]: { light: { [key]: value }, dark: {} },
} });
function sample(rule) {
    switch (rule.type) {
        case 'number': case 'integer': return rule.min;
        case 'length': {
            const [unit, bounds] = Object.entries(rule.units)[0];
            return { unit, value: bounds.min };
        }
        case 'color': return '#abcdef';
        case 'shadow_preset': return 'soft';
        case 'reveal_preset': return rules.default_reveal;
        case 'font_binding': return { default: font, languages: { fi: font } };
        case 'responsive_size': return Object.fromEntries(Object.entries(rule.fields).map(([key, unit]) =>
            [key, { unit, value: rule.units[unit].min }]));
        default: throw new Error('Unsupported test token type');
    }
}

describe('shared Go/browser style validation examples', () => {
    test.each(examples)('$name', ({ raw, valid, known_fonts }) => {
        if (valid) expect(() => parseStylePackageJSON(raw, known_fonts)).not.toThrow();
        else expect(() => parseStylePackageJSON(raw, known_fonts)).toThrow();
    });
});

describe('every source-owned token rule', () => {
    for (const [key, rule] of Object.entries(rules.tokens)) {
        test(key, () => {
            for (const scope of Object.keys(rules.scopes))
                expect(isValidStylePackage(documentFor(scope, key, sample(rule)), [font])).toBe(rule.scopes.includes(scope));
            for (const value of [null, true, [], 'url(/font)', Infinity, NaN])
                expect(isValidStylePackage(documentFor(rule.scopes[0], key, value))).toBe(false);
            if (['number', 'integer'].includes(rule.type)) for (const value of [rule.min, rule.max, rule.min - 1, rule.max + 1])
                expect(isValidStylePackage(documentFor(rule.scopes[0], key, value))).toBe(value >= rule.min && value <= rule.max);
            if (rule.type === 'length') {
                for (const [unit, bounds] of Object.entries(rule.units))
                    for (const value of [bounds.min, bounds.max, bounds.min - 1, bounds.max + 1])
                        expect(isValidStylePackage(documentFor(rule.scopes[0], key, { unit, value })))
                            .toBe(value >= bounds.min && value <= bounds.max);
                expect(isValidStylePackage(documentFor(rule.scopes[0], key, { unit: 'vh', value: 1 }))).toBe(false);
            }
        });
    }
});

test('theme omissions use their own defaults and never copy light values', () => {
    const parsed = parseStylePackageJSON(JSON.stringify(documentFor('home-hero', 'heading.color', '#abcdef')));
    expect(parsed.scopes['home-hero'].dark).toEqual({});
    expect(rules.default_reveal).toBe('off');
});

test('reserved inventory matches the existing setting owners and stays disjoint', () => {
    expect(rules.reserved['home-presentation'].fields).toEqual(Object.keys(homeDefinition.default).filter(key => key !== 'schema_version'));
    expect(reservedStyleTokenOwner('phone_alignment')).toBe('home-presentation');
    const siteFields = Object.entries(datasetDefinition.shared_fields).filter(([, rule]) => rule.place === 'site_only').map(([key]) => key);
    expect(rules.reserved['site-presentation'].fields).toEqual(siteFields);
    const datasetFields = [
        ...['light', 'dark'].flatMap(theme => Object.keys(datasetDefinition.theme_fields).map(key => `${theme}.${key}`)),
        ...Object.entries(datasetDefinition.shared_fields).filter(([, rule]) => rule.place !== 'site_only').map(([key]) => key),
    ];
    expect(rules.reserved['dataset-appearance'].fields).toEqual(datasetFields);
    for (const owner of Object.values(rules.reserved)) for (const key of [...owner.fields, ...owner.css]) {
        expect(reservedStyleTokenOwner(key)).toBeTruthy();
        expect(Object.hasOwn(rules.tokens, key)).toBe(false);
        expect(Object.values(rules.tokens).some(rule => rule.css === key)).toBe(false);
    }
});

test('byte, nesting and font budgets refuse oversized drafts and imports', () => {
    const raw = '{"schema_version":1,"scopes":{}}';
    expect(() => parseStylePackageJSON(raw.padEnd(rules.limits.manifest_bytes, ' '))).not.toThrow();
    expect(() => parseStylePackageJSON(raw.padEnd(rules.limits.manifest_bytes + 1, ' '))).toThrow();
    expect(() => parseStylePackageJSON('['.repeat(rules.limits.json_depth + 1) + ']'.repeat(rules.limits.json_depth + 1))).toThrow();
    const fonts = Array.from({ length: rules.limits.font_faces + 1 }, (_, index) => `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`);
    const languages = Object.fromEntries(fonts.map((font, index) => [`en-x${index}`, font]));
    expect(isValidStylePackage(documentFor('site', 'font.body', { default: fonts[0], languages }), fonts)).toBe(false);
    const slots = Object.fromEntries(Array.from({ length: rules.limits.assignments - 1 }, (_, index) => [`en-x${index}`, font]));
    expect(isValidStylePackage(documentFor('site', 'font.body', { default: font, languages: slots }), [font])).toBe(true);
    slots['en-extra'] = font;
    expect(isValidStylePackage(documentFor('site', 'font.body', { default: font, languages: slots }), [font])).toBe(false);
    expect(isValidStylePackage(Object.assign(Object.create({ inherited: true }), { schema_version: 1, scopes: {} }))).toBe(false);
});
