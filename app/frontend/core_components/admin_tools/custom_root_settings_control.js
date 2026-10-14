// custom_root_settings_control.js
// Builds the native checkbox and private deployment status in Home settings.
// Connects the existing settings editor, administrator response and local copy.
// Reuses theme tokens and live language binding without exposing paths to visitors.
import { bindDatasetLanguageRenderer } from '../table_views/dataset_value_localizer.js';
import { frontPageField, frontPageStatus } from './front_page_settings_controls.js';
import { getCustomRootCopy } from './custom_root_copy.js';

export function createCustomRootSettingsControl() {
    const input = Object.assign(document.createElement('input'), { type: 'checkbox' });
    const label = frontPageField('front_page_enabled', input, 'custom-root-enabled');
    const text = label.querySelector('span');
    delete text.dataset.langKey;
    const help = document.createElement('p');
    const status = frontPageStatus('custom-root-status');
    const path = document.createElement('code');
    path.className = 'front-page-settings-filename';
    let snapshot = null;
    bindDatasetLanguageRenderer(label, language => {
        const copy = getCustomRootCopy(language);
        text.textContent = copy.enabled;
        help.textContent = copy.help;
    });
    const renderStatus = language => {
        const copy = getCustomRootCopy(language);
        status.textContent = !snapshot || snapshot.status_error ? copy.unknown : snapshot.ready ? copy.ready
            : snapshot.exists ? copy.unavailable : copy.missing;
        path.textContent = typeof snapshot?.path === 'string' ? snapshot.path : '';
        if (path.textContent) status.append(' ', path);
    };
    bindDatasetLanguageRenderer(status, renderStatus);
    return { input, elements: [label, help, status],
        setSnapshot(value) { snapshot = value || null; renderStatus(); },
    };
}
