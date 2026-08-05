import { describe, expect, test } from 'vitest';

import {
    buildRelatedDatasetParams,
    buildRelatedTabKey,
    findMatchingRelatedTableEntry,
    getRelatedTableFilterValue,
    getRelatedTableRowCount,
    isBridgeRelationTable,
    isOutgoingRelatedTable,
    parseRelatedTabKey,
    shouldHandleSpaNavigationClick,
    shouldLazyLoadRelatedTableRows,
} from './big_card_child_tabs_helpers.js';

describe('shouldHandleSpaNavigationClick', () => {
    test('handles a plain left click inside the SPA', () => {
        expect(shouldHandleSpaNavigationClick({ button: 0 })).toBe(true);
    });

    test('does not handle modifier-assisted clicks', () => {
        expect(shouldHandleSpaNavigationClick({ button: 0, ctrlKey: true })).toBe(false);
        expect(shouldHandleSpaNavigationClick({ button: 0, metaKey: true })).toBe(false);
        expect(shouldHandleSpaNavigationClick({ button: 0, shiftKey: true })).toBe(false);
        expect(shouldHandleSpaNavigationClick({ button: 0, altKey: true })).toBe(false);
    });

    test('does not handle middle clicks or prevented events', () => {
        expect(shouldHandleSpaNavigationClick({ button: 1 })).toBe(false);
        expect(shouldHandleSpaNavigationClick({ button: 0, defaultPrevented: true })).toBe(false);
    });
});

describe('buildRelatedDatasetParams', () => {
    test('builds a stringified dataset filter object', () => {
        expect(buildRelatedDatasetParams('parent_id', 42)).toEqual({ parent_id: '42' });
    });
});

describe('getRelatedTableFilterValue', () => {
    test('prefers explicit filter_value for outgoing referenced rows', () => {
        expect(getRelatedTableFilterValue({ filter_value: 7 }, 42)).toBe(7);
    });

    test('falls back to current row id for legacy incoming rows', () => {
        expect(getRelatedTableFilterValue({}, 42)).toBe(42);
    });
});

describe('isOutgoingRelatedTable', () => {
    test('recognizes outgoing reference-only related rows', () => {
        expect(isOutgoingRelatedTable({ reference_direction: 'outgoing' })).toBe(true);
        expect(isOutgoingRelatedTable({ reference_direction: 'incoming' })).toBe(false);
    });
});

describe('getRelatedTableRowCount', () => {
    test('prefers explicit row_count when present', () => {
        expect(getRelatedTableRowCount({ row_count: 12, rows: [] })).toBe(12);
    });

    test('falls back to rows length when row_count is missing', () => {
        expect(getRelatedTableRowCount({ rows: [{ id: 1 }, { id: 2 }] })).toBe(2);
    });
});

describe('shouldLazyLoadRelatedTableRows', () => {
    test('lazy-loads when counts exist but rows were deferred', () => {
        expect(shouldLazyLoadRelatedTableRows({ row_count: 5, rows: [] })).toBe(true);
    });

    test('does not lazy-load when rows are already present or count is zero', () => {
        expect(shouldLazyLoadRelatedTableRows({ row_count: 2, rows: [{ id: 1 }] })).toBe(false);
        expect(shouldLazyLoadRelatedTableRows({ row_count: 0, rows: [] })).toBe(false);
    });
});

describe('isBridgeRelationTable', () => {
    test('hides generated many-to-many bridge relation tables from article tabs', () => {
        expect(isBridgeRelationTable({ dataset: 'palvelukatalogi_riskienhallinta_relation' })).toBe(true);
        expect(isBridgeRelationTable({ dataset: 'riskienhallinta' })).toBe(false);
    });

    test('recognizes explicit bridge relation metadata when backend adds it', () => {
        expect(isBridgeRelationTable({ dataset: 'service_links', relation_kind: 'many_to_many_bridge' })).toBe(true);
    });
});

describe('parseRelatedTabKey', () => {
    test('splits the composite tab key into dataset and column', () => {
        expect(parseRelatedTabKey('tasks__parent_id')).toEqual({
            dataset: 'tasks',
            column: 'parent_id',
            referenceDirection: '',
        });
    });

    test('keeps reference direction when present', () => {
        expect(parseRelatedTabKey('services__id__outgoing')).toEqual({
            dataset: 'services',
            column: 'id',
            referenceDirection: 'outgoing',
        });
    });
});

describe('buildRelatedTabKey', () => {
    test('includes direction to keep opposite relation tabs distinct', () => {
        expect(buildRelatedTabKey({
            dataset: 'services',
            column: 'id',
            reference_direction: 'outgoing',
        })).toBe('services__id__outgoing');
    });
});

describe('findMatchingRelatedTableEntry', () => {
    test('finds the matching dataset+column pair from a child table payload', () => {
        const childTables = [
            { dataset: 'tasks', column: 'queue_id' },
            { dataset: 'tasks', column: 'parent_id', row_count: 3 },
        ];

        expect(findMatchingRelatedTableEntry(childTables, 'tasks', 'parent_id')).toEqual(
            childTables[1]
        );
    });

    test('can distinguish opposite relation directions for the same dataset+column pair', () => {
        const childTables = [
            { dataset: 'services', column: 'id', reference_direction: 'incoming', row_count: 2 },
            { dataset: 'services', column: 'id', reference_direction: 'outgoing', row_count: 1 },
        ];

        expect(findMatchingRelatedTableEntry(childTables, 'services', 'id', 'outgoing')).toEqual(
            childTables[1]
        );
    });
});
