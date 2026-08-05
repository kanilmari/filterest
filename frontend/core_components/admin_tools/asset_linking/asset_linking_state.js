// asset_linking_state.js
// Defines shared state helpers for the future asset-linking admin view.
// Bridges raw backend payloads and the admin UI's normalized asset capability state.
// Exists to keep asset-linking state logic centralized before the live image-linking view migrates here.

export const ASSET_KINDS = Object.freeze([
    'image',
    'video',
    'audio',
    'pdf',
    'document',
    'archive'
]);

export const ATTACHMENT_ASSET_KINDS = Object.freeze([
    'pdf',
    'document',
    'archive'
]);

export function createAssetLinkingState(overrides = {}) {
    return {
        parentTable: '',
        childTable: '',
        storageDriver: 'local_filesystem',
        capabilities: {},
        maxFileSizeMB: null,
        allowedFileTypes: [],
        ...overrides
    };
}

export function normalizeImageAssetLinking(linking = {}) {
    return createAssetLinkingState({
        parentTable: linking.parent_table || '',
        childTable: linking.child_table || '',
        storageDriver: 'local_filesystem',
        capabilities: {
            image: linking.enabled ? 'enabled' : 'disabled'
        },
        maxFileSizeMB: linking.max_file_size_mb ?? null,
        allowedFileTypes: Array.isArray(linking.allowed_file_types)
            ? [...linking.allowed_file_types]
            : []
    });
}

export function normalizeAttachmentLinking(linking = {}) {
    const attachmentKinds = Array.isArray(linking.asset_kinds) && linking.asset_kinds.length > 0
        ? [...linking.asset_kinds]
        : [...ATTACHMENT_ASSET_KINDS];

    const capabilities = {};
    attachmentKinds.forEach(assetKind => {
        capabilities[assetKind] = linking.enabled ? 'enabled' : 'disabled';
    });

    return createAssetLinkingState({
        parentTable: linking.parent_table || '',
        childTable: linking.child_table || '',
        storageDriver: 'local_filesystem',
        capabilities,
        maxFileSizeMB: linking.max_file_size_mb ?? null,
        allowedFileTypes: Array.isArray(linking.allowed_file_types)
            ? [...linking.allowed_file_types]
            : []
    });
}

export function getAssetKindsForCapability(capabilityKey) {
    if (capabilityKey === 'attachment') {
        return [...ATTACHMENT_ASSET_KINDS];
    }

    return [capabilityKey];
}

export function getAssetCapabilityState(state, capabilityKey) {
    const capabilityStates = getAssetKindsForCapability(capabilityKey)
        .map(assetKind => state?.capabilities?.[assetKind])
        .filter(Boolean);

    if (capabilityStates.length === 0 || capabilityStates.every(value => value === 'disabled')) {
        return 'disabled';
    }

    if (capabilityStates.every(value => value === 'enabled')) {
        return 'enabled';
    }

    return 'partial';
}

export function isAssetCapabilityEnabled(state, capabilityKey) {
    return getAssetCapabilityState(state, capabilityKey) === 'enabled';
}

export function createAttachmentCapabilityScaffold(overrides = {}) {
    return {
        capabilityKey: 'attachment',
        displayName: 'Attachments',
        storageDriver: 'local_filesystem',
        assetKinds: [...ATTACHMENT_ASSET_KINDS],
        status: 'planned',
        targetDirectory: 'attachments',
        allowMixedMimeTypes: true,
        ...overrides
    };
}
