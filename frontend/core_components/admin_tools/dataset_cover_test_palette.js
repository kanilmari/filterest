// dataset_cover_test_palette.js
// Mounts an admin-only, flag-gated live preview palette beside a dataset hero.
// Bridges the protected UI-feature flag, hero CSS variables, and ephemeral controls.
// Exists so cover-mask values can be explored without persisting drafts or changing routes.

import { fetchAdminUIFeatureFlags } from '../endpoints/stable_endpoint_router.js';
import { createMaskIconSpan } from '../../icons/icon_mask_builder.js';
import { hasRoutePermission } from '../route_permission_checker.js';
import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';

const DATASET_HEADER_CONFIG_PERMISSION = '/ui/admin/dataset_header_config';
const PALETTE_ICON_PATH = '/frontend/icons/general/view-palette-icon.svg';
const MASK_OVERRIDE_VARIABLE = '--dataset-cover-mask-image';

const RANGE_CONTROLS = Object.freeze([
    {
        id: 'oval-x',
        label: 'ovalX',
        variable: '--dataset-cover-mask-oval-x',
        min: 20,
        max: 140,
        step: 1,
        value: 68,
        unit: '%',
    },
    {
        id: 'oval-y',
        label: 'ovalY',
        variable: '--dataset-cover-mask-oval-y',
        min: 20,
        max: 140,
        step: 1,
        value: 82,
        unit: '%',
    },
    {
        id: 'center-opacity',
        label: 'centerOpacity',
        variable: '--dataset-cover-mask-center-opacity',
        min: 0,
        max: 1,
        step: 0.05,
        value: 0.2,
        unit: '',
    },
    {
        id: 'mid-opacity',
        label: 'midOpacity',
        variable: '--dataset-cover-mask-mid-opacity',
        min: 0,
        max: 1,
        step: 0.05,
        value: 0.45,
        unit: '',
    },
    {
        id: 'edge-opacity',
        label: 'edgeOpacity',
        variable: '--dataset-cover-mask-edge-opacity',
        min: 0,
        max: 1,
        step: 0.05,
        value: 0.7,
        unit: '',
    },
    {
        id: 'center-stop',
        label: 'centerStop',
        variable: '--dataset-cover-mask-center-stop',
        min: 0,
        max: 100,
        step: 1,
        value: 30,
        unit: '%',
    },
    {
        id: 'mid-stop',
        label: 'midStop',
        variable: '--dataset-cover-mask-mid-stop',
        min: 0,
        max: 100,
        step: 1,
        value: 58,
        unit: '%',
    },
    {
        id: 'edge-stop',
        label: 'edgeStop',
        variable: '--dataset-cover-mask-edge-stop',
        min: 0,
        max: 100,
        step: 1,
        value: 100,
        unit: '%',
    },
    {
        id: 'image-opacity',
        label: 'imageOpacity',
        variable: '--dataset-cover-image-opacity',
        min: 0,
        max: 1,
        step: 0.05,
        value: 1,
        unit: '',
    },
    {
        id: 'overlay-opacity',
        label: 'overlayOpacity',
        variable: '--dataset-cover-overlay-opacity',
        min: 0,
        max: 1,
        step: 0.05,
        value: 1,
        unit: '',
    },
    {
        id: 'image-blur',
        label: 'imageBlur',
        variable: '--dataset-cover-image-blur',
        min: 0,
        max: 24,
        step: 1,
        value: 0,
        unit: 'px',
    },
]);

