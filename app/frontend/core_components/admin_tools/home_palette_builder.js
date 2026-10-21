// home_palette_builder.js
// Builds Home's lazy text-position, alignment and per-theme media editor.
// Connects the shared shell to Home's typed snapshot, controls and live renderer.
// Shares all preview/reset/save lifecycle behaviour with the dataset palette.
import { createHomePaletteChoiceControl } from './home_palette_choice_control.js';
import { HOME_PALETTE_COPY } from './home_palette_copy.js';
import { createHomePaletteState, saveHomePresentation } from './home_palette_state.js';
import { DEFAULT_HOME_PRESENTATION, HOME_PRESENTATION_DEFINITION } from '../../shared/front_page_presentation/validator.js';
import { hasRoutePermission } from '../route_permission_checker.js';
import { createPresentationPaletteShell, createPaletteDraftOwner,
    createPaletteRangeControl, createPaletteSelectControl, getPaletteCopy } from './presentation_palette_shell.js';

/** Mount around Home's existing trigger; permission is checked again after lazy import. */
export function mountHomePalette(button, { snapshot, render, saveRequestFn = saveHomePresentation,
    permissionCheck = hasRoutePermission } = {}) {
    if (!(button instanceof HTMLElement) || !permissionCheck('/api/admin/front-page')) return null;
    const state = createHomePaletteState(snapshot);
    const getCopy = () => getPaletteCopy(HOME_PALETTE_COPY);
    const controls = [];
    const themeLegends = [];
    const draftOwner = createPaletteDraftOwner({ state, saveRequestFn,
        render: () => render(state.effectiveSettings()), syncControls,
        setStatus: key => shell.setStatus(key), resetGeometry: () => shell.resetGeometry() });
    const shell = createPresentationPaletteShell({ button, prefix: 'home-palette', getCopy,
        onReset: draftOwner.resetPreview, onSave: draftOwner.saveSettings,
        onCopy: copy => {
            controls.forEach(control => control.setCopy(copy));
            themeLegends.forEach(({ theme, legend }) => { legend.textContent = copy[theme]; });
        } });
    const container = document.createElement('div');
    container.className = 'dataset-cover-test-palette__controls';
    function change(key, value) {
        // The same draft owns positioning, alignment and both themes during preview.
        draftOwner.replaceDraft({ ...(draftOwner.draft || DEFAULT_HOME_PRESENTATION), [key]: value });
    }
    const copy = getCopy();
    for (const [id, key, label, choices, grid] of [
        ['anchor', 'anchor', 'anchor', HOME_PRESENTATION_DEFINITION.anchors, true],
        ['alignment', 'alignment', 'alignment', HOME_PRESENTATION_DEFINITION.alignments, false],
    ]) {
        const control = createHomePaletteChoiceControl({ id, label, choices, grid }, copy,
            value => change(key, value));
        controls.push({ ...control, key });
        container.append(control.element);
    }
    const phoneAlignment = createPaletteSelectControl({ id: 'phone-alignment', label: 'phoneAlignment',
        choices: HOME_PRESENTATION_DEFINITION.phone_alignments }, copy,
        { prefix: 'home-palette', onChange: value => change('phone_alignment', value) });
    controls.push({ ...phoneAlignment, key: 'phone_alignment' });
    container.append(phoneAlignment.element);
    for (const [id, key, label] of [
        ['horizontal-margin', 'horizontal_margin_px', 'horizontalMargin'],
        ['vertical-margin', 'vertical_margin_px', 'verticalMargin'],
        ['max-width', 'max_width_px', 'maxWidth'],
    ]) {
        const control = createPaletteRangeControl({ id, key, label, ...HOME_PRESENTATION_DEFINITION[key], unit: 'px' }, copy,
            { prefix: 'home-palette', onChange: value => change(key, value) });
        controls.push(control);
        container.append(control.element);
    }
    for (const theme of ['light', 'dark']) {
        const section = document.createElement('fieldset');
        section.className = 'home-palette-theme';
        section.dataset.testid = `home-palette-${theme}`;
        const legend = document.createElement('legend');
        section.append(legend);
        themeLegends.push({ theme, legend });
        for (const property of ['wash', 'opacity']) {
            const key = `${theme}_${property}`;
            const control = createPaletteRangeControl({ id: `${theme}-${property}`, key, label: property,
                ...HOME_PRESENTATION_DEFINITION[key], unit: '%' }, copy,
                { prefix: 'home-palette', onChange: value => change(key, value) });
            controls.push(control);
            section.append(control.element);
        }
        container.append(section);
    }
    // Nested typography choices share the same draft as layout and phone alignment.
    const changeTextStyle = (key, value, reveal = false) => {
        const current = (draftOwner.draft || DEFAULT_HOME_PRESENTATION).text_style;
        change('text_style', reveal ? { ...current, reveal: { ...current.reveal, [key]: value } }
            : { ...current, [key]: value });
    };
    for (const [id, label, choices, key, reveal] of [
        ['text-style', 'textStyle', HOME_PRESENTATION_DEFINITION.text_style.presets, 'preset', false],
        ['line-reveal', 'lineReveal', HOME_PRESENTATION_DEFINITION.text_style.reveal_modes, 'mode', true],
    ]) {
        const control = createPaletteSelectControl({ id, label, choices }, copy,
            { prefix: 'home-palette', onChange: value => changeTextStyle(key, value, reveal) });
        controls.push({ ...control, readValue: value => reveal ? value.text_style.reveal[key] : value.text_style[key] });
        container.append(control.element);
    }
    for (const [id, key, label] of [['reveal-start', 'start_ms', 'revealStart'], ['reveal-interval', 'interval_ms', 'revealInterval']]) {
        const control = createPaletteRangeControl({ id, label, ...HOME_PRESENTATION_DEFINITION.text_style[key], unit: 'ms' }, copy,
            { prefix: 'home-palette', onChange: value => changeTextStyle(key, value, true) });
        controls.push({ ...control, readValue: value => value.text_style.reveal[key] });
        container.append(control.element);
    }
    function syncControls() {
        const value = draftOwner.draft || DEFAULT_HOME_PRESENTATION;
        controls.forEach(control => control.setValue(control.readValue ? control.readValue(value) : value[control.key]));
    }
    shell.body.append(container);
    syncControls();
    shell.syncCopy();
    return { ...shell, resetPreview: draftOwner.resetPreview,
        destroy() { draftOwner.destroy(); render(state.effectiveSettings()); shell.destroy(); } };
}
