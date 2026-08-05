// asset_linking_view.js
// Renders the shared admin entry for asset-linking capabilities.
// Bridges image/attachment asset endpoints and the shared asset_linking module home.
// Exists to keep admin media capability management on one final asset-linking surface.

import { createModal, hideModal, showModal } from '../../../reusable_components/modal/modal_builder.js';
import { showConfirmModal } from '../../../reusable_components/modal/confirm_modal_builder.js';
import { showSuccessToast, showWarningToast } from '../../../reusable_components/notifications/toast_notification_printer.js';
import { createVanillaDropdown } from '../../../reusable_components/vanilla_dropdown/vanilla_dropdown_builder.js';
import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { getTranslationForKey } from '../../lang/translation_handler.js';
import {
    createAttachmentCapabilityScaffold,
    isAssetCapabilityEnabled,
    normalizeAttachmentLinking,
    normalizeImageAssetLinking
} from './asset_linking_state.js';
import { createAttachmentProfileDefaults } from './profiles/attachment_profile_editor.js';
import { createImageProfileDefaults } from './profiles/image_profile_editor.js';

/**
 * Generates the shared asset-linking admin view.
 * Renders image and attachment capabilities from the same shared-media admin surface.
 */
export async function generate_asset_linking_view(container) {
    try {
        container.replaceChildren();
        container.dataset.testid = 'asset-linking-root';
        renderAssetLinkingIntro(container);

        await renderCapabilitySection(container, {
            sectionTestId: 'asset-linking-image-section',
            headingText: getTranslationForKey('image_assets') || 'Image Assets',
            descriptionText: 'Image uploads now use the shared asset_linking contract and live under the same admin module as attachments.',
            enableButtonText: getTranslationForKey('enable_image_assets') || 'Enable Image Assets',
            enableRouteName: 'enableImageAssetLinking',
            statusRouteName: 'imageAssetLinkingStatus',
            disableRouteName: 'disableImageAssetLinking',
            reenableRouteName: 'updateImageAssetLinking',
            removeRouteName: 'removeImageAssetLinking',
            capabilityKey: 'image',
            responseKey: 'asset_linkings',
            emptyText: getTranslationForKey('no_image_assets') || 'No tables have image assets configured.',
            normalizeLinking: normalizeImageAssetLinking,
            defaultMaxFileSizeMB: 10,
            maxFileSizeLabel: getTranslationForKey('max_file_size_mb') || 'Max Size (MB)',
            rowTestIdPrefix: 'asset-linking-image',
            confirmRemoveMessage: (assetState) =>
                `Permanently remove image assets for "${assetState.parentTable}"? This will delete the child table "${assetState.childTable}" and ALL uploaded images.`,
            enabledToastText: getTranslationForKey('image_assets_enabled') || 'Image assets enabled successfully',
            disabledToastText: getTranslationForKey('image_assets_disabled') || 'Image assets disabled',
            reenabledToastText: getTranslationForKey('image_assets_enabled') || 'Image assets re-enabled',
            removedToastText: getTranslationForKey('image_assets_removed') || 'Image assets permanently removed',
            reenableBodyDataBuilder: (assetState) => ({
                parent_table: assetState.parentTable,
                enabled: true
            }),
        });

        await renderCapabilitySection(container, {
            sectionTestId: 'asset-linking-attachment-section',
            headingText: getTranslationForKey('attachments') || 'Attachments',
            descriptionText: 'Attachment capability now shares this asset_linking admin view, and end-user upload/delete UX is live in the article view (big card) and add-row surfaces.',
            enableButtonText: getTranslationForKey('enable_attachments') || 'Enable Attachments',
            enableRouteName: 'enableAttachmentAssetLinking',
            statusRouteName: 'attachmentAssetLinkingStatus',
            disableRouteName: 'disableAttachmentAssetLinking',
            reenableRouteName: 'enableAttachmentAssetLinking',
            removeRouteName: 'removeAttachmentAssetLinking',
            capabilityKey: 'attachment',
            responseKey: 'asset_linkings',
            emptyText: 'No tables have attachment linking configured.',
            normalizeLinking: normalizeAttachmentLinking,
            defaultMaxFileSizeMB: 25,
            maxFileSizeLabel: getTranslationForKey('max_file_size_mb') || 'Max Size (MB)',
            rowTestIdPrefix: 'asset-linking-attachment',
            confirmRemoveMessage: (assetState) =>
                `Permanently remove attachment linking for "${assetState.parentTable}"? This will delete the shared asset table "${assetState.childTable}" if no other asset profiles still use it.`,
            enabledToastText: 'Attachment linking enabled successfully',
            disabledToastText: 'Attachment linking disabled',
            reenabledToastText: 'Attachment linking re-enabled',
            removedToastText: 'Attachment linking permanently removed',
            reenableBodyDataBuilder: (assetState) => ({
                parent_table: assetState.parentTable
            }),
            supportNoteBuilder: () => buildAttachmentSupportNote(),
        });
    } catch (error) {
        console.warn('Error generating asset linking view:', error);
    }
}

