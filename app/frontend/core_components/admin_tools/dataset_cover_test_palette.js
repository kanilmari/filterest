// dataset_cover_test_palette.js
// Applies public dataset-cover presentation settings and mounts their admin editor.
// Bridges the typed presentation API, theme CSS variables, and flag-gated controls.
// Exists so live visual tuning and durable saves share one validated configuration shape.

import {
    fetchAdminUIFeatureFlags, fetchCardVisibility, saveDatasetCardPresentation,
    fetchSitePresentationSettings,
    saveAdminSitePresentationSettings,
} from '../endpoints/stable_endpoint_router.js';
import { createMaskIconSpan } from '../../icons/icon_mask_builder.js';
import { showToast } from '../../reusable_components/notifications/toast_notification_printer.js';
import { hasRoutePermission } from '../route_permission_checker.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import { DATASET_COVER_PALETTE_COPY as COPY } from './dataset_cover_palette_copy.js';
import { buildDatasetCardPaletteControl, buildCardStyleControl } from './dataset_card_palette_control.js';
import { buildCardImagePresentationControl } from './dataset_cover_card_image_control.js';
import { buildArticleImageCaptionControl } from './site_article_image_control.js';
import {
    DEFAULT_DATASET_COVER_THEME, isValidThemeConfig, applySitePresentationGlobals,
    getSitePresentationState,
} from './site_presentation_state.js';
export { DEFAULT_DATASET_COVER_THEME } from './site_presentation_state.js';

const DATASET_HEADER_CONFIG_PERMISSION = '/ui/admin/dataset_header_config';
const PALETTE_ICON_PATH = '/frontend/icons/general/view-palette-icon.svg';
const TOOLBOX_CHEVRON_PATH = '/frontend/icons/general/chevron-down-icon.svg';
const TOOLBOX_ICON_PATHS = Object.freeze({
    themeImage: '/frontend/icons/symbols/image.svg',
    ovalGeometry: '/frontend/icons/symbols/ruler.svg',
    ovalGradient: '/frontend/icons/symbols/tune.svg',
    heroLayout: '/frontend/icons/symbols/layers.svg',
    cardLayout: '/frontend/icons/symbols/grid_view.svg',
    articleImages: '/frontend/icons/symbols/image.svg',
    navigation: '/frontend/icons/symbols/settings.svg',
});

