// dataset_cover_test_palette.js
// Mounts the three-place appearance editor on the authorized dataset hero.
// Connects separate tab/site drafts with the shared shell and scoped renderer.
// Preserves sparse inheritance, loaded revisions and existing editing rights.
import { datasetAppearanceState } from '../table_views/dataset_appearance_state.js';
import { renderDatasetAppearance } from '../table_views/dataset_appearance_renderer.js';
import { fetchAdminUIFeatureFlags, fetchCardVisibility, saveDatasetAppearance,
    fetchSitePresentationSettings, saveAdminSitePresentationSettings } from '../endpoints/stable_endpoint_router.js';
import { createMaskIconSpan } from '../../icons/icon_mask_builder.js';
import { datasetAppearanceCapabilities } from './dataset_appearance_capabilities.js';
import { hasRoutePermission } from '../route_permission_checker.js';
import { DATASET_COVER_PALETTE_COPY as COPY } from './dataset_cover_palette_copy.js';
import { buildCardStyleControl } from './card_style_palette_control.js';
import { buildLabelValueLayoutControl } from './site_label_value_layout_control.js';
import { buildCardImagePresentationControl } from './dataset_cover_card_image_control.js';
import { buildActiveFilterRemoveSideControl } from './active_filter_remove_side_control.js';
import { buildArticleImageCaptionControl } from './site_article_image_control.js';
import { DEFAULT_DATASET_COVER_THEME, isValidThemeConfig, applySitePresentationGlobals,
    getSitePresentationState } from './site_presentation_state.js';
import { datasetAppearanceField } from '../../shared/dataset_appearance/validator.js';
import { projectAppearanceMaps } from '../../shared/dataset_appearance/snapshot.js';
import { createDatasetAppearancePaletteState } from './dataset_appearance_palette_state.js';
import { openPaletteMediaEditor, openPaletteFieldEditor } from './dataset_palette_editors.js';
import { createPresentationPaletteShell, createPaletteDraftOwner, createPaletteRangeControl,
    createPaletteToolbox, getPaletteCopy } from './presentation_palette_shell.js';
export { DEFAULT_DATASET_COVER_THEME } from './site_presentation_state.js';

const DATASET_HEADER_CONFIG_PERMISSION = '/ui/admin/dataset_header_config';
const PALETTE_ICON_PATH = '/frontend/icons/general/view-palette-icon.svg';
let scopeSequence = 0;
const TOOLBOX_ICON_PATHS = Object.freeze({
    backgroundCover: '/frontend/icons/symbols/image.svg',
    cardLayout: '/frontend/icons/symbols/grid_view.svg',
    articleImages: '/frontend/icons/symbols/image.svg',
    datasetHeader: '/frontend/icons/symbols/ruler.svg',
    navigation: '/frontend/icons/symbols/settings.svg',
});