/**
 * Renders the shared intro only for the new asset-linking entrypoint.
 */
function renderAssetLinkingIntro(container) {
    const heading = document.createElement('h2');
    heading.textContent = getTranslationForKey('asset_linking') || 'Asset Linking';

    const description = document.createElement('p');
    description.textContent = getTranslationForKey('asset_linking_scaffold_description')
        || 'Asset linking now owns the image admin workflow here and attachment capability is live on the same foundation.';

    container.append(heading, description);
}

/**
 * Renders one capability section such as images or attachments.
 */
async function renderCapabilitySection(container, config) {
    const section = document.createElement('section');
    section.dataset.testid = config.sectionTestId;
    section.style.marginTop = container.children.length === 0 ? '0' : '28px';
    if (container.children.length > 0) {
        section.style.paddingTop = '20px';
        section.style.borderTop = '1px solid var(--border_color, rgba(255,255,255,0.12))';
    }

    const heading = document.createElement('h3');
    heading.textContent = config.headingText;
    section.appendChild(heading);

    if (config.descriptionText) {
        const description = document.createElement('p');
        description.textContent = config.descriptionText;
        description.style.color = 'var(--text_color_secondary)';
        section.appendChild(description);
    }

    if (typeof config.supportNoteBuilder === 'function') {
        section.appendChild(config.supportNoteBuilder());
    }

    const addButton = document.createElement('button');
    addButton.textContent = config.enableButtonText;
    addButton.dataset.testid = `${config.rowTestIdPrefix}-enable-button`;
    addButton.style.marginBottom = '16px';
    section.appendChild(addButton);

    addButton.addEventListener('click', async () => {
        const form = await createCapabilityEnableForm(container, config);
        createModal({
            title: config.enableButtonText,
            contentElements: [form],
            width: '500px'
        });
        showModal();
    });

    const result = await fetchCapabilityStatus(config.statusRouteName);
    const linkings = result[config.responseKey || inferResponseKey(config.statusRouteName)] || [];
    if (linkings.length === 0) {
        const emptyMsg = document.createElement('p');
        emptyMsg.textContent = config.emptyText;
        emptyMsg.style.color = 'var(--text_color_secondary)';
        emptyMsg.dataset.testid = `${config.rowTestIdPrefix}-empty`;
        section.appendChild(emptyMsg);
        container.appendChild(section);
        return;
    }

    section.appendChild(buildCapabilityTable(container, config, linkings));
    container.appendChild(section);
}

/**
 * Fetches one capability status payload.
 */
async function fetchCapabilityStatus(statusRouteName) {
    try {
        return await endpoint_router(statusRouteName);
    } catch (err) {
        console.warn(`Error fetching ${statusRouteName}:`, err);
        return {};
    }
}

/**
 * Builds the enable form for one capability section.
 */