const RANGE_CONTROLS = Object.freeze([
    { id: 'oval-x', key: 'oval_width', label: 'ovalX', css: 'mask-oval-x', min: 20, max: 140, step: 1, unit: '%', group: 'ovalGeometry' },
    { id: 'oval-y', key: 'oval_height', label: 'ovalY', css: 'mask-oval-y', min: 20, max: 140, step: 1, unit: '%', group: 'ovalGeometry' },
    { id: 'oval-position-y', key: 'oval_position_y', label: 'ovalPositionY', css: 'mask-position-y', min: 0, max: 100, step: 1, unit: '%', group: 'ovalGeometry' },
    { id: 'center-opacity', key: 'center_opacity', label: 'centerOpacity', css: 'mask-center-opacity', min: 0, max: 1, step: 0.05, unit: '', group: 'ovalGradient' },
    { id: 'mid-opacity', key: 'mid_opacity', label: 'midOpacity', css: 'mask-mid-opacity', min: 0, max: 1, step: 0.05, unit: '', group: 'ovalGradient' },
    { id: 'edge-opacity', key: 'edge_opacity', label: 'edgeOpacity', css: 'mask-edge-opacity', min: 0, max: 1, step: 0.05, unit: '', group: 'ovalGradient' },
    { id: 'center-stop', key: 'center_stop', label: 'centerStop', css: 'mask-center-stop', min: 0, max: 100, step: 1, unit: '%', group: 'ovalGradient' },
    { id: 'mid-stop', key: 'mid_stop', label: 'midStop', css: 'mask-mid-stop', min: 0, max: 100, step: 1, unit: '%', group: 'ovalGradient' },
    { id: 'edge-stop', key: 'edge_stop', label: 'edgeStop', css: 'mask-edge-stop', min: 0, max: 100, step: 1, unit: '%', group: 'ovalGradient' },
    { id: 'image-opacity', key: 'image_opacity', label: 'imageOpacity', css: 'image-opacity', min: 0, max: 1, step: 0.05, unit: '', group: 'themeImage' },
    { id: 'overlay-opacity', key: 'overlay_opacity', label: 'overlayOpacity', css: 'overlay-opacity', min: 0, max: 1, step: 0.01, unit: '', group: 'themeImage' },
    { id: 'hero-height', key: 'hero_extra_height', label: 'heroHeight', css: 'hero-extra-height', min: 0, max: 240, step: 5, unit: 'px', shared: true, group: 'heroLayout' },
    { id: 'hero-bottom-fade', key: 'hero_bottom_fade', label: 'heroBottomFade', css: 'hero-bottom-fade', min: 0, max: 200, step: 2, unit: 'px', shared: true, group: 'heroLayout' },
    { id: 'image-blur', key: 'image_blur', label: 'imageBlur', css: 'image-blur', min: 0, max: 24, step: 1, unit: 'px', group: 'themeImage' },
    { id: 'card-image-width', key: 'card_image_width', label: 'cardImageWidth', css: 'card-image-width', min: 30, max: 600, step: 5, unit: 'px', shared: true, group: 'cardLayout' },
    { id: 'card-detail-columns', key: 'card_detail_columns', label: 'cardDetailColumns', hint: 'cardDetailColumnsHint', css: 'card-detail-columns', min: 1, max: 4, step: 1, unit: '', shared: true, group: 'cardLayout' },
    { id: 'card-description-lines', key: 'card_description_lines', label: 'cardDescriptionLines', css: 'card-description-lines', min: 1, max: 12, step: 1, unit: '', shared: true, group: 'cardLayout' },
    { id: 'active-tab-fade', key: 'active_tab_fade', label: 'activeTabFade', css: 'active-tab-fade', min: 0, max: 100, step: 1, unit: 'px', shared: true, group: 'navigation' },
    { id: 'active-tab-max-opacity', key: 'active_tab_max_opacity', label: 'activeTabMaxOpacity', css: 'active-tab-max-opacity', min: 0, max: 1, step: 0.05, unit: '', shared: true, group: 'navigation' },
    { id: 'active-tab-glow-intensity', key: 'active_tab_glow_intensity', label: 'activeTabGlowIntensity', css: 'active-tab-glow-intensity', min: 0, max: 1, step: 0.05, unit: '', shared: true, group: 'navigation' },
    { id: 'active-tab-glow-width', key: 'active_tab_glow_width', label: 'activeTabGlowWidth', css: 'active-tab-glow-width', min: 0, max: 8, step: 0.25, unit: 'px', shared: true, group: 'navigation' },
    { id: 'active-tab-glow-blur', key: 'active_tab_glow_blur', label: 'activeTabGlowBlur', css: 'active-tab-glow-blur', min: 0, max: 12, step: 0.5, unit: 'px', shared: true, group: 'navigation' },
]);



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

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function getCopy() {
    const language = String(document.documentElement.lang.trim() || getLanguageWithBrowserFallback() || 'en').toLowerCase();
    return COPY[language] || COPY[language.split('-')[0]] || COPY.en;
}

function renderControlValue(value, unit) {
    const numericValue = Number.parseFloat(value);
    const displayValue = Number.isInteger(numericValue)
        ? String(numericValue)
        : numericValue.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return `${displayValue}${unit}`;
}

function setThemeVariable(hero, themeName, control, value) {
    const prefix = control.shared ? '' : `${themeName}-`;
    hero.style.setProperty(`--dataset-cover-${prefix}${control.css}`, `${value}${control.unit}`);
}

