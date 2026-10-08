// home_palette_builder.js
// Builds the lazy administrator editor for Home's title-and-description block.
// Connects the shared shell to Home's typed snapshot, controls and live renderer.
// Shares all preview/reset/save lifecycle behaviour with the dataset palette.
import { HOME_PALETTE_COPY } from './home_palette_copy.js';
import { createHomePaletteState, saveHomePresentation } from './home_palette_state.js';
import { DEFAULT_HOME_PRESENTATION, HOME_PRESENTATION_DEFINITION } from '../../shared/front_page_presentation/validator.js';
import { hasRoutePermission } from '../route_permission_checker.js';
import { createPresentationPaletteShell, createPaletteDraftOwner, createPaletteSelectControl,
    createPaletteRangeControl, getPaletteCopy } from './presentation_palette_shell.js';

/** Mount around Home's existing trigger; permission is checked again after lazy import. */
export function mountHomePalette(button, { snapshot, render, saveRequestFn = saveHomePresentation,
    permissionCheck = hasRoutePermission } = {}) {
    if (!(button instanceof HTMLElement) || !permissionCheck('/api/admin/front-page')) return null;
    const state = createHomePaletteState(snapshot);
    const getCopy = () => getPaletteCopy(HOME_PALETTE_COPY);
    const controls = [];
    const draftOwner = createPaletteDraftOwner({ state, saveRequestFn,
        render: () => render(state.effectiveSettings()), syncControls,
        setStatus: key => shell.setStatus(key), resetGeometry: () => shell.resetGeometry() });
    const shell = createPresentationPaletteShell({ button, prefix: 'home-palette', getCopy,
        onReset: draftOwner.resetPreview, onSave: draftOwner.saveSettings,
        onCopy: copy => controls.forEach(control => control.setCopy(copy)) });
    const container = document.createElement('div');
    container.className = 'dataset-cover-test-palette__controls';
    function change(key, value) {
        // Editing a legacy layout intentionally opts into the new presentation.
        draftOwner.replaceDraft({ ...(draftOwner.draft || DEFAULT_HOME_PRESENTATION), [key]: value });
    }
    const copy = getCopy();
    for (const [id, key, label, choices] of [
        ['anchor', 'anchor', 'anchor', HOME_PRESENTATION_DEFINITION.anchors],
        ['paragraph-layout', 'paragraph_layout', 'paragraphLayout', HOME_PRESENTATION_DEFINITION.paragraph_layouts],
    ]) {
        const control = createPaletteSelectControl({ id, label, choices }, copy,
            { prefix: 'home-palette', onChange: value => change(key, value) });
        controls.push({ ...control, key });
    }
    for (const [id, key, label] of [['margin', 'margin_px', 'margin'], ['max-width', 'max_width_px', 'maxWidth']]) {
        const control = createPaletteRangeControl({ id, key, label, ...HOME_PRESENTATION_DEFINITION[key], unit: 'px' }, copy,
            { prefix: 'home-palette', onChange: value => change(key, value) });
        controls.push(control);
    }
    function syncControls() {
        const value = draftOwner.draft || DEFAULT_HOME_PRESENTATION;
        controls.forEach(control => control.setValue(value[control.key]));
    }
    controls.forEach(control => container.append(control.element));
    shell.body.insertBefore(container, shell.actions);
    syncControls();
    shell.syncCopy();
    return { ...shell, resetPreview: draftOwner.resetPreview,
        destroy() { draftOwner.destroy(); render(state.effectiveSettings()); shell.destroy(); } };
}
