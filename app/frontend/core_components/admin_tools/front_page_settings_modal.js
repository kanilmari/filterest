// front_page_settings_modal.js
// Opens the existing Home settings view from a permission-checked hero gear.
// Connects shared modal lifecycle cleanup to the settings editor and Home refresh.
// Uses the same hero action styling as dataset header configuration.

import { getTabIconPath } from '../navigation/main_tabs/tab_icon_library.js';
import { hasRoutePermission } from '../route_permission_checker.js';
import { bindDatasetLanguageRenderer } from '../table_views/dataset_value_localizer.js';
import { getTranslationForKey } from '../lang/translation_handler.js';
import { createModal, showModal } from '../../reusable_components/modal/modal_builder.js';

const HOME_SETTINGS_PERMISSION = '/api/admin/front-page';

export function createFrontPageSettingsHeroButton(onSaved) {
    if (!hasRoutePermission(HOME_SETTINGS_PERMISSION)) return null;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'filterbar-inline-hero__config-button fw-btn';
    button.dataset.testid = 'front-page-settings-hero-button';
    bindDatasetLanguageRenderer(button, () => {
        button.title = getTranslationForKey('front_page_settings');
        button.setAttribute('aria-label', button.title);
    });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('filterbar-inline-hero__config-icon');
    svg.setAttribute('viewBox', '0 -960 960 960');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', getTabIconPath('settings'));
    svg.append(path);
    button.append(svg);
    button.addEventListener('click', async event => {
        event.stopPropagation();
        button.disabled = true;
        try { await openFrontPageSettingsModal(onSaved); }
        finally { button.disabled = false; }
    });
    return button;
}

export async function openFrontPageSettingsModal(onSaved) {
    if (!hasRoutePermission(HOME_SETTINGS_PERMISSION)) return null;
    // The editor and its media tools load only when an administrator opens them,
    // so a visitor's Home never downloads administration code.
    const { generate_front_page_settings_view } = await import('./front_page_settings_view.js');
    const content = document.createElement('div');
    const { modal } = createModal({
        titleDataLangKey: 'front_page_settings', contentElements: [content],
        width: '1080px', maxWidth: '1080px', maxHeight: '860px',
        cleanupCallback: () => content.__cleanupListeners?.(),
    });
    modal.dataset.testid = 'front-page-settings-modal';
    showModal();
    await generate_front_page_settings_view(content, { onSaved, modal: true });
    return modal;
}