export function applyDatasetCoverThemeConfig(hero, config, { applyGlobals = true } = {}) {
    if (!(hero instanceof HTMLElement) || !isValidThemeConfig(config)) return false;
    ['light', 'dark'].forEach((themeName) => {
        RANGE_CONTROLS.filter((control) => !control.shared).forEach((control) => {
            setThemeVariable(hero, themeName, control, config[themeName][control.key]);
        });
        hero.style.setProperty(
            `--dataset-cover-${themeName}-mask-image`,
            config[themeName].oval_enabled ? 'initial' : 'none'
        );
    });
    RANGE_CONTROLS.filter((control) => control.shared).forEach((control) => {
        setThemeVariable(hero, 'shared', control, config.shared[control.key]);
    });
    if (applyGlobals) applySitePresentationGlobals(config);
    return true;
}

function setupPanelDragging(panel, dragHandle) {
    let dragState = null;
    function handlePointerDown(event) {
        if (event.button !== 0 || event.target.closest('button, input, output')) return;
        const rect = panel.getBoundingClientRect();
        panel.style.left = `${rect.left}px`;
        panel.style.top = `${rect.top}px`;
        panel.style.right = 'auto';
        dragState = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
        panel.classList.add('dataset-cover-test-palette--dragging');
        if (Number.isInteger(event.pointerId)) dragHandle.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    }
    function handlePointerMove(event) {
        if (!dragState) return;
        const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);
        panel.style.left = `${Math.min(Math.max(0, event.clientX - dragState.offsetX), maxLeft)}px`;
        panel.style.top = `${Math.min(Math.max(0, event.clientY - dragState.offsetY), maxTop)}px`;
        event.preventDefault();
    }
    function handlePointerUp(event) {
        if (Number.isInteger(event.pointerId)) dragHandle.releasePointerCapture?.(event.pointerId);
        dragState = null;
        panel.classList.remove('dataset-cover-test-palette--dragging');
    }
    function resetGeometry() {
        ['left', 'top', 'right', 'width', 'height'].forEach((property) => panel.style.removeProperty(property));
    }
    dragHandle.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);
    document.addEventListener('pointercancel', handlePointerUp);
    return {
        resetGeometry,
        destroy() {
            dragHandle.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('pointermove', handlePointerMove);
            document.removeEventListener('pointerup', handlePointerUp);
            document.removeEventListener('pointercancel', handlePointerUp);
        },
    };
}

function createPaletteToolbox(title, {
    iconPath = TOOLBOX_ICON_PATHS.themeImage,
    open = false,
    testid = '',
    storageKey = '',
} = {}) {
    const toolbox = document.createElement('details');
    toolbox.classList.add('dataset-cover-test-palette__group');
    toolbox.open = open;
    if (storageKey) {
        try { toolbox.open = localStorage.getItem(storageKey) === 'true'; }
        catch { /* A blocked local store keeps the closed default usable. */ }
    }
    if (testid) toolbox.dataset.testid = testid;
    const summary = document.createElement('summary');
    summary.classList.add('dataset-cover-test-palette__group-title');
    const chevron = createMaskIconSpan(
        TOOLBOX_CHEVRON_PATH,
        'dataset-cover-test-palette__group-chevron'
    );
    const icon = createMaskIconSpan(
        iconPath,
        'dataset-cover-test-palette__group-icon'
    );
    const label = document.createElement('span');
    label.classList.add('dataset-cover-test-palette__group-label');
    label.textContent = title;
    summary.append(chevron, icon, label);
    const content = document.createElement('div');
    content.classList.add('dataset-cover-test-palette__group-content');
    const controls = document.createElement('div');
    controls.classList.add('dataset-cover-test-palette__controls');
    content.appendChild(controls);
    toolbox.append(summary, content);
    // Native summary activation covers pointer, touch and keyboard clicks.
    // Initialization and programmatic openings do not become remembered user choices.
    let userTogglePending = false;
    summary.addEventListener('click', (event) => {
        if (!event.defaultPrevented) userTogglePending = true;
    });
    toolbox.addEventListener('toggle', () => {
        if (!userTogglePending || !storageKey) return;
        userTogglePending = false;
        try { localStorage.setItem(storageKey, String(toolbox.open)); }
        catch { /* Persistence is optional; the user's visible toggle still works. */ }
    });
    return { toolbox, content, controls, label };
}

