// dataset_cover_test_palette.js
// Applies public dataset-cover presentation settings and mounts their admin editor.
// Bridges the typed presentation API, theme CSS variables, and flag-gated controls.
// Exists so live visual tuning and durable saves share one validated configuration shape.

import {
    fetchAdminUIFeatureFlags,
    fetchSitePresentationSettings,
    saveAdminSitePresentationSettings,
} from '../endpoints/stable_endpoint_router.js';
import { createMaskIconSpan } from '../../icons/icon_mask_builder.js';
import { hasRoutePermission } from '../route_permission_checker.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';

const DATASET_HEADER_CONFIG_PERMISSION = '/ui/admin/dataset_header_config';
const PALETTE_ICON_PATH = '/frontend/icons/general/view-palette-icon.svg';
const TOOLBOX_CHEVRON_PATH = '/frontend/icons/general/chevron-down-icon.svg';
const TOOLBOX_ICON_PATHS = Object.freeze({
    themeImage: '/frontend/icons/symbols/image.svg',
    ovalGeometry: '/frontend/icons/symbols/ruler.svg',
    ovalGradient: '/frontend/icons/symbols/tune.svg',
    heroLayout: '/frontend/icons/symbols/layers.svg',
    cardLayout: '/frontend/icons/symbols/grid_view.svg',
    navigation: '/frontend/icons/symbols/settings.svg',
});

export const DEFAULT_DATASET_COVER_THEME = Object.freeze({
    light: Object.freeze({
        oval_enabled: true,
        oval_width: 32,
        oval_height: 67,
        oval_position_y: 56,
        center_opacity: 0.4,
        mid_opacity: 0.7,
        edge_opacity: 1,
        center_stop: 39,
        mid_stop: 55,
        edge_stop: 80,
        image_opacity: 1,
        overlay_opacity: 0,
    }),
    dark: Object.freeze({
        oval_enabled: false,
        oval_width: 32,
        oval_height: 67,
        oval_position_y: 56,
        center_opacity: 0.4,
        mid_opacity: 0.7,
        edge_opacity: 1,
        center_stop: 39,
        mid_stop: 55,
        edge_stop: 80,
        image_opacity: 0.3,
        overlay_opacity: 0,
    }),
    shared: Object.freeze({
        hero_extra_height: 40,
        hero_bottom_fade: 48,
        image_blur: 1,
        card_image_width: 300,
        active_tab_fade: 25,
        active_tab_max_opacity: 1,
        active_tab_glow_intensity: 0.3,
        active_tab_glow_width: 1.5,
        active_tab_glow_blur: 2,
        brand_color: '#1a8fe6',
    }),
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
    { id: 'image-blur', key: 'image_blur', label: 'imageBlur', css: 'image-blur', min: 0, max: 24, step: 1, unit: 'px', shared: true, group: 'heroLayout' },
    { id: 'card-image-width', key: 'card_image_width', label: 'cardImageWidth', css: 'card-image-width', min: 30, max: 600, step: 5, unit: 'px', shared: true, group: 'cardLayout' },
    { id: 'active-tab-fade', key: 'active_tab_fade', label: 'activeTabFade', css: 'active-tab-fade', min: 0, max: 100, step: 1, unit: 'px', shared: true, group: 'navigation' },
    { id: 'active-tab-max-opacity', key: 'active_tab_max_opacity', label: 'activeTabMaxOpacity', css: 'active-tab-max-opacity', min: 0, max: 1, step: 0.05, unit: '', shared: true, group: 'navigation' },
    { id: 'active-tab-glow-intensity', key: 'active_tab_glow_intensity', label: 'activeTabGlowIntensity', css: 'active-tab-glow-intensity', min: 0, max: 1, step: 0.05, unit: '', shared: true, group: 'navigation' },
    { id: 'active-tab-glow-width', key: 'active_tab_glow_width', label: 'activeTabGlowWidth', css: 'active-tab-glow-width', min: 0, max: 8, step: 0.25, unit: 'px', shared: true, group: 'navigation' },
    { id: 'active-tab-glow-blur', key: 'active_tab_glow_blur', label: 'activeTabGlowBlur', css: 'active-tab-glow-blur', min: 0, max: 12, step: 0.5, unit: 'px', shared: true, group: 'navigation' },
]);

