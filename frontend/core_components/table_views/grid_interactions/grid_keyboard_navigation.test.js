// @vitest-environment jsdom
// grid_keyboard_navigation.test.js
// Verifies shared keyboard movement bounds for grid-based dataset views.
// Bridges table/list key handlers and pure coordinate navigation.
// Exists to keep both adapters aligned as keyboard affordances expand.

import { describe, expect, test } from 'vitest';
import {
    getAdjacentGridCoordinate,
    isGridNavigationKey,
} from './grid_keyboard_navigation.js';

describe('grid_keyboard_navigation', () => {
    test('recognizes arrow keys as grid navigation keys', () => {
        expect(isGridNavigationKey('ArrowLeft')).toBe(true);
        expect(isGridNavigationKey('ArrowRight')).toBe(true);
        expect(isGridNavigationKey('Enter')).toBe(false);
    });

    test('moves within row and column bounds', () => {
        expect(getAdjacentGridCoordinate({
            coordinate: { rowIndex: 1, columnIndex: 1 },
            key: 'ArrowLeft',
            maxRowIndex: 2,
            maxColumnIndex: 2,
        })).toEqual({ rowIndex: 1, columnIndex: 0 });

        expect(getAdjacentGridCoordinate({
            coordinate: { rowIndex: 1, columnIndex: 1 },
            key: 'ArrowDown',
            maxRowIndex: 2,
            maxColumnIndex: 2,
        })).toEqual({ rowIndex: 2, columnIndex: 1 });
    });

    test('returns null when movement would leave the grid', () => {
        expect(getAdjacentGridCoordinate({
            coordinate: { rowIndex: 0, columnIndex: 0 },
            key: 'ArrowLeft',
            maxRowIndex: 2,
            maxColumnIndex: 2,
        })).toBeNull();

        expect(getAdjacentGridCoordinate({
            coordinate: { rowIndex: 2, columnIndex: 2 },
            key: 'ArrowDown',
            maxRowIndex: 2,
            maxColumnIndex: 2,
        })).toBeNull();
    });
});