const COPY = Object.freeze({
    en: Object.freeze({
        button: 'Open cover image test palette',
        title: 'Cover image live preview',
        close: 'Close preview controls',
        notice: 'Browser preview only. Reset or refresh the page to restore default values.',
        maskEnabled: 'Use oval mask',
        reset: 'Reset preview',
        ovalX: 'Oval width',
        ovalY: 'Oval height',
        centerOpacity: 'Centre opacity',
        midOpacity: 'Mid opacity',
        edgeOpacity: 'Edge opacity',
        centerStop: 'Centre stop',
        midStop: 'Mid stop',
        edgeStop: 'Edge stop',
        imageOpacity: 'Whole image opacity',
        overlayOpacity: 'Darkening overlay opacity',
        imageBlur: 'Whole image blur',
    }),
    fi: Object.freeze({
        button: 'Avaa kansikuvan testipaletti',
        title: 'Kansikuvan live-esikatselu',
        close: 'Sulje esikatselusäätimet',
        notice: 'Vain selainesikatselu. Palautus tai sivun päivitys palauttaa oletusarvot.',
        maskEnabled: 'Käytä ovaalimaskia',
        reset: 'Palauta esikatselu',
        ovalX: 'Ovaalin leveys',
        ovalY: 'Ovaalin korkeus',
        centerOpacity: 'Keskustan opacity',
        midOpacity: 'Keskialueen opacity',
        edgeOpacity: 'Reunan opacity',
        centerStop: 'Keskustan stop-piste',
        midStop: 'Keskialueen stop-piste',
        edgeStop: 'Reunan stop-piste',
        imageOpacity: 'Koko kuvan opacity',
        overlayOpacity: 'Tummentavan overlayn opacity',
        imageBlur: 'Koko kuvan blur',
    }),
});

function getCopy() {
    const language = String(getLanguageWithBrowserFallback() || 'en').toLowerCase();
    return COPY[language] || COPY[language.split('-')[0]] || COPY.en;
}

function readInitialControlValue(hero, control) {
    const computedValue = getComputedStyle(hero)
        .getPropertyValue(control.variable)
        .trim();
    const parsedValue = Number.parseFloat(computedValue);
    if (
        Number.isFinite(parsedValue)
        && computedValue.endsWith('%')
        && control.unit === ''
        && control.max === 1
    ) {
        return parsedValue / 100;
    }
    return Number.isFinite(parsedValue) ? parsedValue : control.value;
}

function renderControlValue(value, unit) {
    const numericValue = Number.parseFloat(value);
    const displayValue = Number.isInteger(numericValue)
        ? String(numericValue)
        : numericValue.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return `${displayValue}${unit}`;
}

function createRangeControl(hero, control, copy, originalValues) {
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
    input.value = String(readInitialControlValue(hero, control));
    input.dataset.testid = `dataset-cover-test-palette-${control.id}`;
    input.setAttribute('aria-label', copy[control.label]);

    const updatePreview = () => {
        hero.style.setProperty(control.variable, `${input.value}${control.unit}`);
        output.value = renderControlValue(input.value, control.unit);
    };
    output.value = renderControlValue(input.value, control.unit);
    input.addEventListener('input', updatePreview);

    originalValues.set(control.variable, hero.style.getPropertyValue(control.variable));
    row.append(labelText, output, input);
    return { row, input, output };
}

function restoreInlineVariable(hero, variable, originalValue) {
    if (originalValue) {
        hero.style.setProperty(variable, originalValue);
        return;
    }
    hero.style.removeProperty(variable);
}