const COPY = Object.freeze({
    en: Object.freeze({
        button: 'Open cover image palette', title: 'Cover image settings', close: 'Close cover image settings',
        notice: 'Changes preview immediately. Save stores both light and dark theme values.',
        light: 'Light', dark: 'Dark', maskEnabled: 'Use oval mask', reset: 'Reset to saved values',
        themeGroup: 'Selected theme', sharedGroup: 'Shared by both themes',
        themeImage: 'Image and overlay', ovalGeometry: 'Oval shape', ovalGradient: 'Oval gradient',
        heroLayout: 'Hero image and transition', cardLayout: 'Card layout', navigation: 'Dataset tabs',
        save: 'Save settings', saving: 'Saving…', saved: 'Settings saved.', saveFailed: 'Saving failed.',
        ovalX: 'Oval width', ovalY: 'Oval height', ovalPositionY: 'Oval vertical position',
        centerOpacity: 'Centre opacity', midOpacity: 'Mid opacity', edgeOpacity: 'Edge opacity',
        centerStop: 'Centre stop', midStop: 'Mid stop', edgeStop: 'Edge stop',
        imageOpacity: 'Whole image opacity', heroHeight: 'Hero extra height', heroBottomFade: 'Bottom fade height',
        overlayOpacity: 'Darkening overlay opacity', imageBlur: 'Whole image blur',
        cardImageWidth: 'Card image width', activeTabFade: 'Active tab fade width',
        activeTabMaxOpacity: 'Active tab edge opacity (reserved)',
        activeTabGlowIntensity: 'Active tab glow intensity', activeTabGlowWidth: 'Active tab glow width',
        activeTabGlowBlur: 'Active tab glow blur', brandColor: 'Site brand colour',
    }),
    fi: Object.freeze({
        button: 'Avaa kansikuvan paletti', title: 'Kansikuvan asetukset', close: 'Sulje kansikuvan asetukset',
        notice: 'Muutokset näkyvät heti. Tallennus säilyttää vaalean ja tumman teeman arvot.',
        light: 'Vaalea', dark: 'Tumma', maskEnabled: 'Käytä ovaalimaskia', reset: 'Palauta tallennetut arvot',
        themeGroup: 'Valittu teema', sharedGroup: 'Molemmille teemoille yhteiset',
        themeImage: 'Kuva ja tummennus', ovalGeometry: 'Ovaalin muoto', ovalGradient: 'Ovaalin liukuväri',
        heroLayout: 'Herokuva ja häivytys', cardLayout: 'Korttien asettelu', navigation: 'Dataset-välilehdet',
        save: 'Tallenna asetukset', saving: 'Tallennetaan…', saved: 'Asetukset tallennettu.', saveFailed: 'Tallennus epäonnistui.',
        ovalX: 'Ovaalin leveys', ovalY: 'Ovaalin korkeus', ovalPositionY: 'Ovaalin pystysijainti',
        centerOpacity: 'Keskustan opacity', midOpacity: 'Keskialueen opacity', edgeOpacity: 'Reunan opacity',
        centerStop: 'Keskustan stop-piste', midStop: 'Keskialueen stop-piste', edgeStop: 'Reunan stop-piste',
        imageOpacity: 'Koko kuvan opacity', heroHeight: 'Heron lisäkorkeus', heroBottomFade: 'Alahäivytyksen korkeus',
        overlayOpacity: 'Tummentavan overlayn opacity', imageBlur: 'Koko kuvan blur',
        cardImageWidth: 'Korttikuvan leveys', activeTabFade: 'Aktiivisen välilehden häivytysleveys',
        activeTabMaxOpacity: 'Aktiivisen välilehden reunaopacity (varattu)',
        activeTabGlowIntensity: 'Aktiivisen välilehden hohdon voimakkuus',
        activeTabGlowWidth: 'Aktiivisen välilehden hohdon leveys',
        activeTabGlowBlur: 'Aktiivisen välilehden hohdon sumennus', brandColor: 'Sivuston brändiväri',
    }),
});

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function getCopy() {
    const language = String(getLanguageWithBrowserFallback() || 'en').toLowerCase();
    return COPY[language] || COPY[language.split('-')[0]] || COPY.en;
}