function buildPaletteControl(hero, datasetName, initialSettings, saveRequestFn, state, datasetOptions) {
    let copy = getCopy();
    let statusKey = '';
    let statusToast = null;
    let statusMessage = null;
    const previewOwner = {};
    let destroyed = false;
    let draftRevision = 0;
    let draftSettings = clone(initialSettings);
    let activeTheme = 'light';
    function renderHero() {
        applyDatasetCoverThemeConfig(hero, state.effectiveSettings().dataset_cover_theme, { applyGlobals: false });
    }
    function previewDraft() {
        draftRevision += 1;
        state.setPreview(previewOwner, draftSettings);
        renderHero();
    }
    const lastVisibleImageOpacity = {
        light: Number(initialSettings.dataset_cover_theme.light.image_opacity) > 0
            ? Number(initialSettings.dataset_cover_theme.light.image_opacity)
            : DEFAULT_DATASET_COVER_THEME.light.image_opacity,
        dark: Number(initialSettings.dataset_cover_theme.dark.image_opacity) > 0
            ? Number(initialSettings.dataset_cover_theme.dark.image_opacity)
            : DEFAULT_DATASET_COVER_THEME.dark.image_opacity,
    };
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.add('filterbar-inline-hero__cover-palette-button', 'fw-btn');
    button.dataset.testid = 'dataset-cover-test-palette-button';
    button.title = copy.button;
    button.setAttribute('aria-label', copy.button);
    button.setAttribute('aria-expanded', 'false');
    button.appendChild(createMaskIconSpan(PALETTE_ICON_PATH, 'filterbar-inline-hero__cover-palette-icon'));

    const panel = document.createElement('section');
    panel.classList.add('dataset-cover-test-palette');
    panel.dataset.testid = 'dataset-cover-test-palette';
    panel.dataset.datasetName = datasetName;
    panel.hidden = true;

    const headingRow = document.createElement('div');
    headingRow.classList.add('dataset-cover-test-palette__heading');
    const heading = document.createElement('strong');
    heading.textContent = copy.title;
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.classList.add('dataset-cover-test-palette__close');
    closeButton.dataset.testid = 'dataset-cover-test-palette-close';
    closeButton.textContent = '×';
    closeButton.title = copy.close;
    closeButton.setAttribute('aria-label', copy.close);
    headingRow.append(heading, closeButton);

    const notice = document.createElement('p');
    notice.classList.add('dataset-cover-test-palette__notice');
    notice.textContent = copy.notice;

    const panelBody = document.createElement('div');
    panelBody.classList.add('dataset-cover-test-palette__body');

    const tabs = document.createElement('div');
    tabs.classList.add('dataset-cover-test-palette__tabs');
    tabs.setAttribute('role', 'tablist');
    const tabButtons = ['light', 'dark'].map((themeName) => {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.classList.add('dataset-cover-test-palette__tab', 'fw-btn');
        tab.dataset.theme = themeName;
        tab.dataset.testid = `dataset-cover-test-palette-tab-${themeName}`;
        tab.setAttribute('role', 'tab');
        tab.textContent = copy[themeName];
        tabs.appendChild(tab);
        return tab;
    });

    const maskLabel = document.createElement('label');
    maskLabel.classList.add('dataset-cover-test-palette__toggle');
    const maskInput = document.createElement('input');
    maskInput.type = 'checkbox';
    maskInput.dataset.testid = 'dataset-cover-test-palette-mask-enabled';
    const maskText = document.createTextNode(copy.maskEnabled);
    maskLabel.append(maskInput, maskText);

    const coverVisibilityLabel = document.createElement('label');
    coverVisibilityLabel.classList.add('dataset-cover-test-palette__toggle');
    const coverVisibilityInput = document.createElement('input');
    coverVisibilityInput.type = 'checkbox';
    coverVisibilityInput.dataset.testid = 'dataset-cover-test-palette-cover-visible';
    const coverVisibilityText = document.createTextNode(copy.coverVisible);
    coverVisibilityLabel.append(coverVisibilityInput, coverVisibilityText);

    const themeToolboxes = document.createElement('section');
    themeToolboxes.classList.add('dataset-cover-test-palette__toolboxes');
    themeToolboxes.dataset.testid = 'dataset-cover-test-palette-theme-controls';
    const sharedToolboxes = document.createElement('section');
    sharedToolboxes.classList.add('dataset-cover-test-palette__toolboxes');
    sharedToolboxes.dataset.testid = 'dataset-cover-test-palette-shared-controls';
    const toolboxByGroup = new Map();
    ['themeImage', 'ovalGeometry', 'ovalGradient', 'heroLayout', 'cardLayout', 'articleImages', 'navigation']
        .forEach((groupName) => {
            const toolbox = createPaletteToolbox(copy[groupName], {
                iconPath: TOOLBOX_ICON_PATHS[groupName],
                storageKey: `dataset_cover_palette_section_${groupName}`,
            });
            toolboxByGroup.set(groupName, toolbox);
            const parent = ['themeImage', 'ovalGeometry', 'ovalGradient'].includes(groupName)
                ? themeToolboxes
                : sharedToolboxes;
            parent.appendChild(toolbox.toolbox);
        });
    toolboxByGroup.get('ovalGeometry').content.prepend(maskLabel);
    toolboxByGroup.get('themeImage').content.prepend(coverVisibilityLabel);
    const articleImageControl = buildArticleImageCaptionControl(copy, (value) => {
        draftSettings.dataset_cover_theme.shared.article_image_caption_position = value;
        previewDraft();
    });
    toolboxByGroup.get('articleImages').toolbox.dataset.testid = 'site-article-image-palette-settings';
    toolboxByGroup.get('articleImages').controls.appendChild(articleImageControl.element);
    const cardScope = document.createElement('fieldset');
    cardScope.className = 'dataset-cover-test-palette__card-scope';
    cardScope.dataset.testid = 'site-card-palette-settings';
    const cardScopeLegend = document.createElement('legend');
    cardScopeLegend.textContent = copy.siteCardDefaults;
    cardScope.appendChild(cardScopeLegend);
    const datasetControl = datasetOptions.canEdit ? buildDatasetCardPaletteControl({
        datasetName, copy, requestFn: datasetOptions.requestFn, saveRequestFn: datasetOptions.saveRequestFn,
        onStatus: setStatus,
    }) : null;
    if (datasetControl) toolboxByGroup.get('cardLayout').controls.appendChild(datasetControl.element);
    toolboxByGroup.get('cardLayout').controls.appendChild(cardScope);
    const cardStyleControl = buildCardStyleControl(copy, (value) => {
        draftSettings.dataset_cover_theme.shared.card_style_variant = value;
        previewDraft();
    });
    cardScope.appendChild(cardStyleControl.element);
    const cardImageControl = buildCardImagePresentationControl(copy, (value) => {
        draftSettings.dataset_cover_theme.shared.card_image_presentation = value;
        previewDraft();
    });
    toolboxByGroup.get('cardLayout').controls.appendChild(cardImageControl.element);
    const cardFieldsControl = buildCardFieldsControl(copy, (value) => {
        draftSettings.dataset_cover_theme.shared.card_show_all_fields = value;
        previewDraft();
    });
    toolboxByGroup.get('cardLayout').controls.appendChild(cardFieldsControl.element);
    const rangeControls = RANGE_CONTROLS.map((control) => {
        const row = document.createElement('label');
        row.classList.add('dataset-cover-test-palette__range');
        const labelText = document.createElement('span');
        labelText.textContent = copy[control.label];
        const output = document.createElement('output');
        output.dataset.testid = `dataset-cover-test-palette-${control.id}-value`;
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(control.min);
        input.max = String(control.max);
        input.step = String(control.step);
        input.dataset.testid = `dataset-cover-test-palette-${control.id}`;
        input.setAttribute('aria-label', copy[control.label]);
        input.addEventListener('input', () => {
            const target = control.shared
                ? draftSettings.dataset_cover_theme.shared
                : draftSettings.dataset_cover_theme[activeTheme];
            target[control.key] = Number(input.value);
            if (!control.shared && control.key === 'image_opacity') {
                coverVisibilityInput.checked = target[control.key] > 0;
                if (target[control.key] > 0) {
                    lastVisibleImageOpacity[activeTheme] = target[control.key];
                }
            }
            output.value = renderControlValue(input.value, control.unit);
            previewDraft();
        });
        row.append(labelText, output, input);
        const hintText = control.hint ? document.createElement('small') : null;
        if (hintText) {
            hintText.textContent = copy[control.hint];
            hintText.style.gridColumn = '1 / -1';
            input.setAttribute('aria-description', copy[control.hint]);
            row.appendChild(hintText);
        }
        const controlParent = control.key === 'card_detail_columns'
            ? cardScope : toolboxByGroup.get(control.group).controls;
        controlParent.appendChild(row);
        return { ...control, input, output, labelText, hintText };
    });

    const brandColorLabel = document.createElement('label');
    brandColorLabel.classList.add('dataset-cover-test-palette__color');
    const brandColorText = document.createElement('span');
    brandColorText.textContent = copy.brandColor;
    const brandColorInput = document.createElement('input');
    brandColorInput.type = 'color';
    brandColorInput.dataset.testid = 'dataset-cover-test-palette-brand-color';
    brandColorInput.setAttribute('aria-label', copy.brandColor);
    brandColorInput.addEventListener('input', () => {
        draftSettings.dataset_cover_theme.shared.brand_color = brandColorInput.value;
        previewDraft();
    });
    brandColorLabel.append(brandColorText, brandColorInput);
    toolboxByGroup.get('navigation').content.appendChild(brandColorLabel);

    const actions = document.createElement('div');
    actions.classList.add('dataset-cover-test-palette__actions');
    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.classList.add('dataset-cover-test-palette__reset', 'fw-btn');
    resetButton.dataset.testid = 'dataset-cover-test-palette-reset';
    resetButton.textContent = copy.reset;
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.classList.add('dataset-cover-test-palette__save', 'fw-btn');
    saveButton.dataset.testid = 'dataset-cover-test-palette-save';
    saveButton.textContent = copy.save;
    actions.append(resetButton, saveButton);

    function setStatus(key) {
        statusKey = key;
        statusToast?.dismiss({ immediate: true });
        statusToast = null;
        statusMessage = null;
        if (!key) return;
        statusMessage = document.createElement('span');
        statusMessage.textContent = getCopy()[key];
        statusToast = showToast({
            content: statusMessage,
            level: ['saved', 'datasetSaved'].includes(key) ? 'success' : ['saveFailed', 'datasetSaveFailed'].includes(key) ? 'error' : 'info',
            autoClose: !['saving', 'datasetSaving'].includes(key),
        });
    }

    // Update text nodes in place so switching language never rebuilds or saves a draft.
    function syncCopy() {
        copy = getCopy();
        button.title = copy.button;
        button.setAttribute('aria-label', copy.button);
        heading.textContent = copy.title;
        closeButton.title = copy.close;
        closeButton.setAttribute('aria-label', copy.close);
        notice.textContent = copy.notice;
        tabButtons.forEach((tab) => { tab.textContent = copy[tab.dataset.theme]; });
        maskText.textContent = copy.maskEnabled;
        coverVisibilityText.textContent = copy.coverVisible;
        toolboxByGroup.forEach(({ label }, groupName) => { label.textContent = copy[groupName]; });
        rangeControls.forEach((control) => {
            control.labelText.textContent = copy[control.label];
            control.input.setAttribute('aria-label', copy[control.label]);
            if (control.hintText) {
                control.hintText.textContent = copy[control.hint];
                control.input.setAttribute('aria-description', copy[control.hint]);
            }
        });
        articleImageControl.setCopy(copy);
        cardImageControl.setCopy(copy);
        cardFieldsControl.setCopy(copy);
        cardStyleControl.setCopy(copy);
        cardScopeLegend.textContent = copy.siteCardDefaults;
        datasetControl?.setCopy(copy);
        brandColorText.textContent = copy.brandColor;
        brandColorInput.setAttribute('aria-label', copy.brandColor);
        resetButton.textContent = copy.reset;
        saveButton.textContent = copy.save;
        if (statusMessage) statusMessage.textContent = copy[statusKey];
    }

    function syncControls() {
        const theme = draftSettings.dataset_cover_theme[activeTheme];
        maskInput.checked = theme.oval_enabled;
        coverVisibilityInput.checked = Number(theme.image_opacity) > 0;
        if (coverVisibilityInput.checked) {
            lastVisibleImageOpacity[activeTheme] = Number(theme.image_opacity);
        }
        tabButtons.forEach((tab) => {
            const selected = tab.dataset.theme === activeTheme;
            tab.setAttribute('aria-selected', String(selected));
            tab.classList.toggle('is-active', selected);
        });
        rangeControls.forEach((control) => {
            const source = control.shared ? draftSettings.dataset_cover_theme.shared : theme;
            control.input.value = String(source[control.key]);
            control.output.value = renderControlValue(control.input.value, control.unit);
        });
        articleImageControl.setValue(draftSettings.dataset_cover_theme.shared.article_image_caption_position);
        cardImageControl.setValue(draftSettings.dataset_cover_theme.shared.card_image_presentation);
        cardFieldsControl.setValue(draftSettings.dataset_cover_theme.shared.card_show_all_fields);
        cardStyleControl.setValue(draftSettings.dataset_cover_theme.shared.card_style_variant);
        brandColorInput.value = draftSettings.dataset_cover_theme.shared.brand_color;
    }

    maskInput.addEventListener('change', () => {
        draftSettings.dataset_cover_theme[activeTheme].oval_enabled = maskInput.checked;
        previewDraft();
    });
    coverVisibilityInput.addEventListener('change', () => {
        const theme = draftSettings.dataset_cover_theme[activeTheme];
        const currentOpacity = Number(theme.image_opacity);
        if (!coverVisibilityInput.checked) {
            if (currentOpacity > 0) lastVisibleImageOpacity[activeTheme] = currentOpacity;
            theme.image_opacity = 0;
        } else if (!(currentOpacity > 0)) {
            theme.image_opacity = lastVisibleImageOpacity[activeTheme]
                || DEFAULT_DATASET_COVER_THEME[activeTheme].image_opacity;
        }
        previewDraft();
        syncControls();
    });
    tabButtons.forEach((tab) => tab.addEventListener('click', () => {
        activeTheme = tab.dataset.theme;
        syncControls();
    }));

    const dragControls = setupPanelDragging(panel, headingRow);
    function closePanel() {
        panel.hidden = true;
        button.setAttribute('aria-expanded', 'false');
    }
    function resetPreview() {
        draftRevision += 1;
        state.releasePreview(previewOwner);
        draftSettings = state.savedSettings();
        renderHero();
        syncControls();
        setStatus('');
        dragControls.resetGeometry();
    }
    async function saveSettings() {
        saveButton.disabled = true;
        setStatus('saving');
        const savingRevision = draftRevision;
        try {
            // Preserve a single light-theme fallback for rollback to builds that
            // predate theme-specific blur while new builds use the theme values.
            draftSettings.dataset_cover_theme.shared.image_blur =
                draftSettings.dataset_cover_theme.light.image_blur;
            const savedSettings = await state.saveSettings(draftSettings, saveRequestFn);
            if (destroyed) return;
            if (draftRevision === savingRevision) {
                state.releasePreview(previewOwner);
                draftSettings = savedSettings;
                renderHero();
                syncControls();
            }
            setStatus('saved');
        } catch (_error) {
            if (!destroyed) setStatus('saveFailed');
        } finally {
            if (!destroyed) saveButton.disabled = false;
        }
    }
    function handleDocumentPointerDown(event) {
        if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) closePanel();
    }
    function handleDocumentKeyDown(event) {
        if (event.key === 'Escape' && !panel.hidden) {
            closePanel();
            button.focus();
        }
    }

    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        panel.hidden = !panel.hidden;
        button.setAttribute('aria-expanded', String(!panel.hidden));
    });
    closeButton.addEventListener('click', closePanel);
    resetButton.addEventListener('click', resetPreview);
    saveButton.addEventListener('click', saveSettings);
    panel.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('pointerdown', handleDocumentPointerDown);
    document.addEventListener('keydown', handleDocumentKeyDown);

    panelBody.append(notice, tabs, themeToolboxes, sharedToolboxes, actions);
    panel.append(headingRow, panelBody);
    hero.appendChild(button);
    document.body.appendChild(panel);
    syncControls();
    const languageObserver = new MutationObserver(syncCopy);
    languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

    return {
        button,
        panel,
        resetPreview,
        destroy() {
            destroyed = true;
            languageObserver.disconnect();
            datasetControl?.destroy();
            setStatus('');
            state.releasePreview(previewOwner);
            dragControls.destroy();
            document.removeEventListener('pointerdown', handleDocumentPointerDown);
            document.removeEventListener('keydown', handleDocumentKeyDown);
            button.remove();
            panel.remove();
        },
    };
}