const RANGE_CONTROLS = Object.freeze([
    { id: 'oval-x', key: 'oval_width', label: 'ovalX', css: 'mask-oval-x', unit: '%', group: 'coverImage' },
    { id: 'oval-y', key: 'oval_height', label: 'ovalY', css: 'mask-oval-y', unit: '%', group: 'coverImage' },
    { id: 'oval-position-y', key: 'oval_position_y', label: 'ovalPositionY', css: 'mask-position-y', unit: '%', group: 'coverImage' },
    { id: 'center-opacity', key: 'center_opacity', label: 'centerOpacity', css: 'mask-center-opacity', unit: '', group: 'coverImage' },
    { id: 'mid-opacity', key: 'mid_opacity', label: 'midOpacity', css: 'mask-mid-opacity', unit: '', group: 'coverImage' },
    { id: 'edge-opacity', key: 'edge_opacity', label: 'edgeOpacity', css: 'mask-edge-opacity', unit: '', group: 'coverImage' },
    { id: 'center-stop', key: 'center_stop', label: 'centerStop', css: 'mask-center-stop', unit: '%', group: 'coverImage' },
    { id: 'mid-stop', key: 'mid_stop', label: 'midStop', css: 'mask-mid-stop', unit: '%', group: 'coverImage' },
    { id: 'edge-stop', key: 'edge_stop', label: 'edgeStop', css: 'mask-edge-stop', unit: '%', group: 'coverImage' },
    { id: 'image-opacity', key: 'image_opacity', label: 'imageOpacity', css: 'image-opacity', unit: '', group: 'coverImage' },
    { id: 'overlay-opacity', key: 'overlay_opacity', label: 'overlayOpacity', css: 'overlay-opacity', unit: '', group: 'coverImage' },
    { id: 'hero-height', key: 'hero_extra_height', label: 'heroHeight', css: 'hero-extra-height', unit: 'px', shared: true, group: 'coverImage' },
    { id: 'hero-bottom-fade', key: 'hero_bottom_fade', label: 'heroBottomFade', css: 'hero-bottom-fade', unit: 'px', shared: true, group: 'coverImage' },
    { id: 'image-blur', key: 'image_blur', label: 'imageBlur', css: 'image-blur', unit: 'px', group: 'backgroundImage' },
    { id: 'card-image-width', key: 'card_image_width', label: 'cardImageWidth', css: 'card-image-width', unit: 'px', shared: true, group: 'cardLayout' },
    { id: 'card-detail-columns', key: 'card_detail_columns', label: 'cardDetailColumns', hint: 'cardDetailColumnsHint', css: 'card-detail-columns', unit: '', shared: true, group: 'cardLayout' },
    { id: 'card-description-lines', key: 'card_description_lines', label: 'cardDescriptionLines', css: 'card-description-lines', unit: '', shared: true, group: 'cardLayout' },
    { id: 'filterbar-content-top-space', key: 'filterbar_content_top_space', label: 'filterbarContentTopSpace', hint: 'filterbarContentTopSpaceHint', css: 'filterbar-content-top-space', unit: 'px', shared: true, group: 'datasetHeader' },
    { id: 'active-tab-fade', key: 'active_tab_fade', label: 'activeTabFade', css: 'active-tab-fade', unit: 'px', shared: true, group: 'navigation' },
    { id: 'active-tab-max-opacity', key: 'active_tab_max_opacity', label: 'activeTabMaxOpacity', css: 'active-tab-max-opacity', unit: '', shared: true, group: 'navigation' },
    { id: 'active-tab-glow-intensity', key: 'active_tab_glow_intensity', label: 'activeTabGlowIntensity', css: 'active-tab-glow-intensity', unit: '', shared: true, group: 'navigation' },
    { id: 'active-tab-glow-width', key: 'active_tab_glow_width', label: 'activeTabGlowWidth', css: 'active-tab-glow-width', unit: 'px', shared: true, group: 'navigation' },
    { id: 'active-tab-glow-blur', key: 'active_tab_glow_blur', label: 'activeTabGlowBlur', css: 'active-tab-glow-blur', unit: 'px', shared: true, group: 'navigation' },
].map(control => {
    const field = datasetAppearanceField(`${control.shared ? 'shared' : 'light'}.${control.key}`);
    return Object.freeze({ ...control, min: field.min, max: field.max, step: field.step });
}));



let cardFieldsControlCount = 0;

