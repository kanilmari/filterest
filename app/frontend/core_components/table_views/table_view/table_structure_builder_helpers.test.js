import { describe, test, expect } from 'vitest';
import {
    clampManualCellMaxHeightPx,
    clampManualColumnWidthPx,
    formatValue,
    getCellHeightBoundsPx,
    getMinimumColumnWidthPx,
    normalizeDisplayText,
    resolveLineHeightPx,
    sortObjectKeys,
    shouldRenderCompactCellValue,
    nextSortState,
} from './table_structure_builder_helpers.js';

// ---------------------------------------------------------------------------
// formatValue
// ---------------------------------------------------------------------------
describe('formatValue', () => {
    test('returns "Tuntematon" for null', () => {
        expect(formatValue(null)).toBe('Tuntematon');
    });

    test('returns "Tuntematon" for undefined', () => {
        expect(formatValue(undefined)).toBe('Tuntematon');
    });

    test('joins arrays with comma and space', () => {
        expect(formatValue(['a', 'b', 'c'])).toBe('a, b, c');
    });

    test('returns empty string for empty array', () => {
        expect(formatValue([])).toBe('');
    });

    test('returns pretty JSON for objects (keys sorted)', () => {
        const result = formatValue({ b: 2, a: 1 });
        const parsed = JSON.parse(result);
        expect(parsed).toEqual({ a: 1, b: 2 });
        expect(Object.keys(parsed)[0]).toBe('a');
    });

    test('returns string as-is', () => {
        expect(formatValue('hello')).toBe('hello');
    });

    test('returns number as-is', () => {
        expect(formatValue(42)).toBe(42);
    });

    test('returns boolean as-is', () => {
        expect(formatValue(true)).toBe(true);
    });

    test('returns 0 as-is (not "Tuntematon")', () => {
        expect(formatValue(0)).toBe(0);
    });

    test('returns empty string as-is', () => {
        expect(formatValue('')).toBe('');
    });
});

// ---------------------------------------------------------------------------
// normalizeDisplayText + shouldRenderCompactCellValue
// ---------------------------------------------------------------------------
describe('cell layout helpers', () => {
    test('normalizeDisplayText coerces primitive values to strings', () => {
        expect(normalizeDisplayText(42)).toBe('42');
        expect(normalizeDisplayText(true)).toBe('true');
        expect(normalizeDisplayText('hello')).toBe('hello');
    });

    test('shouldRenderCompactCellValue keeps ids and booleans compact', () => {
        expect(shouldRenderCompactCellValue(396)).toBe(true);
        expect(shouldRenderCompactCellValue(true)).toBe(true);
        expect(shouldRenderCompactCellValue('false')).toBe(true);
    });

    test('shouldRenderCompactCellValue keeps common timestamps compact', () => {
        expect(shouldRenderCompactCellValue('2026-04-23 03:00:00')).toBe(true);
        expect(shouldRenderCompactCellValue('2026-04-23')).toBe(true);
    });

    test('shouldRenderCompactCellValue treats long prose and multiline JSON as wrapping content', () => {
        expect(
            shouldRenderCompactCellValue(
                'Open network for secure, decentralized real-time communication across chat apps and services.'
            )
        ).toBe(false);
        expect(shouldRenderCompactCellValue('{\n  "fi": "pitka teksti"\n}')).toBe(false);
    });

    test('getMinimumColumnWidthPx keeps control columns narrower than data columns', () => {
        expect(getMinimumColumnWidthPx(0)).toBe(50);
        expect(getMinimumColumnWidthPx(1)).toBe(50);
        expect(getMinimumColumnWidthPx(2)).toBe(100);
    });

    test('clampManualColumnWidthPx honors the shared 800px expansion ceiling', () => {
        expect(clampManualColumnWidthPx(12, 0)).toBe(50);
        expect(clampManualColumnWidthPx(88, 4)).toBe(100);
        expect(clampManualColumnWidthPx(640, 4)).toBe(640);
        expect(clampManualColumnWidthPx(1440, 4)).toBe(800);
    });

    test('resolveLineHeightPx falls back from normal line-height using font size', () => {
        expect(resolveLineHeightPx('24px', '16px')).toBe(24);
        expect(resolveLineHeightPx('normal', '20px')).toBe(24);
        expect(resolveLineHeightPx('', '')).toBe(19.2);
    });

    test('cell height bounds preserve the 15-line default plus 1..60 manual range', () => {
        expect(getCellHeightBoundsPx(20)).toEqual({
            defaultMaxHeightPx: 300,
            manualMinHeightPx: 20,
            manualMaxHeightPx: 1200,
        });
        expect(clampManualCellMaxHeightPx(5, 20)).toBe(20);
        expect(clampManualCellMaxHeightPx(120, 20)).toBe(120);
        expect(clampManualCellMaxHeightPx(760, 20)).toBe(760);
        expect(clampManualCellMaxHeightPx(2200, 20)).toBe(1200);
    });
});

// ---------------------------------------------------------------------------
// sortObjectKeys
// ---------------------------------------------------------------------------
describe('sortObjectKeys', () => {
    test('sorts keys alphabetically', () => {
        const result = sortObjectKeys({ c: 3, a: 1, b: 2 });
        expect(Object.keys(result)).toEqual(['a', 'b', 'c']);
        expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });

    test('returns empty object for empty input', () => {
        expect(sortObjectKeys({})).toEqual({});
    });

    test('preserves values', () => {
        const result = sortObjectKeys({ z: [1, 2], a: 'hello' });
        expect(result.z).toEqual([1, 2]);
        expect(result.a).toBe('hello');
    });

    test('already sorted object is unchanged', () => {
        const result = sortObjectKeys({ a: 1, b: 2, c: 3 });
        expect(Object.keys(result)).toEqual(['a', 'b', 'c']);
    });
});

// ---------------------------------------------------------------------------
// nextSortState
// ---------------------------------------------------------------------------
describe('nextSortState', () => {
    test('clicking same column: none → ASC', () => {
        const result = nextSortState('name', null, 'name');
        expect(result).toEqual({ column: 'name', direction: 'ASC' });
    });

    test('clicking same column: ASC → DESC', () => {
        const result = nextSortState('name', 'ASC', 'name');
        expect(result).toEqual({ column: 'name', direction: 'DESC' });
    });

    test('clicking same column: DESC → none', () => {
        const result = nextSortState('name', 'DESC', 'name');
        expect(result).toEqual({ column: null, direction: null });
    });

    test('clicking different column → ASC on new column', () => {
        const result = nextSortState('name', 'ASC', 'age');
        expect(result).toEqual({ column: 'age', direction: 'ASC' });
    });

    test('clicking column when no current sort → ASC', () => {
        const result = nextSortState(null, null, 'name');
        expect(result).toEqual({ column: 'name', direction: 'ASC' });
    });

    test('handles lowercase direction input', () => {
        const result = nextSortState('name', 'asc', 'name');
        expect(result).toEqual({ column: 'name', direction: 'DESC' });
    });

    test('handles empty string direction as none', () => {
        const result = nextSortState('name', '', 'name');
        expect(result).toEqual({ column: 'name', direction: 'ASC' });
    });
});
