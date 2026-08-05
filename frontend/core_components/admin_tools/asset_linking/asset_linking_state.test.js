// asset_linking_state.test.js
// Verifies normalization helpers for the isolated asset-linking admin module.
// Bridges live image/attachment asset payloads and the shared asset_linking state model in tests.
// Exists to keep the shared asset admin vocabulary stable across image and attachment capability changes.

import { describe, expect, test } from 'vitest';
import {
    ATTACHMENT_ASSET_KINDS,
    createAttachmentCapabilityScaffold,
    getAssetCapabilityState,
    isAssetCapabilityEnabled,
    normalizeAttachmentLinking,
    normalizeImageAssetLinking
} from './asset_linking_state.js';

describe('asset_linking_state', () => {
    test('normalizes image asset payload into asset state', () => {
        const state = normalizeImageAssetLinking({
            parent_table: 'articles',
            child_table: 'articles_gallery',
            enabled: true,
            max_file_size_mb: 12,
            allowed_file_types: ['png', 'webp']
        });

        expect(state.parentTable).toBe('articles');
        expect(state.childTable).toBe('articles_gallery');
        expect(state.storageDriver).toBe('local_filesystem');
        expect(state.maxFileSizeMB).toBe(12);
        expect(state.allowedFileTypes).toEqual(['png', 'webp']);
        expect(isAssetCapabilityEnabled(state, 'image')).toBe(true);
    });

    test('treats grouped attachment capability as partial until every asset kind is enabled', () => {
        const attachmentState = {
            capabilities: {
                pdf: 'enabled',
                document: 'disabled',
                archive: 'disabled'
            }
        };

        expect(getAssetCapabilityState(attachmentState, 'attachment')).toBe('partial');
        expect(isAssetCapabilityEnabled(attachmentState, 'attachment')).toBe(false);
    });

    test('creates attachment scaffold defaults for the next profile rollout', () => {
        expect(createAttachmentCapabilityScaffold()).toEqual({
            capabilityKey: 'attachment',
            displayName: 'Attachments',
            storageDriver: 'local_filesystem',
            assetKinds: [...ATTACHMENT_ASSET_KINDS],
            status: 'planned',
            targetDirectory: 'attachments',
            allowMixedMimeTypes: true
        });
    });

    test('normalizes attachment linking payload into grouped attachment capability state', () => {
        const state = normalizeAttachmentLinking({
            parent_table: 'contracts',
            child_table: 'contracts_assets',
            enabled: true,
            max_file_size_mb: 25,
            allowed_file_types: ['pdf', 'zip'],
            asset_kinds: ['pdf', 'document', 'archive']
        });

        expect(state.parentTable).toBe('contracts');
        expect(state.childTable).toBe('contracts_assets');
        expect(state.maxFileSizeMB).toBe(25);
        expect(state.allowedFileTypes).toEqual(['pdf', 'zip']);
        expect(isAssetCapabilityEnabled(state, 'attachment')).toBe(true);
    });
});