function buildCardFieldsControl(copy, onChange) {
    const group = document.createElement('div');
    group.className = 'dataset-cover-test-palette__select dataset-cover-test-palette__card-fields';
    group.setAttribute('role', 'radiogroup');
    group.dataset.testid = 'dataset-cover-test-palette-card-fields';
    const heading = document.createElement('span');
    group.appendChild(heading);
    const name = `card-fields-${++cardFieldsControlCount}`;
    const choices = [false, true].map((value) => {
        const label = document.createElement('label');
        label.className = 'dataset-cover-test-palette__toggle';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = name;
        input.value = String(value);
        input.dataset.testid = `dataset-cover-test-palette-card-fields-${value ? 'all' : 'values'}`;
        const text = document.createElement('span');
        const info = document.createElement('small');
        info.id = `${name}-${value}-info`;
        input.setAttribute('aria-describedby', info.id);
        input.addEventListener('change', () => { if (input.checked) onChange(value); });
        label.append(input, text);
        group.append(label, info);
        return { input, text, info, value };
    });
    function setCopy(nextCopy) {
        heading.textContent = nextCopy.cardFields;
        group.setAttribute('aria-label', nextCopy.cardFields);
        choices.forEach(({ text, info, value }) => {
            text.textContent = value ? nextCopy.cardFieldsAll : nextCopy.cardFieldsWithValues;
            info.textContent = value ? nextCopy.cardFieldsAllInfo : nextCopy.cardFieldsWithValuesInfo;
        });
    }
    setCopy(copy);
    return { element: group, setCopy, setValue(value) {
        choices.forEach(({ input, value: choice }) => { input.checked = choice === value; });
    } };
}

function getCopy() { return getPaletteCopy(COPY); }

/** Compatibility entrypoint: public previews use the same scoped renderer as results. */
export function applyDatasetCoverThemeConfig(hero, config, { applyGlobals = true } = {}) {
    if (!(hero instanceof HTMLElement) || !isValidThemeConfig(config)) return false;
    hero.dataset.datasetAppearanceScope ||= hero.dataset.filterbarInlineHeroFor || 'preview';
    renderDatasetAppearance(hero, config);
    if (applyGlobals) applySitePresentationGlobals(config);
    return true;
}