function buildPaletteControl(hero, datasetName) {
    const copy = getCopy();
    const originalValues = new Map();
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.add('filterbar-inline-hero__cover-palette-button', 'fw-btn');
    button.dataset.testid = 'dataset-cover-test-palette-button';
    button.title = copy.button;
    button.setAttribute('aria-label', copy.button);
    button.setAttribute('aria-expanded', 'false');
    button.appendChild(createMaskIconSpan(
        PALETTE_ICON_PATH,
        'filterbar-inline-hero__cover-palette-icon'
    ));

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

    const maskLabel = document.createElement('label');
    maskLabel.classList.add('dataset-cover-test-palette__toggle');
    const maskInput = document.createElement('input');
    maskInput.type = 'checkbox';
    maskInput.checked = hero.style.getPropertyValue(MASK_OVERRIDE_VARIABLE) !== 'none';
    maskInput.dataset.testid = 'dataset-cover-test-palette-mask-enabled';
    maskLabel.append(maskInput, document.createTextNode(copy.maskEnabled));
    originalValues.set(
        MASK_OVERRIDE_VARIABLE,
        hero.style.getPropertyValue(MASK_OVERRIDE_VARIABLE)
    );
    maskInput.addEventListener('change', () => {
        if (maskInput.checked) {
            hero.style.removeProperty(MASK_OVERRIDE_VARIABLE);
            return;
        }
        hero.style.setProperty(MASK_OVERRIDE_VARIABLE, 'none');
    });

    const controlGrid = document.createElement('div');
    controlGrid.classList.add('dataset-cover-test-palette__controls');
    const rangeControls = RANGE_CONTROLS.map((control) => {
        const elements = createRangeControl(hero, control, copy, originalValues);
        controlGrid.appendChild(elements.row);
        return { ...control, ...elements };
    });

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.classList.add('dataset-cover-test-palette__reset', 'fw-btn');
    resetButton.dataset.testid = 'dataset-cover-test-palette-reset';
    resetButton.textContent = copy.reset;

    function closePanel() {
        panel.hidden = true;
        button.setAttribute('aria-expanded', 'false');
    }

    function handleDocumentPointerDown(event) {
        if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) {
            closePanel();
        }
    }

    function handleDocumentKeyDown(event) {
        if (event.key === 'Escape' && !panel.hidden) {
            closePanel();
            button.focus();
        }
    }

    function resetPreview() {
        restoreInlineVariable(
            hero,
            MASK_OVERRIDE_VARIABLE,
            originalValues.get(MASK_OVERRIDE_VARIABLE)
        );
        maskInput.checked = originalValues.get(MASK_OVERRIDE_VARIABLE) !== 'none';
        rangeControls.forEach((control) => {
            restoreInlineVariable(hero, control.variable, originalValues.get(control.variable));
            control.input.value = String(readInitialControlValue(hero, control));
            control.output.value = renderControlValue(control.input.value, control.unit);
        });
    }

    button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        panel.hidden = !panel.hidden;
        button.setAttribute('aria-expanded', String(!panel.hidden));
    });
    closeButton.addEventListener('click', closePanel);
    resetButton.addEventListener('click', resetPreview);
    panel.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('pointerdown', handleDocumentPointerDown);
    document.addEventListener('keydown', handleDocumentKeyDown);

    panel.append(headingRow, notice, maskLabel, controlGrid, resetButton);
    hero.append(button, panel);

    return {
        button,
        panel,
        resetPreview,
        destroy() {
            resetPreview();
            document.removeEventListener('pointerdown', handleDocumentPointerDown);
            document.removeEventListener('keydown', handleDocumentKeyDown);
            button.remove();
            panel.remove();
        },
    };
}

export async function mountDatasetCoverTestPalette(hero, datasetName, {
    requestFn = fetchAdminUIFeatureFlags,
    permissionCheck = hasRoutePermission,
} = {}) {
    const normalizedDatasetName = String(datasetName || '').trim();
    if (
        !(hero instanceof HTMLElement)
        || !normalizedDatasetName
        || !hero.classList.contains('filterbar-inline-hero--has-cover')
        || !permissionCheck(DATASET_HEADER_CONFIG_PERMISSION)
    ) {
        return null;
    }
    const existingButton = hero.querySelector(
        '[data-testid="dataset-cover-test-palette-button"]'
    );
    if (existingButton) {
        return null;
    }

    let flags;
    try {
        flags = await requestFn();
    } catch (_error) {
        return null;
    }
    if (flags?.view_admin_cover_image_test_palette !== true) {
        return null;
    }

    return buildPaletteControl(hero, normalizedDatasetName);
}
