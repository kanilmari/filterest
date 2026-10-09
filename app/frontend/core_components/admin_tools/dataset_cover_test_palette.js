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
import { hasRoutePermission } from '../route_permission_checker.js';
import { DATASET_COVER_PALETTE_COPY as COPY } from './dataset_cover_palette_copy.js';
import { buildDatasetCardPaletteControl, buildCardStyleControl } from './dataset_card_palette_control.js';
import { buildLabelValueLayoutControl } from './site_label_value_layout_control.js';
import { buildCardImagePresentationControl } from './dataset_cover_card_image_control.js';
import { buildActiveFilterRemoveSideControl } from './active_filter_remove_side_control.js';
import { buildArticleImageCaptionControl } from './site_article_image_control.js';
import {
    DEFAULT_DATASET_COVER_THEME, isValidThemeConfig, applySitePresentationGlobals,
    getSitePresentationState,
} from './site_presentation_state.js';
import { datasetAppearanceField, deriveDatasetAppearanceCompatibilityValues } from '../../shared/dataset_appearance/validator.js';
export { DEFAULT_DATASET_COVER_THEME } from './site_presentation_state.js';

const DATASET_HEADER_CONFIG_PERMISSION = '/ui/admin/dataset_header_config';
const PALETTE_ICON_PATH = '/frontend/icons/general/view-palette-icon.svg';
import { createPresentationPaletteShell, createPaletteDraftOwner, createPaletteRangeControl,
    createPaletteToolbox, getPaletteCopy, renderControlValue } from './presentation_palette_shell.js';
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