/** One control tree follows the selected scope; changing copy never replaces focused nodes. */
function buildPaletteControl(hero, datasetName, siteState, options) {
    let copy = getCopy(), scope = 'tab', activeTheme = 'light', alive = true;
    const snapshot = datasetAppearanceState.savedSnapshot(datasetName);
    const tabState = snapshot?.schema_version === 2
        ? createDatasetAppearancePaletteState(datasetName, snapshot, () => alive && options.canCommit()) : null;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'filterbar-inline-hero__cover-palette-button fw-btn';
    button.dataset.testid = 'dataset-cover-test-palette-button';
    button.append(createMaskIconSpan(PALETTE_ICON_PATH, 'filterbar-inline-hero__cover-palette-icon'));
    const owners = {};
    const selectedOwner = () => owners[scope];
    const maySaveScope = () => Boolean(selectedOwner()) && (scope === 'tab' ? options.mayEditTab : options.mayEditSite);
    const canSave = () => maySaveScope() && !Object.values(owners).some(owner => owner.saving);
    const render = () => datasetAppearanceState.paint(datasetName);
    const errorStatus = error => {
        const key = error?.failureNotice?.langKey || error?.data?.error_lang_key || error?.error_lang_key;
        return key === 'dataset_appearance_reload' ? 'reload'
            : error?.status === 409 || key === 'dataset_appearance_conflict' ? 'conflict' : 'saveFailed';
    };
    const shell = createPresentationPaletteShell({ button, prefix: 'dataset-cover-test-palette', getCopy,
        onCopy: syncCopy, onOpen: () => switchScope('tab'), canSave,
        onReset: () => selectedOwner()?.resetPreview(), onSave: () => selectedOwner()?.saveSettings() });
    const { panel, body: panelBody } = shell;
    panel.dataset.datasetName = datasetName;
    const ownerOptions = { render, syncControls, setStatus: key => shell.setStatus(key),
        resetGeometry: () => shell.resetGeometry(), errorStatus };
    const siteAdapter = { ...siteState, async saveSettings(draft, requestFn) {
        const saved = await siteState.saveSettings(draft, requestFn);
        // A successful local site save is known to this editor. Unrelated stale
        // tokens still conflict; a conflict never adopts the server's newer token.
        if (alive && owners.tab?.draft.shared_version === draft.version) {
            owners.tab.draft.shared_version = saved.version;
            tabState.acceptSiteSave(draft.version, saved.version);
        }
        return saved;
    } };
    owners.site = createPaletteDraftOwner({ ...ownerOptions, state: siteAdapter, saveRequestFn: options.saveRequestFn });
    if (tabState) owners.tab = createPaletteDraftOwner({ ...ownerOptions, state: tabState,
        saveRequestFn: options.datasetSaveRequestFn });
    owners.site.deactivate();

    const scopeSwitch = document.createElement('fieldset');
    scopeSwitch.className = 'dataset-cover-test-palette__scope';
    scopeSwitch.dataset.testid = 'dataset-cover-test-palette-scope';
    const scopeLegend = document.createElement('legend');
    scopeSwitch.append(scopeLegend);
    const scopeName = `appearance-scope-${++scopeSequence}`;
    const scopeChoices = ['tab', 'site'].map(value => {
        const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
        input.type = 'radio'; input.name = scopeName; input.value = value;
        input.dataset.testid = `dataset-cover-test-palette-scope-${value}`;
        input.addEventListener('change', () => { if (input.checked) switchScope(value); });
        label.append(input, text); scopeSwitch.append(label);
        return { input, text, value };
    });
    panel.insertBefore(scopeSwitch, panelBody);
    const explanation = document.createElement('p');
    explanation.className = 'dataset-cover-test-palette__notice';
    explanation.dataset.testid = 'dataset-cover-test-palette-access';
    panelBody.append(explanation);

    const themeTabs = document.createElement('div');
    themeTabs.className = 'dataset-cover-test-palette__tabs';
    themeTabs.setAttribute('role', 'tablist');
    const tabButtons = ['light', 'dark'].map(theme => {
        const tab = document.createElement('button');
        tab.type = 'button'; tab.className = 'dataset-cover-test-palette__tab fw-btn';
        tab.dataset.theme = theme; tab.dataset.testid = `dataset-cover-test-palette-tab-${theme}`;
        tab.setAttribute('role', 'tab');
        tab.addEventListener('click', () => { activeTheme = theme; syncControls(); });
        themeTabs.append(tab); return tab;
    });
    panelBody.append(themeTabs);
    const toolboxByGroup = new Map();
    for (const group of ['backgroundCover', 'cardLayout', 'articleImages', 'datasetHeader', 'navigation']) {
        const toolbox = createPaletteToolbox(copy[group], { iconPath: TOOLBOX_ICON_PATHS[group],
            storageKey: `dataset_cover_palette_section_${group}` });
        toolboxByGroup.set(group, toolbox); panelBody.append(toolbox.toolbox);
    }
    toolboxByGroup.get('articleImages').toolbox.dataset.testid = 'site-article-image-palette-settings';
    const imageScopes = new Map(['backgroundImage', 'coverImage'].map(name => {
        const fieldset = document.createElement('fieldset'), legend = document.createElement('legend');
        fieldset.className = 'dataset-cover-test-palette__card-scope';
        fieldset.dataset.testid = `dataset-cover-test-palette-${name}`;
        fieldset.append(legend); toolboxByGroup.get('backgroundCover').controls.append(fieldset);
        return [name, { fieldset, legend }];
    }));
    const cardScope = document.createElement('div');
    cardScope.className = 'dataset-cover-test-palette__controls';
    cardScope.dataset.testid = 'site-card-palette-settings';
    toolboxByGroup.get('cardLayout').controls.append(cardScope);
    const rows = [];
    const editorActions = document.createElement('div');
    editorActions.className = 'dataset-cover-test-palette__tabs';
    const editorButtons = ['mediaEditor', 'fieldEditor'].map(key => {
        const action = document.createElement('button'); action.type = 'button'; action.className = 'fw-btn';
        action.dataset.testid = `dataset-cover-test-palette-${key}`;
        action.addEventListener('click', async () => {
            shell.closePanel();
            await (key === 'mediaEditor' ? options.openMediaEditor(datasetName) : options.openFieldEditor(datasetName, copy));
        });
        editorActions.append(action); return { key, action };
    });
    panelBody.append(editorActions);
    function config() {
        if (scope === 'site') return owners.site.draft.dataset_cover_theme;
        const draft = owners.tab?.draft || snapshot;
        const currentSite = siteState.savedSettings();
        return projectAppearanceMaps(currentSite.site_values, currentSite.defaults, draft?.tab_values, draft?.overrides);
    }
    function pathFor(key, shared = true) { return `${shared ? 'shared' : activeTheme}.${key}`; }
    function editable(path) {
        const field = datasetAppearanceField(path);
        const right = scope === 'tab' ? options.mayEditTab && Boolean(owners.tab)
            : options.mayEditSite;
        return right && !(scope === 'tab' && field.place === 'site_only')
            && (!path.startsWith('shared.card_') && path !== 'shared.label_value_layout' || options.mayEditCards);
    }
    function change(key, value, shared = true) {
        const path = pathFor(key, shared);
        if (!editable(path)) return;
        if (scope === 'tab') {
            const field = datasetAppearanceField(path);
            owners.tab.draft[field.place === 'tab_only' ? 'tab_values' : 'overrides'][path] = value;
        } else owners.site.draft.dataset_cover_theme.shared[key] = value;
        selectedOwner().previewDraft(); syncControls();
    }
    function addRow(control, key, parent, shared = true) {
        const field = datasetAppearanceField(pathFor(key, shared));
        const element = document.createElement('div');
        element.className = 'dataset-cover-test-palette__setting';
        element.dataset.place = field.place;
        const indicator = document.createElement('small');
        const action = document.createElement('button');
        action.type = 'button'; action.className = 'fw-btn';
        element.append(control.element);
        if (field.place !== 'tab_only') element.append(indicator, action);
        action.addEventListener('click', () => {
            if (field.place === 'site_only') {
                if (options.mayEditSite) {
                    switchScope('site'); element.closest('details').open = true;
                    element.querySelector('input, select')?.focus();
                }
            } else if (scope === 'tab' && editable(pathFor(key, shared))) {
                delete owners.tab.draft.overrides[pathFor(key, shared)];
                owners.tab.previewDraft(); syncControls();
            }
        });
        parent.append(element);
        rows.push({ control, key, shared, field, element, indicator, action });
    }
    function toggle(id, key, parent, shared = false) {
        const element = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
        element.className = 'dataset-cover-test-palette__toggle'; input.type = 'checkbox';
        input.dataset.testid = `dataset-cover-test-palette-${id}`;
        input.addEventListener('change', () => change(key, input.checked, shared)); element.append(input, text);
        addRow({ element, setValue: value => { input.checked = value; }, setCopy: next => { text.textContent = next.maskEnabled; } }, key, parent, shared);
        return input;
    }
    toggle('mask-enabled', 'oval_enabled', imageScopes.get('coverImage').fieldset);
    const visibility = document.createElement('label'), visible = document.createElement('input'), visibleText = document.createElement('span');
    visibility.className = 'dataset-cover-test-palette__toggle'; visible.type = 'checkbox';
    visible.dataset.testid = 'dataset-cover-test-palette-cover-visible'; visibility.append(visible, visibleText);
    imageScopes.get('coverImage').fieldset.prepend(visibility);
    const lastOpacity = { light: DEFAULT_DATASET_COVER_THEME.light.image_opacity, dark: DEFAULT_DATASET_COVER_THEME.dark.image_opacity };
    visible.addEventListener('change', () => change('image_opacity', visible.checked ? lastOpacity[activeTheme] : 0, false));
    const rangeControls = RANGE_CONTROLS.map(control => {
        const range = createPaletteRangeControl(control, copy, { prefix: 'dataset-cover-test-palette',
            onChange: value => change(control.key, value, Boolean(control.shared)) });
        const field = datasetAppearanceField(pathFor(control.key, Boolean(control.shared)));
        const parent = imageScopes.get(control.group)?.fieldset
            || (field.place === 'site_only' ? toolboxByGroup.get('navigation').controls
                : control.group === 'cardLayout' ? cardScope : toolboxByGroup.get(control.group).controls);
        addRow(range, control.key, parent, Boolean(control.shared)); return range;
    });
    const controls = [
        [buildCardStyleControl(copy, value => change('card_style_variant', value)), 'card_style_variant', cardScope],
        [buildCardImagePresentationControl(copy, value => change('card_image_presentation', value)), 'card_image_presentation', cardScope],
        [buildCardFieldsControl(copy, value => change('card_show_all_fields', value)), 'card_show_all_fields', cardScope],
        [buildLabelValueLayoutControl(value => change('label_value_layout', value)), 'label_value_layout', cardScope],
        [buildArticleImageCaptionControl(copy, value => change('article_image_caption_position', value)), 'article_image_caption_position', toolboxByGroup.get('articleImages').controls],
        [buildActiveFilterRemoveSideControl(copy, value => change('active_filter_remove_side', value)), 'active_filter_remove_side', toolboxByGroup.get('navigation').controls],
    ];
    controls.forEach(([control, key, parent]) => addRow(control, key, parent));
    const brand = document.createElement('label'), brandText = document.createElement('span'), brandInput = document.createElement('input');
    const brandValue = document.createElement('output');
    brand.className = 'dataset-cover-test-palette__color'; brandInput.type = 'color';
    brandInput.dataset.testid = 'dataset-cover-test-palette-brand-color';
    brandInput.addEventListener('input', () => change('brand_color', brandInput.value)); brand.append(brandText, brandValue, brandInput);
    addRow({ element: brand, setValue: value => { brandInput.value = value; brandValue.value = value; }, setCopy: next => {
        brandText.textContent = next.brandColor; brandInput.setAttribute('aria-label', next.brandColor);
    } }, 'brand_color', toolboxByGroup.get('navigation').controls);

    function switchScope(value) {
        owners[scope]?.deactivate(); scope = value; owners[scope]?.activate();
        shell.setStatus(''); syncControls(); syncCopy();
    }
    function syncControls() {
        const values = config();
        panel.dataset.scope = scope;
        scopeChoices.forEach(choice => { choice.input.checked = choice.value === scope; });
        themeTabs.hidden = toolboxByGroup.get('backgroundCover').toolbox.hidden = scope === 'site';
        editorActions.hidden = scope === 'site';
        editorButtons.forEach(({ key, action }) => {
            action.disabled = key === 'mediaEditor' ? !options.mayEditMedia : !options.mayEditCards;
        });
        tabButtons.forEach(tab => { const selected = tab.dataset.theme === activeTheme;
            tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
            tab.classList.toggle('is-active', selected); });
        for (const row of rows) {
            const path = pathFor(row.key, row.shared);
            row.element.dataset.appearancePath = path;
            row.control.setValue(values[row.shared ? 'shared' : activeTheme][row.key]);
            row.element.querySelectorAll('input, select').forEach(input => { input.disabled = !editable(path); });
            const isOverride = Boolean(owners.tab && Object.hasOwn(owners.tab.draft.overrides, path));
            row.indicator.textContent = row.field.place === 'site_only' ? copy.siteWide
                : scope === 'site' ? '' : isOverride ? copy.override : copy.inherited;
            row.indicator.hidden = scope === 'site';
            row.action.hidden = scope === 'site';
            row.action.textContent = row.field.place === 'site_only' ? copy.editSite : copy.useSiteDefault;
            row.action.disabled = row.field.place === 'site_only' ? !options.mayEditSite : !editable(path) || !isOverride;
        }
        visible.checked = values[activeTheme].image_opacity > 0;
        visible.disabled = !editable(pathFor('image_opacity', false));
        if (visible.checked) lastOpacity[activeTheme] = values[activeTheme].image_opacity;
        shell.saveButton.disabled = !canSave();
        shell.resetButton.disabled = !selectedOwner();
        explanation.textContent = scope === 'tab' && !owners.tab ? copy.tabUnavailable
            : !maySaveScope() ? (scope === 'site' ? copy.siteReadOnly : copy.tabReadOnly)
                : scope === 'tab' && !options.mayEditSite ? copy.siteReadOnly : '';
        explanation.hidden = !explanation.textContent;
    }
    function syncCopy() {
        copy = getCopy(); scopeLegend.textContent = copy.scope;
        scopeChoices.forEach(choice => { choice.text.textContent = copy[choice.value === 'tab' ? 'thisTab' : 'allDatasets']; });
        tabButtons.forEach(tab => { tab.textContent = copy[tab.dataset.theme]; });
        visibleText.textContent = copy.coverVisible;
        editorButtons.forEach(({ key, action }) => { action.textContent = copy[key]; });
        toolboxByGroup.forEach(({ label }, group) => { label.textContent = copy[group]; });
        imageScopes.forEach(({ legend }, name) => { legend.textContent = copy[name]; });
        rangeControls.forEach(control => control.setCopy(copy));
        rows.forEach(row => row.control.setCopy?.(copy));
        shell.saveButton.textContent = scope === 'tab' ? copy.saveTab : copy.saveSite;
        syncControls();
    }
    hero.append(button); shell.syncCopy();
    return { button, panel, switchScope, resetPreview: () => selectedOwner()?.resetPreview(),
        destroy() { alive = false; owners.tab?.destroy(); owners.site.destroy(); shell.destroy(); button.remove(); } };
}

