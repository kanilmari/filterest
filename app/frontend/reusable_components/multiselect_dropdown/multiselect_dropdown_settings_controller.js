// multiselect_dropdown_settings_controller.js
// Builds an optional settings disclosure beside a rich popup's title and close action.
// Connects caller-owned settings and translated labels with focus and Escape handling.
// Leaves ordinary multiselects and selection semantics with their existing owners.

import { createMaskIconSpan } from '../../icons/icon_mask_builder.js';

export function createMultiselectSettingsController({ listWrapper, header, settings, labels }) {
    const gear = document.createElement('button');
    gear.type = 'button';
    gear.className = 'msd-popup-settings-toggle';
    gear.setAttribute('aria-expanded', 'false');
    gear.appendChild(createMaskIconSpan('/frontend/icons/symbols/settings.svg', ['msd-popup-settings-icon']));
    header.appendChild(gear);
    const panel = document.createElement('div');
    panel.className = 'msd-popup-settings';
    panel.id = `${listWrapper.id}_settings`;
    panel.hidden = true;
    gear.setAttribute('aria-controls', panel.id);
    const settingsHeader = document.createElement('div');
    settingsHeader.className = 'msd-popup-settings-header';
    settings.titleElement.id = `${panel.id}_title`;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-labelledby', settings.titleElement.id);
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'msd-popup-settings-close';
    closeButton.textContent = '×';
    closeButton.addEventListener('click', () => close({ returnFocus: true }));
    settingsHeader.append(settings.titleElement);
    if (settings.helpButton) settingsHeader.append(settings.helpButton);
    settingsHeader.append(closeButton);
    panel.append(settingsHeader, settings.element);
    listWrapper.appendChild(panel);

    function close({ returnFocus = false } = {}) {
        if (panel.hidden) return false;
        panel.hidden = true;
        gear.setAttribute('aria-expanded', 'false');
        settings.onClose?.();
        if (returnFocus) gear.focus({ preventScroll: true });
        return true;
    }

    function setLabels() {
        gear.title = labels.settingsLabel;
        gear.setAttribute('aria-label', labels.settingsLabel);
        closeButton.title = labels.closeLabel;
        closeButton.setAttribute('aria-label', labels.closeLabel);
    }

    gear.addEventListener('click', () => {
        if (close({ returnFocus: true })) return;
        panel.hidden = false;
        gear.setAttribute('aria-expanded', 'true');
        // Keep focus on the gear: Tab enters the settings header, then its radios, search and options.
    });
    setLabels();
    return { close, setLabels, setAvailable(available) {
        const focusInSettings = panel.contains(document.activeElement) || document.activeElement === gear;
        if (!available) close();
        gear.hidden = !available;
        if (!available && focusInSettings) listWrapper.querySelector('.msd-dropdown-search-input')?.focus({ preventScroll: true });
    } };
}