function buildPaletteControl(hero, datasetName, initialSettings, saveRequestFn, state, datasetOptions) {
    let copy = getCopy();
    let activeTheme = 'light';
    const draftOwner = createPaletteDraftOwner({ state, render: renderHero, syncControls,
        setStatus: key => shell.setStatus(key), resetGeometry: () => shell.resetGeometry(), saveRequestFn,
        prepareSave: draft => {
            // Keep the rollback fallback equal to the light-theme blur.
            deriveDatasetAppearanceCompatibilityValues(draft.dataset_cover_theme);
        },
    });
    function renderHero() {
        applyDatasetCoverThemeConfig(hero, state.effectiveSettings().dataset_cover_theme, { applyGlobals: false });
    }
    const previewDraft = draftOwner.previewDraft;
    const setStatus = key => shell.setStatus(key);
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

    const shell = createPresentationPaletteShell({ button, prefix: 'dataset-cover-test-palette',
        getCopy, onCopy: syncCopy, onReset: draftOwner.resetPreview, onSave: draftOwner.saveSettings });
    const { panel, body: panelBody, actions } = shell;
    panel.dataset.datasetName = datasetName;

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
    ['backgroundCover', 'cardLayout', 'articleImages', 'datasetHeader', 'navigation']
        .forEach((groupName) => {
            const toolbox = createPaletteToolbox(copy[groupName], {
                iconPath: TOOLBOX_ICON_PATHS[groupName],
                storageKey: `dataset_cover_palette_section_${groupName}`,
            });
            toolboxByGroup.set(groupName, toolbox);
            const parent = groupName === 'backgroundCover'
                ? themeToolboxes
                : sharedToolboxes;
            parent.appendChild(toolbox.toolbox);
        });
    const imageScopes = new Map(['backgroundImage', 'coverImage'].map((name) => {
        const fieldset = document.createElement('fieldset');
        fieldset.className = 'dataset-cover-test-palette__card-scope';
        fieldset.dataset.testid = `dataset-cover-test-palette-${name}`;
        const legend = document.createElement('legend');
        legend.textContent = copy[name];
        fieldset.appendChild(legend);
        toolboxByGroup.get('backgroundCover').controls.appendChild(fieldset);
        return [name, { fieldset, legend }];
    }));
    imageScopes.get('coverImage').fieldset.append(coverVisibilityLabel, maskLabel);
    const removeSideControl = buildActiveFilterRemoveSideControl(copy, (value) => {
        draftOwner.draft.dataset_cover_theme.shared.active_filter_remove_side = value;
        previewDraft();
    });
    toolboxByGroup.get('datasetHeader').controls.appendChild(removeSideControl.element);
    const articleImageControl = buildArticleImageCaptionControl(copy, (value) => {
        draftOwner.draft.dataset_cover_theme.shared.article_image_caption_position = value;
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
        draftOwner.draft.dataset_cover_theme.shared.card_style_variant = value;
        previewDraft();
    });
    cardScope.appendChild(cardStyleControl.element);
    const labelValueLayoutControl = buildLabelValueLayoutControl((value) => {
        draftOwner.draft.dataset_cover_theme.shared.label_value_layout = value;
        previewDraft();
    });
    cardScope.appendChild(labelValueLayoutControl.element);
    const cardImageControl = buildCardImagePresentationControl(copy, (value) => {
        draftOwner.draft.dataset_cover_theme.shared.card_image_presentation = value;
        previewDraft();
    });
    toolboxByGroup.get('cardLayout').controls.appendChild(cardImageControl.element);
    const cardFieldsControl = buildCardFieldsControl(copy, (value) => {
        draftOwner.draft.dataset_cover_theme.shared.card_show_all_fields = value;
        previewDraft();
    });
    toolboxByGroup.get('cardLayout').controls.appendChild(cardFieldsControl.element);
    const rangeControls = RANGE_CONTROLS.map((control) => {
        const range = createPaletteRangeControl(control, copy, { prefix: 'dataset-cover-test-palette',
            onChange(value) {
                const target = control.shared ? draftOwner.draft.dataset_cover_theme.shared
                    : draftOwner.draft.dataset_cover_theme[activeTheme];
                target[control.key] = value;
                if (!control.shared && control.key === 'image_opacity') {
                    coverVisibilityInput.checked = value > 0;
                    if (value > 0) lastVisibleImageOpacity[activeTheme] = value;
                }
                previewDraft();
            },
        });
        const controlParent = control.key === 'card_detail_columns'
            ? cardScope : imageScopes.get(control.group)?.fieldset || toolboxByGroup.get(control.group).controls;
        controlParent.appendChild(range.element);
        return range;
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
        draftOwner.draft.dataset_cover_theme.shared.brand_color = brandColorInput.value;
        previewDraft();
    });
    brandColorLabel.append(brandColorText, brandColorInput);
    toolboxByGroup.get('navigation').content.appendChild(brandColorLabel);

    // Update text nodes in place so switching language never rebuilds or saves a draft.
    function syncCopy() {
        copy = getCopy();
        tabButtons.forEach((tab) => { tab.textContent = copy[tab.dataset.theme]; });
        maskText.textContent = copy.maskEnabled;
        coverVisibilityText.textContent = copy.coverVisible;
        toolboxByGroup.forEach(({ label }, groupName) => { label.textContent = copy[groupName]; });
        imageScopes.forEach(({ legend }, name) => { legend.textContent = copy[name]; });
        rangeControls.forEach((control) => {
            control.labelText.textContent = copy[control.label];
            control.input.setAttribute('aria-label', copy[control.label]);
            if (control.hintText) {
                control.hintText.textContent = copy[control.hint];
                control.input.setAttribute('aria-description', copy[control.hint]);
            }
        });
        removeSideControl.setCopy(copy);
        articleImageControl.setCopy(copy);
        cardImageControl.setCopy(copy);
        cardFieldsControl.setCopy(copy);
        cardStyleControl.setCopy(copy);
        labelValueLayoutControl.setCopy();
        cardScopeLegend.textContent = copy.siteCardDefaults;
        datasetControl?.setCopy(copy);
        brandColorText.textContent = copy.brandColor;
        brandColorInput.setAttribute('aria-label', copy.brandColor);

    }

    function syncControls() {
        const theme = draftOwner.draft.dataset_cover_theme[activeTheme];
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
            const source = control.shared ? draftOwner.draft.dataset_cover_theme.shared : theme;
            control.input.value = String(source[control.key]);
            control.output.value = renderControlValue(control.input.value, control.unit);
        });
        removeSideControl.setValue(draftOwner.draft.dataset_cover_theme.shared.active_filter_remove_side);
        articleImageControl.setValue(draftOwner.draft.dataset_cover_theme.shared.article_image_caption_position);
        cardImageControl.setValue(draftOwner.draft.dataset_cover_theme.shared.card_image_presentation);
        cardFieldsControl.setValue(draftOwner.draft.dataset_cover_theme.shared.card_show_all_fields);
        cardStyleControl.setValue(draftOwner.draft.dataset_cover_theme.shared.card_style_variant);
        labelValueLayoutControl.setValue(draftOwner.draft.dataset_cover_theme.shared.label_value_layout);
        brandColorInput.value = draftOwner.draft.dataset_cover_theme.shared.brand_color;
    }

    maskInput.addEventListener('change', () => {
        draftOwner.draft.dataset_cover_theme[activeTheme].oval_enabled = maskInput.checked;
        previewDraft();
    });
    coverVisibilityInput.addEventListener('change', () => {
        const theme = draftOwner.draft.dataset_cover_theme[activeTheme];
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

    panelBody.insertBefore(tabs, actions);
    panelBody.insertBefore(themeToolboxes, actions);
    panelBody.insertBefore(sharedToolboxes, actions);
    hero.appendChild(button);
    syncControls();
    shell.syncCopy();
    return { button, panel, resetPreview: draftOwner.resetPreview,
        destroy() {
            datasetControl?.destroy();
            draftOwner.destroy();
            shell.destroy();
            button.remove();
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
