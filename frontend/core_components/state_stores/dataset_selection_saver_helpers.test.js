import { describe, test, expect, vi } from 'vitest';
import {
    safeSetItem,
    safeGetItem,
    safeRemoveItem,
    parseJsonSafely,
    serializeJsonSafely,
    migrateToSession,
} from './dataset_selection_saver_helpers.js';

/** Create a minimal mock storage object. */
function createMockStorage(initial = {}) {
    const store = { ...initial };
    return {
        getItem: vi.fn((key) => (key in store ? store[key] : null)),
        setItem: vi.fn((key, value) => { store[key] = value; }),
        removeItem: vi.fn((key) => { delete store[key]; }),
        _store: store,
    };
}

// ---------------------------------------------------------------------------
// safeSetItem
// ---------------------------------------------------------------------------
describe('safeSetItem', () => {
    test('calls setItem on the storage object', () => {
        const storage = createMockStorage();
        safeSetItem(storage, 'key1', 'val1');
        expect(storage.setItem).toHaveBeenCalledWith('key1', 'val1');
    });

    test('does not throw when setItem throws', () => {
        const storage = createMockStorage();
        storage.setItem = vi.fn(() => { throw new Error('QuotaExceeded'); });
        expect(() => safeSetItem(storage, 'k', 'v')).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// safeGetItem
// ---------------------------------------------------------------------------
describe('safeGetItem', () => {
    test('returns value from storage', () => {
        const storage = createMockStorage({ foo: 'bar' });
        expect(safeGetItem(storage, 'foo')).toBe('bar');
    });

    test('returns null for missing key', () => {
        const storage = createMockStorage();
        expect(safeGetItem(storage, 'missing')).toBeNull();
    });

    test('returns null when getItem throws', () => {
        const storage = createMockStorage();
        storage.getItem = vi.fn(() => { throw new Error('SecurityError'); });
        expect(safeGetItem(storage, 'k')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// safeRemoveItem
// ---------------------------------------------------------------------------
describe('safeRemoveItem', () => {
    test('calls removeItem on the storage object', () => {
        const storage = createMockStorage({ k: 'v' });
        safeRemoveItem(storage, 'k');
        expect(storage.removeItem).toHaveBeenCalledWith('k');
    });

    test('does not throw when removeItem throws', () => {
        const storage = createMockStorage();
        storage.removeItem = vi.fn(() => { throw new Error('err'); });
        expect(() => safeRemoveItem(storage, 'k')).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// parseJsonSafely
// ---------------------------------------------------------------------------
describe('parseJsonSafely', () => {
    test('parses valid JSON', () => {
        expect(parseJsonSafely('{"a":1}', null)).toEqual({ a: 1 });
    });

    test('parses JSON array', () => {
        expect(parseJsonSafely('[1,2,3]', [])).toEqual([1, 2, 3]);
    });

    test('returns fallback for invalid JSON', () => {
        expect(parseJsonSafely('not json', 'default')).toBe('default');
    });

    test('returns fallback for null input', () => {
        expect(parseJsonSafely(null, 42)).toBe(42);
    });

    test('returns fallback for undefined input', () => {
        expect(parseJsonSafely(undefined, 'fb')).toBe('fb');
    });

    test('returns fallback for empty string', () => {
        expect(parseJsonSafely('', null)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// serializeJsonSafely
// ---------------------------------------------------------------------------
describe('serializeJsonSafely', () => {
    test('serializes object to JSON string', () => {
        expect(serializeJsonSafely({ a: 1 })).toBe('{"a":1}');
    });

    test('serializes array', () => {
        expect(serializeJsonSafely([1, 2])).toBe('[1,2]');
    });

    test('returns null for null input', () => {
        expect(serializeJsonSafely(null)).toBeNull();
    });

    test('returns null for undefined input', () => {
        expect(serializeJsonSafely(undefined)).toBeNull();
    });

    test('returns null for circular reference', () => {
        const obj = {};
        obj.self = obj;
        expect(serializeJsonSafely(obj)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// migrateToSession
// ---------------------------------------------------------------------------
describe('migrateToSession', () => {
    test('returns session value when present', () => {
        const session = createMockStorage({ k: 'session_val' });
        const local = createMockStorage({ k: 'local_val' });
        expect(migrateToSession(session, local, 'k')).toBe('session_val');
        expect(local.removeItem).not.toHaveBeenCalled();
    });

    test('migrates from local to session when session is empty', () => {
        const session = createMockStorage();
        const local = createMockStorage({ k: 'local_val' });
        expect(migrateToSession(session, local, 'k')).toBe('local_val');
        expect(session.setItem).toHaveBeenCalledWith('k', 'local_val');
        expect(local.removeItem).toHaveBeenCalledWith('k');
    });

    test('returns null when both storages are empty', () => {
        const session = createMockStorage();
        const local = createMockStorage();
        expect(migrateToSession(session, local, 'k')).toBeNull();
    });
});