function renderControlValue(value, unit) {
    const numericValue = Number.parseFloat(value);
    const displayValue = Number.isInteger(numericValue)
        ? String(numericValue)
        : numericValue.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return `${displayValue}${unit}`;
}

function applySiteBrandColor(documentRoot, hexColor) {
    const channels = String(hexColor).slice(1).match(/.{2}/g)?.map((part) => (
        Number.parseInt(part, 16) / 255
    ));
    if (!channels || channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
        return false;
    }
    const [red, green, blue] = channels;
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const delta = maximum - minimum;
    const lightness = (maximum + minimum) / 2;
    let hue = 0;
    if (delta > 0) {
        if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
        else if (maximum === green) hue = 60 * (((blue - red) / delta) + 2);
        else hue = 60 * (((red - green) / delta) + 4);
    }
    if (hue < 0) hue += 360;
    const saturation = delta === 0
        ? 0
        : delta / (1 - Math.abs((2 * lightness) - 1));
    documentRoot.style.setProperty('--brand-hue', String(Number(hue.toFixed(2))));
    documentRoot.style.setProperty('--brand-sat', `${Number((saturation * 100).toFixed(2))}%`);
    documentRoot.style.setProperty('--brand-light', `${Number((lightness * 100).toFixed(2))}%`);
    return true;
}

function isValidThemeConfig(config) {
    const themeKeys = ['light', 'dark'];
    const numericKeys = RANGE_CONTROLS.filter((control) => !control.shared);
    if (!config || !config.shared || !themeKeys.every((key) => config[key])) return false;
    for (const themeName of themeKeys) {
        const theme = config[themeName];
        if (typeof theme.oval_enabled !== 'boolean') return false;
        if (!numericKeys.every((control) => Number.isFinite(Number(theme[control.key])))) return false;
    }
    return RANGE_CONTROLS.filter((control) => control.shared)
        .every((control) => Number.isFinite(Number(config.shared[control.key])))
        && /^#[0-9a-f]{6}$/i.test(String(config.shared.brand_color || ''));
}

function normalizePresentationSettings(payload) {
    const datasetCoverTheme = isValidThemeConfig(payload?.dataset_cover_theme)
        ? clone(payload.dataset_cover_theme)
        : clone(DEFAULT_DATASET_COVER_THEME);
    const timestampMode = ['date_time', 'date_only'].includes(payload?.row_article_timestamp_display_mode)
        ? payload.row_article_timestamp_display_mode
        : 'date_time';
    return {
        dataset_cover_theme: datasetCoverTheme,
        row_article_timestamp_display_mode: timestampMode,
    };
}

function setThemeVariable(hero, themeName, control, value) {
    const prefix = control.shared ? '' : `${themeName}-`;
    hero.style.setProperty(`--dataset-cover-${prefix}${control.css}`, `${value}${control.unit}`);
}

export function applyDatasetCoverThemeConfig(hero, config) {
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
    const documentRoot = document.documentElement;
    documentRoot.style.setProperty('--card_image_large_width', `${config.shared.card_image_width}px`);
    documentRoot.style.setProperty('--navtab-active-fade-width', `${config.shared.active_tab_fade}px`);
    documentRoot.style.setProperty(
        '--navtab-active-max-opacity',
        String(config.shared.active_tab_max_opacity)
    );
    documentRoot.style.setProperty(
        '--navtab-active-glow-intensity',
        String(config.shared.active_tab_glow_intensity)
    );
    documentRoot.style.setProperty(
        '--navtab-active-glow-width',
        `${config.shared.active_tab_glow_width}px`
    );
    documentRoot.style.setProperty(
        '--navtab-active-glow-blur',
        `${config.shared.active_tab_glow_blur}px`
    );
    applySiteBrandColor(documentRoot, config.shared.brand_color);
    window.dispatchEvent(new Event('dataset-cover-presentation-changed'));
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
} = {}) {
    const toolbox = document.createElement('details');
    toolbox.classList.add('dataset-cover-test-palette__group');
    toolbox.open = open;
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
    return { toolbox, content, controls };
}

