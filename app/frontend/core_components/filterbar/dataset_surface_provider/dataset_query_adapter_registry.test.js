// dataset_query_adapter_registry.test.js
// Tests explicit query ownership and safe removal without touching ordinary datasets.
// Connects adapter registration to the shared search/refresh dispatch contract.
// Guards accidental replacement of another mounted data source.
import { describe, expect, test, vi } from 'vitest';
import { registerDatasetQueryAdapter, getDatasetQueryAdapter } from './dataset_query_adapter_registry.js';

describe('dataset query adapter registry', () => {
    test('does not claim unregistered datasets and releases only its own adapter', () => {
        expect(getDatasetQueryAdapter('ordinary')).toBeNull();
        const adapter = { refresh: vi.fn() };
        const release = registerDatasetQueryAdapter('extension', adapter);
        expect(getDatasetQueryAdapter('extension')).toBe(adapter);
        expect(() => registerDatasetQueryAdapter('extension', adapter)).toThrow('already mounted');
        release();
        const replacement = { refresh: vi.fn() };
        const releaseReplacement = registerDatasetQueryAdapter('extension', replacement);
        release();
        expect(getDatasetQueryAdapter('extension')).toBe(replacement);
        releaseReplacement();
    });
    test('rejects malformed surface names and missing refresh callbacks', () => {
        expect(() => registerDatasetQueryAdapter('../endpoint', { refresh() {} })).toThrow(TypeError);
        expect(() => registerDatasetQueryAdapter('extension', {})).toThrow(TypeError);
    });
});