async function createCapabilityEnableForm(container, config) {
    const form = document.createElement('form');
    form.dataset.testid = `${config.rowTestIdPrefix}-enable-form`;

    const tableLabel = document.createElement('label');
    tableLabel.textContent = getTranslationForKey('select_table') || 'Table:';
    tableLabel.style.display = 'block';
    tableLabel.style.marginBottom = '8px';
    form.appendChild(tableLabel);

    const tableDropdownDiv = document.createElement('div');
    tableDropdownDiv.style.marginBottom = '16px';
    form.appendChild(tableDropdownDiv);

    let tables = [];
    try {
        tables = await endpoint_router('datasetNames');
    } catch (err) {
        console.warn('Error fetching table names:', err);
    }

    const tableOptions = tables.map(tableName => ({ value: tableName, label: tableName }));
    const tableDropdown = createVanillaDropdown({
        containerElement: tableDropdownDiv,
        options: tableOptions,
        placeholder: getTranslationForKey('select_table') || 'Select table...'
    });

    const sizeLabel = document.createElement('label');
    sizeLabel.textContent = getTranslationForKey('max_file_size_mb') || 'Max file size (MB):';
    sizeLabel.style.display = 'block';
    sizeLabel.style.marginBottom = '4px';
    form.appendChild(sizeLabel);

    const sizeInput = document.createElement('input');
    sizeInput.type = 'number';
    sizeInput.value = String(config.defaultMaxFileSizeMB);
    sizeInput.min = '1';
    sizeInput.max = '100';
    sizeInput.style.marginBottom = '16px';
    sizeInput.style.width = '100px';
    form.appendChild(sizeInput);
    form.appendChild(document.createElement('br'));

    const formActions = document.createElement('div');
    formActions.classList.add('form-actions');

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.textContent = getTranslationForKey('cancel') || 'Cancel';
    cancelButton.classList.add('cancel-button');
    cancelButton.addEventListener('click', () => hideModal());

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.textContent = config.enableButtonText;
    submitButton.classList.add('submit-button');

    formActions.append(cancelButton, submitButton);
    form.appendChild(formActions);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const parentTable = tableDropdown.getValue();
        if (!parentTable) {
            showWarningToast(getTranslationForKey('select_table') || 'Please select a table.');
            return;
        }

        try {
            await endpoint_router(config.enableRouteName, {
                method: 'POST',
                body_data: {
                    parent_table: parentTable,
                    max_file_size_mb: parseInt(sizeInput.value, 10) || config.defaultMaxFileSizeMB
                }
            });
            showSuccessToast(config.enabledToastText);
            hideModal();
            await generate_asset_linking_view(container);
        } catch (error) {
            console.warn(`Error enabling ${config.capabilityKey} linking:`, error);
        }
    });

    return form;
}

/**
 * Builds the capability table and action buttons for one section.
 */
