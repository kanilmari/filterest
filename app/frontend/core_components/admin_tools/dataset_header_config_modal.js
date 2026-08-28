// dataset_header_config_modal.js
// Opens the shared dataset-header editor from the active dataset hero.
// Bridges the admin-only hero action, standard modal chrome, and existing editor.
// Exists so admins can manage presentation media without leaving the dataset view.

import { getTabIconPath } from '../navigation/main_tabs/tab_icon_library.js';
import { hasRoutePermission } from '../route_permission_checker.js';
import {
    createModal,
    hideModal,
    showModal,
} from '../../reusable_components/modal/modal_builder.js';
import { generate_dataset_header_config_view } from './dataset_header_config_view.js';

const DATASET_HEADER_CONFIG_PERMISSION = '/ui/admin/dataset_header_config';

function createSettingsIcon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('filterbar-inline-hero__config-icon');
    svg.setAttribute('viewBox', '0 -960 960 960');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', getTabIconPath('settings'));
    svg.appendChild(path);
    return svg;
}

export function createDatasetHeaderConfigHeroButton(datasetName) {
    const normalizedDatasetName = String(datasetName || '').trim();
    if (
        !normalizedDatasetName
        || !hasRoutePermission(DATASET_HEADER_CONFIG_PERMISSION)
    ) {
        return null;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.classList.add('filterbar-inline-hero__config-button', 'fw-btn');
    button.dataset.testid = 'dataset-header-config-hero-button';
    button.dataset.titleLangKey = 'dataset_header_config';
    button.dataset.titleLangKeyFallback = 'Dataset header configuration';
    button.dataset.ariaLabelLangKey = 'dataset_header_config';
    button.dataset.ariaLabelLangKeyFallback = 'Dataset header configuration';
    button.title = 'Dataset header configuration';
    button.setAttribute('aria-label', 'Dataset header configuration');
    button.appendChild(createSettingsIcon());
    button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.disabled = true;
        try {
            await openDatasetHeaderConfigModal(normalizedDatasetName);
        } finally {
            button.disabled = false;
        }
    });
    return button;
}

export async function openDatasetHeaderConfigModal(datasetName) {
    const normalizedDatasetName = String(datasetName || '').trim();
    if (
        !normalizedDatasetName
        || !hasRoutePermission(DATASET_HEADER_CONFIG_PERMISSION)
    ) {
        return null;
    }

    const content = document.createElement('div');
    content.classList.add('dataset-header-config-modal-content');
    content.dataset.datasetName = normalizedDatasetName;

    const { modal } = createModal({
        titleDataLangKey: 'dataset_header_config',
        titleDataLangKeyFallback: 'Dataset header configuration',
        contentElements: [content],
        width: 'min(calc(100vw - 48px), 1080px)',
        maxWidth: '1080px',
        maxHeight: 'min(calc(100dvh - 48px), 860px)',
    });
    modal.dataset.testid = 'dataset-header-config-modal';
    showModal();

    await generate_dataset_header_config_view(content, {
        initialDatasetName: normalizedDatasetName,
        onSaved: hideModal,
    });
    return modal;
}
