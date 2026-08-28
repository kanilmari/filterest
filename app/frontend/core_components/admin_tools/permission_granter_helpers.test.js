import { describe, test, expect } from 'vitest';
import {
    buildPermissionObject,
    computePermissionDiff,
} from './permission_granter_helpers.js';

// ---------------------------------------------------------------------------
// buildPermissionObject
// ---------------------------------------------------------------------------
describe('buildPermissionObject', () => {
    const specs = {
        users: { table_uid: '10' },
        orders: { table_uid: '20' },
    };

    test('builds object with valid table spec', () => {
        expect(buildPermissionObject(1, 5, specs, 'users')).toEqual({
            user_group_id: 1,
            function_id: 5,
            target_schema_name: 'public',
            target_dataset_name: 'users',
            target_table_uid: 10,
        });
    });

    test('parses string groupId and funcId', () => {
        const result = buildPermissionObject('3', '7', specs, 'orders');
        expect(result.user_group_id).toBe(3);
        expect(result.function_id).toBe(7);
        expect(result.target_table_uid).toBe(20);
    });

    test('returns null uid when table not in specs', () => {
        const result = buildPermissionObject(1, 2, specs, 'unknown_table');
        expect(result.target_table_uid).toBeNull();
        expect(result.target_dataset_name).toBe('unknown_table');
    });

    test('returns null uid when specs is empty', () => {
        const result = buildPermissionObject(1, 2, {}, 'users');
        expect(result.target_table_uid).toBeNull();
    });

    test('always sets target_schema_name to public', () => {
        const result = buildPermissionObject(1, 2, specs, 'users');
        expect(result.target_schema_name).toBe('public');
    });
});

// ---------------------------------------------------------------------------
// computePermissionDiff
// ---------------------------------------------------------------------------
describe('computePermissionDiff', () => {
    const existing = [
        { user_group_id: 1, function_id: 10, target_dataset_name: '' },
        { user_group_id: 2, function_id: 20, target_dataset_name: '' },
        { user_group_id: 3, function_id: 30, target_dataset_name: 'some_table' }, // table-specific, should be filtered out
    ];

    test('returns existing non-table-specific permissions when no edits', () => {
        const result = computePermissionDiff(existing, []);
        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
            user_group_id: 1,
            function_id: 10,
            target_schema_name: 'public',
            target_table_uid: null,
        });
    });

    test('adds new permission via checked edit', () => {
        const edits = [{ groupId: '5', functionId: '50', checked: true }];
        const result = computePermissionDiff([], edits);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            user_group_id: 5,
            function_id: 50,
            target_schema_name: 'public',
            target_table_uid: null,
        });
    });

    test('removes existing permission via unchecked edit', () => {
        const edits = [{ groupId: '1', functionId: '10', checked: false }];
        const result = computePermissionDiff(existing, edits);
        expect(result).toHaveLength(1);
        expect(result[0].user_group_id).toBe(2);
    });

    test('overwrites existing permission with same key', () => {
        const edits = [{ groupId: '1', functionId: '10', checked: true }];
        const result = computePermissionDiff(existing, edits);
        expect(result).toHaveLength(2);
        // The entry for group 1, func 10 should still exist
        expect(result.find(r => r.user_group_id === 1 && r.function_id === 10)).toBeTruthy();
    });

    test('filters out table-specific existing permissions', () => {
        const result = computePermissionDiff(existing, []);
        const hasTableSpecific = result.some(r => r.user_group_id === 3 && r.function_id === 30);
        expect(hasTableSpecific).toBe(false);
    });

    test('returns empty array when all removed', () => {
        const edits = [
            { groupId: '1', functionId: '10', checked: false },
            { groupId: '2', functionId: '20', checked: false },
        ];
        const result = computePermissionDiff(existing, edits);
        expect(result).toEqual([]);
    });

    test('handles empty existing and empty edits', () => {
        expect(computePermissionDiff([], [])).toEqual([]);
    });

    test('handles multiple adds and removes in single call', () => {
        const edits = [
            { groupId: '1', functionId: '10', checked: false },  // remove
            { groupId: '9', functionId: '90', checked: true },   // add
        ];
        const result = computePermissionDiff(existing, edits);
        expect(result).toHaveLength(2); // group2+func20 stays, group9+func90 added
        expect(result.find(r => r.user_group_id === 1)).toBeFalsy();
        expect(result.find(r => r.user_group_id === 9)).toBeTruthy();
    });
});