function buildCapabilityTable(container, config, linkings) {
    const table = document.createElement('table');
    table.dataset.testid = `${config.rowTestIdPrefix}-table`;

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const columns = [
        getTranslationForKey('parent_table') || 'Parent Table',
        getTranslationForKey('child_table') || 'Child Table',
        getTranslationForKey('status') || 'Status',
        config.maxFileSizeLabel,
        getTranslationForKey('actions') || 'Actions'
    ];

    columns.forEach(columnLabel => {
        const th = document.createElement('th');
        th.textContent = columnLabel;
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    linkings.forEach(linking => {
        const assetState = config.normalizeLinking(linking);
        const capabilityEnabled = isAssetCapabilityEnabled(assetState, config.capabilityKey);
        const row = document.createElement('tr');
        row.dataset.testid = `${config.rowTestIdPrefix}-row-${assetState.parentTable}`;

        const parentTd = document.createElement('td');
        parentTd.textContent = assetState.parentTable;
        row.appendChild(parentTd);

        const childTd = document.createElement('td');
        childTd.textContent = assetState.childTable;
        row.appendChild(childTd);

        const statusTd = document.createElement('td');
        statusTd.appendChild(createStatusBadge(capabilityEnabled, `${config.rowTestIdPrefix}-status-${assetState.parentTable}`));
        row.appendChild(statusTd);

        const sizeTd = document.createElement('td');
        sizeTd.textContent = assetState.maxFileSizeMB || '-';
        row.appendChild(sizeTd);

        row.appendChild(createCapabilityActionsCell(container, config, assetState, capabilityEnabled));
        tbody.appendChild(row);
    });

    table.appendChild(tbody);
    return table;
}

/**
 * Renders the status badge used by the shared asset-linking tables.
 */
function createStatusBadge(isEnabled, testId) {
    const statusBadge = document.createElement('span');
    statusBadge.dataset.testid = testId;
    statusBadge.dataset.state = isEnabled ? 'enabled' : 'disabled';
    statusBadge.textContent = isEnabled
        ? (getTranslationForKey('active') || 'Active')
        : (getTranslationForKey('disabled') || 'Disabled');
    statusBadge.style.padding = '2px 8px';
    statusBadge.style.borderRadius = '4px';
    statusBadge.style.fontSize = '0.85em';
    statusBadge.style.backgroundColor = isEnabled ? 'var(--success_bg, #d4edda)' : 'var(--warning_bg, #fff3cd)';
    statusBadge.style.color = isEnabled ? 'var(--success_text, #155724)' : 'var(--warning_text, #856404)';
    return statusBadge;
}

/**
 * Builds the action buttons for one capability row.
 */
function createCapabilityActionsCell(container, config, assetState, capabilityEnabled) {
    const actionsTd = document.createElement('td');
    actionsTd.style.display = 'flex';
    actionsTd.style.gap = '6px';

    const toggleButton = document.createElement('button');
    toggleButton.dataset.testid = `${config.rowTestIdPrefix}-toggle-${assetState.parentTable}`;
    toggleButton.textContent = capabilityEnabled
        ? (getTranslationForKey('disable') || 'Disable')
        : (getTranslationForKey('enable') || 'Enable');
    toggleButton.style.fontSize = '0.85em';
    toggleButton.addEventListener('click', async () => {
        try {
            if (capabilityEnabled) {
                await endpoint_router(config.disableRouteName, {
                    method: 'POST',
                    body_data: { parent_table: assetState.parentTable }
                });
                showSuccessToast(config.disabledToastText);
            } else {
                await endpoint_router(config.reenableRouteName, {
                    method: 'POST',
                    body_data: config.reenableBodyDataBuilder(assetState)
                });
                showSuccessToast(config.reenabledToastText);
            }

            await generate_asset_linking_view(container);
        } catch (error) {
            console.warn(`Error toggling ${config.capabilityKey} linking:`, error);
        }
    });
    actionsTd.appendChild(toggleButton);

    if (config.removeRouteName) {
        const removeButton = document.createElement('button');
        removeButton.dataset.testid = `${config.rowTestIdPrefix}-remove-${assetState.parentTable}`;
        removeButton.textContent = getTranslationForKey('remove') || 'Remove';
        removeButton.style.fontSize = '0.85em';
        removeButton.style.color = 'var(--danger_text, #721c24)';
        removeButton.addEventListener('click', async () => {
            const ok = await showConfirmModal({
                messagePlainText: config.confirmRemoveMessage(assetState),
                messageLangKey: config.confirmRemoveLangKey,
                isDanger: true
            });
            if (!ok) {
                return;
            }

            try {
                await endpoint_router(config.removeRouteName, {
                    method: 'POST',
                    body_data: { parent_table: assetState.parentTable, confirm: true }
                });
                showSuccessToast(config.removedToastText);
                await generate_asset_linking_view(container);
            } catch (error) {
                console.warn(`Error removing ${config.capabilityKey} linking:`, error);
            }
        });
        actionsTd.appendChild(removeButton);
    }

    return actionsTd;
}

/**
 * Creates the attachment support note shown above the live attachment table.
 */
function buildAttachmentSupportNote() {
    const attachmentProfile = createAttachmentProfileDefaults();
    const attachmentCapability = createAttachmentCapabilityScaffold({
        maxFileSizeMB: 25
    });
    const imageProfile = createImageProfileDefaults();

    const note = document.createElement('div');
    note.dataset.testid = 'asset-linking-attachment-note';
    note.style.marginBottom = '14px';

    const badge = document.createElement('span');
    badge.textContent = 'Beta';
    badge.style.display = 'inline-block';
    badge.style.marginBottom = '10px';
    badge.style.padding = '2px 8px';
    badge.style.borderRadius = '999px';
    badge.style.backgroundColor = 'var(--warning_bg, #fff3cd)';
    badge.style.color = 'var(--warning_text, #856404)';
    badge.style.fontSize = '0.85em';

    const details = document.createElement('ul');
    details.style.margin = '0 0 0 18px';
    [
        `Planned asset kinds: ${attachmentCapability.assetKinds.join(', ')}`,
        `Default target directory: ${attachmentProfile.targetDirectory}`,
        `Primary preview stays image-specific via ${imageProfile.cacheColumn}`,
        `Mixed MIME types allowed: ${attachmentProfile.allowMixedMimeTypes ? 'yes' : 'no'}`
    ].forEach(line => {
        const item = document.createElement('li');
        item.textContent = line;
        details.appendChild(item);
    });

    note.append(badge, details);
    return note;
}

function inferResponseKey(statusRouteName) {
    if (statusRouteName === 'attachmentAssetLinkingStatus' || statusRouteName === 'imageAssetLinkingStatus') {
        return 'asset_linkings';
    }
    return 'asset_linkings';
}
