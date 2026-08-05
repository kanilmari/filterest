import { describe, test, expect } from 'vitest';
import {
    rotateRecentList,
    removeKeyFromList,
} from './recent_tab_saver_helpers.js';

// ---------------------------------------------------------------------------
// rotateRecentList
// ---------------------------------------------------------------------------
describe('rotateRecentList', () => {
    test('adds new item to front of empty list', () => {
        expect(rotateRecentList([], 'a', 5)).toEqual(['a']);
    });

    test('adds new item to front of existing list', () => {
        expect(rotateRecentList(['b', 'c'], 'a', 5)).toEqual(['a', 'b', 'c']);
    });

    test('moves existing item to front (deduplicates)', () => {
        expect(rotateRecentList(['a', 'b', 'c'], 'c', 5)).toEqual(['c', 'a', 'b']);
    });

    test('caps list at maxSize', () => {
        expect(rotateRecentList(['a', 'b', 'c', 'd', 'e'], 'f', 5))
            .toEqual(['f', 'a', 'b', 'c', 'd']);
    });

    test('caps list when re-adding existing item does not change length', () => {
        expect(rotateRecentList(['a', 'b', 'c', 'd', 'e'], 'c', 5))
            .toEqual(['c', 'a', 'b', 'd', 'e']);
    });

    test('handles maxSize of 1', () => {
        expect(rotateRecentList(['a', 'b'], 'c', 1)).toEqual(['c']);
    });

    test('handles maxSize of 0', () => {
        expect(rotateRecentList(['a'], 'b', 0)).toEqual([]);
    });

    test('does not mutate input list', () => {
        const original = ['a', 'b', 'c'];
        rotateRecentList(original, 'd', 5);
        expect(original).toEqual(['a', 'b', 'c']);
    });
});

// ---------------------------------------------------------------------------
// removeKeyFromList
// ---------------------------------------------------------------------------
describe('removeKeyFromList', () => {
    test('removes existing key', () => {
        expect(removeKeyFromList(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    });

    test('returns same content when key not found', () => {
        expect(removeKeyFromList(['a', 'b'], 'z')).toEqual(['a', 'b']);
    });

    test('removes all occurrences of key', () => {
        expect(removeKeyFromList(['a', 'b', 'a', 'c'], 'a')).toEqual(['b', 'c']);
    });

    test('returns empty array when removing from empty list', () => {
        expect(removeKeyFromList([], 'a')).toEqual([]);
    });

    test('returns empty array when removing the only item', () => {
        expect(removeKeyFromList(['a'], 'a')).toEqual([]);
    });

    test('does not mutate input list', () => {
        const original = ['a', 'b', 'c'];
        removeKeyFromList(original, 'b');
        expect(original).toEqual(['a', 'b', 'c']);
    });
});
