// dataset_column_type_catalog.test.js
// Verifies the one column-type list both dataset forms read.
// Bridges the forms' choices and the definitions the server's allowlist accepts.
// Exists because a drifting list is exactly what made a decimal column impossible.
import { describe, expect, test } from 'vitest';

import {
    COLUMN_TYPE_PARAMETER,
    composeColumnTypeDefinition,
    findDatasetColumnType,
    getColumnTypeParameter,
    getDatasetColumnTypeOptions,
    getDatasetColumnTypeTranslationFallbacks,
    parseColumnTypeDefinition,
} from './dataset_column_type_catalog.js';

describe('dataset column type catalog', () => {
    test('offers a decimal type in both form modes', () => {
        for (const mode of ['create', 'edit']) {
            const values = getDatasetColumnTypeOptions(mode).map((entry) => entry.value);
            expect(values).toContain('NUMERIC');
            expect(values).toContain('VARCHAR');
        }
    });

    test('types that describe how a column is born are creation-only', () => {
        const editValues = getDatasetColumnTypeOptions('edit').map((entry) => entry.value);
        expect(editValues).not.toContain('SERIAL');
        expect(editValues.some((value) => value.includes('DEFAULT NOW()'))).toBe(false);
        expect(getDatasetColumnTypeOptions('create').map((entry) => entry.value)).toContain('SERIAL');
    });

    test('a decimal definition always carries its two numbers', () => {
        expect(getColumnTypeParameter('NUMERIC')).toBe(COLUMN_TYPE_PARAMETER.PRECISION);
        expect(composeColumnTypeDefinition('NUMERIC', { precision: '8', scale: '3' })).toBe('NUMERIC(8,3)');
        // The server refuses a bare NUMERIC, so missing input falls back to a usable default.
        expect(composeColumnTypeDefinition('NUMERIC', {})).toBe('NUMERIC(12,2)');
        // Scale can never exceed precision.
        expect(composeColumnTypeDefinition('NUMERIC', { precision: '4', scale: '9' })).toBe('NUMERIC(4,4)');
    });

    test('limited text keeps its length and other types stay bare', () => {
        expect(composeColumnTypeDefinition('VARCHAR', { length: '80' })).toBe('VARCHAR(80)');
        expect(composeColumnTypeDefinition('VARCHAR', { length: '' })).toBe('VARCHAR');
        expect(composeColumnTypeDefinition('TEXT', { length: '80' })).toBe('TEXT');
    });

    test('a type the catalogue does not know is preserved unchanged', () => {
        expect(findDatasetColumnType('TIMESTAMP WITHOUT TIME ZONE')).toBeNull();
        expect(composeColumnTypeDefinition('TIMESTAMP WITHOUT TIME ZONE', {}))
            .toBe('TIMESTAMP WITHOUT TIME ZONE');
    });

    test('the database spelling of a stored type resolves to the same entry', () => {
        expect(findDatasetColumnType('character varying').value).toBe('VARCHAR');
        expect(findDatasetColumnType('timestamp with time zone').value).toBe('TIMESTAMPTZ');
        expect(findDatasetColumnType('decimal').value).toBe('NUMERIC');
    });

    test('a stored definition splits back into its controls', () => {
        expect(parseColumnTypeDefinition('numeric(10,4)'))
            .toEqual({ value: 'NUMERIC', length: null, precision: 10, scale: 4 });
        expect(parseColumnTypeDefinition('character varying(30)'))
            .toEqual({ value: 'VARCHAR', length: 30, precision: null, scale: null });
        expect(parseColumnTypeDefinition('text'))
            .toEqual({ value: 'TEXT', length: null, precision: null, scale: null });
    });

    test('every offered type is named in both interface languages', () => {
        const copy = getDatasetColumnTypeTranslationFallbacks();
        for (const entry of getDatasetColumnTypeOptions('create')) {
            expect(copy[entry.labelKey]?.fi, entry.value).toBeTruthy();
            expect(copy[entry.labelKey]?.en, entry.value).toBeTruthy();
        }
    });
});