function buildPaletteControl(hero, datasetName, initialSettings, saveRequestFn) {
    const copy = getCopy();
    let savedSettings = clone(initialSettings);
    let draftSettings = clone(initialSettings);
    let activeTheme = 'light';
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
    maskLabel.append(maskInput, document.createTextNode(copy.maskEnabled));

    const themeToolboxes = document.createElement('section');
    themeToolboxes.classList.add('dataset-cover-test-palette__toolboxes');
    themeToolboxes.dataset.testid = 'dataset-cover-test-palette-theme-controls';
    const sharedToolboxes = document.createElement('section');
    sharedToolboxes.classList.add('dataset-cover-test-palette__toolboxes');
    sharedToolboxes.dataset.testid = 'dataset-cover-test-palette-shared-controls';
    const toolboxByGroup = new Map();
    ['themeImage', 'ovalGeometry', 'ovalGradient', 'heroLayout', 'cardLayout', 'navigation']
        .forEach((groupName, index) => {
            const toolbox = createPaletteToolbox(copy[groupName], {
                iconPath: TOOLBOX_ICON_PATHS[groupName],
                open: index < 2,
            });
            toolboxByGroup.set(groupName, toolbox);
            const parent = ['themeImage', 'ovalGeometry', 'ovalGradient'].includes(groupName)
                ? themeToolboxes
                : sharedToolboxes;
            parent.appendChild(toolbox.toolbox);
        });
    toolboxByGroup.get('ovalGeometry').content.prepend(maskLabel);
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
            output.value = renderControlValue(input.value, control.unit);
            applyDatasetCoverThemeConfig(hero, draftSettings.dataset_cover_theme);
        });
        row.append(labelText, output, input);
        toolboxByGroup.get(control.group).controls.appendChild(row);
        return { ...control, input, output };
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
        applyDatasetCoverThemeConfig(hero, draftSettings.dataset_cover_theme);
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
    const status = document.createElement('span');
    status.classList.add('dataset-cover-test-palette__status');
    status.setAttribute('role', 'status');
    status.dataset.testid = 'dataset-cover-test-palette-status';
    actions.append(resetButton, saveButton, status);

    function syncControls() {
        const theme = draftSettings.dataset_cover_theme[activeTheme];
        maskInput.checked = theme.oval_enabled;
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
        brandColorInput.value = draftSettings.dataset_cover_theme.shared.brand_color;
    }

    maskInput.addEventListener('change', () => {
        draftSettings.dataset_cover_theme[activeTheme].oval_enabled = maskInput.checked;
        applyDatasetCoverThemeConfig(hero, draftSettings.dataset_cover_theme);
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
        draftSettings = clone(savedSettings);
        applyDatasetCoverThemeConfig(hero, draftSettings.dataset_cover_theme);
        syncControls();
        status.textContent = '';
        dragControls.resetGeometry();
    }
    async function saveSettings() {
        saveButton.disabled = true;
        status.textContent = copy.saving;
        try {
            const response = await saveRequestFn(clone(draftSettings));
            savedSettings = normalizePresentationSettings(response);
            draftSettings = clone(savedSettings);
            applyDatasetCoverThemeConfig(hero, savedSettings.dataset_cover_theme);
            syncControls();
            status.textContent = copy.saved;
        } catch (_error) {
            status.textContent = copy.saveFailed;
        } finally {
            saveButton.disabled = false;
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

    return {
        button,
        panel,
        resetPreview,
        destroy() {
            resetPreview();
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
    permissionCheck = hasRoutePermission,
} = {}) {
    const normalizedDatasetName = String(datasetName || '').trim();
    if (!(hero instanceof HTMLElement) || !normalizedDatasetName
        || !hero.classList.contains('filterbar-inline-hero--has-cover')) return null;

    let settings = normalizePresentationSettings(null);
    try {
        settings = normalizePresentationSettings(await settingsRequestFn());
    } catch (_error) {
        // Canonical in-source defaults keep the public hero usable during a transient API failure.
    }
    applyDatasetCoverThemeConfig(hero, settings.dataset_cover_theme);

    if (!permissionCheck(DATASET_HEADER_CONFIG_PERMISSION)) return null;
    if (hero.querySelector('[data-testid="dataset-cover-test-palette-button"]')) return null;
    try {
        const flags = await requestFn();
        if (flags?.view_admin_cover_image_test_palette !== true) return null;
    } catch (_error) {
        return null;
    }
    return buildPaletteControl(hero, normalizedDatasetName, settings, saveRequestFn);
}
