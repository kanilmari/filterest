// attachment_profile_editor.js
// Defines attachment-profile defaults for the future asset-linking admin flow.
// Bridges the shared asset_linking view and the first non-image capability rollout.
// Exists to keep attachment-specific defaults isolated before live endpoints are wired.

import { ATTACHMENT_ASSET_KINDS } from '../asset_linking_state.js';

/**
 * Returns the default attachment profile scaffold used by the new asset-linking admin home.
 */
export function createAttachmentProfileDefaults() {
    return {
        capabilityKey: 'attachment',
        assetKinds: [...ATTACHMENT_ASSET_KINDS],
        targetDirectory: 'attachments',
        allowMixedMimeTypes: true,
        allowPrimarySelection: false
    };
}