export async function mountDatasetCoverTestPalette(hero, datasetName, {
    requestFn = fetchAdminUIFeatureFlags,
    settingsRequestFn = fetchSitePresentationSettings,
    saveRequestFn = saveAdminSitePresentationSettings,
    datasetSettingsRequestFn = fetchCardVisibility,
    datasetSaveRequestFn = saveDatasetCardPresentation,
    permissionCheck = hasRoutePermission,
    canCommit = () => true,
} = {}) {
    const normalizedDatasetName = String(datasetName || '').trim();
    if (!(hero instanceof HTMLElement) || !normalizedDatasetName) return null;

    const state = getSitePresentationState(settingsRequestFn);
    await state.loadSettings();
    if (!canCommit()) return null;
    state.paint();
    applyDatasetCoverThemeConfig(hero, state.effectiveSettings().dataset_cover_theme, { applyGlobals: false });

    // Shared brand, card and background controls remain useful without a cover.
    // Access still requires both the route permission and the protected feature flag.
    if (!permissionCheck(DATASET_HEADER_CONFIG_PERMISSION)) return null;
    if (hero.querySelector('[data-testid="dataset-cover-test-palette-button"]')) return null;
    try {
        const flags = await requestFn();
        if (!canCommit() || flags?.view_admin_cover_image_test_palette !== true) return null;
    } catch (_error) {
        return null;
    }
    return buildPaletteControl(hero, normalizedDatasetName, state.savedSettings(), saveRequestFn, state, {
        requestFn: datasetSettingsRequestFn, saveRequestFn: datasetSaveRequestFn,
        canEdit: permissionCheck('/ui/admin/card_visibility'),
    });
}
