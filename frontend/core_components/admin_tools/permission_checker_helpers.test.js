import { describe, test, expect } from 'vitest';
import {
    computeMultipleTableState,
    mapFunctionFields,
    mapGroupFields,
} from './permission_checker_helpers.js';

const PERMISSIONS = [
    { target_dataset_name: 'users', function_id: 1, user_group_id: 10 },
    { target_dataset_name: 'orders', function_id: 1, user_group_id: 10 },
    { target_dataset_name: 'users', function_id: 2, user_group_id: 10 },
];

// ---------------------------------------------------------------------------
// computeMultipleTableState
// ---------------------------------------------------------------------------
describe('computeMultipleTableState', () => {
    test('returns "checked" when all selected tables have the permission', () => {
        expect(
            computeMultipleTableState(PERMISSIONS, ['users', 'orders'], 1, 10)
        ).toBe('checked');
    });

    test('returns "unchecked" when no selected tables have the permission', () => {
        expect(
            computeMultipleTableState(PERMISSIONS, ['users', 'orders'], 3, 10)
        ).toBe('unchecked');
    });

    test('returns "ambiguous" when some tables have and some lack the permission', () => {
        expect(
            computeMultipleTableState(PERMISSIONS, ['users', 'orders'], 2, 10)
        ).toBe('ambiguous');
    });

    test('returns "checked" for single table with permission', () => {
        expect(
            computeMultipleTableState(PERMISSIONS, ['users'], 1, 10)
        ).toBe('checked');
    });

    test('returns "unchecked" for single table without permission', () => {
        expect(
            computeMultipleTableState(PERMISSIONS, ['orders'], 2, 10)
        ).toBe('unchecked');
    });

    test('returns "unchecked" for empty selectedNames', () => {
        expect(
            computeMultipleTableState(PERMISSIONS, [], 1, 10)
        ).toBe('checked');
    });

    test('returns "unchecked" for empty permissionsData', () => {
        expect(
            computeMultipleTableState([], ['users'], 1, 10)
        ).toBe('unchecked');
    });

    test('matches exact funcId and groupId', () => {
        expect(
            computeMultipleTableState(PERMISSIONS, ['users'], 1, 99)
        ).toBe('unchecked');
    });
});

// ---------------------------------------------------------------------------
// mapFunctionFields
// ---------------------------------------------------------------------------
describe('mapFunctionFields', () => {
    test('maps function records to slim shape', () => {
        const input = [
            { id: 1, name: 'fn1', url_route_endpoint: '/api/fn1', specific_table_related: true, ui_only: false, disabled: false, extra_field: 'x' },
        ];
        expect(mapFunctionFields(input)).toEqual([
            { id: 1, name: 'fn1', url_route_endpoint: '/api/fn1', specific_table_related: true, ui_only: false },
        ]);
    });

    test('filters out disabled functions', () => {
        const input = [
            { id: 1, name: 'active', url_route_endpoint: '/a', specific_table_related: false, ui_only: false, disabled: false },
            { id: 2, name: 'disabled', url_route_endpoint: '/b', specific_table_related: false, ui_only: false, disabled: true },
        ];
        expect(mapFunctionFields(input)).toHaveLength(1);
        expect(mapFunctionFields(input)[0].name).toBe('active');
    });

    test('returns empty array for non-array input', () => {
        expect(mapFunctionFields(null)).toEqual([]);
        expect(mapFunctionFields(undefined)).toEqual([]);
        expect(mapFunctionFields('string')).toEqual([]);
    });

    test('returns empty array for empty input', () => {
        expect(mapFunctionFields([])).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// mapGroupFields
// ---------------------------------------------------------------------------
describe('mapGroupFields', () => {
    test('maps group records to slim shape', () => {
        const input = [
            { id: 1, name: 'Admins', extra: 'ignored' },
            { id: 2, name: 'Users', extra: 'also ignored' },
        ];
        expect(mapGroupFields(input)).toEqual([
            { id: 1, name: 'Admins' },
            { id: 2, name: 'Users' },
        ]);
    });

    test('returns empty array for non-array input', () => {
        expect(mapGroupFields(null)).toEqual([]);
        expect(mapGroupFields(undefined)).toEqual([]);
    });

    test('returns empty array for empty input', () => {
        expect(mapGroupFields([])).toEqual([]);
    });
});