/** Mount only after rights/flag checks; results normally supply the tab snapshot. */
export async function mountDatasetCoverTestPalette(hero, datasetName, {
    requestFn = fetchAdminUIFeatureFlags, settingsRequestFn = fetchSitePresentationSettings,
    saveRequestFn = saveAdminSitePresentationSettings, datasetSettingsRequestFn = fetchCardVisibility,
    datasetSaveRequestFn = saveDatasetAppearance, permissionCheck = hasRoutePermission, canCommit = () => true,
    openMediaEditor = openPaletteMediaEditor, openFieldEditor = openPaletteFieldEditor,
} = {}) {
    const name = String(datasetName || '').trim();
    if (!(hero instanceof HTMLElement) || !name) return null;
    const token = datasetAppearanceState.capture(name), callerCanCommit = canCommit;
    canCommit = () => callerCanCommit() && datasetAppearanceState.isCurrent(token);
    const state = getSitePresentationState(settingsRequestFn);
    await state.loadSettings();
    if (!canCommit()) return null;
    state.paint(); datasetAppearanceState.bind(hero, name);
    if (!permissionCheck(DATASET_HEADER_CONFIG_PERMISSION)
        || hero.querySelector('[data-testid="dataset-cover-test-palette-button"]')) return null;
    let flags;
    try { flags = await requestFn(); } catch { return null; }
    if (!canCommit() || flags?.view_admin_cover_image_test_palette !== true) return null;
    if (!datasetAppearanceState.savedSnapshot(name)) {
        try {
            const response = await datasetSettingsRequestFn(name);
            if (!canCommit()) return null;
            if (response?.table_name === name) datasetAppearanceState.accept(name, response.dataset_appearance, { token });
        } catch { /* Site controls remain readable when authorized tab data is unavailable. */ }
    }
    if (!canCommit()) return null;
    return buildPaletteControl(hero, name, state, { ...datasetAppearanceCapabilities(permissionCheck, flags),
        saveRequestFn, datasetSaveRequestFn, canCommit, openMediaEditor, openFieldEditor,
        mayEditMedia: permissionCheck(DATASET_HEADER_CONFIG_PERMISSION) });
}
