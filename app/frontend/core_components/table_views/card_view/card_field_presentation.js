// card_field_presentation.js
// Selects non-empty card fields and updates only their mounted presentation groups.
// Bridges the public palette projection with existing card renderers without app imports.
// Preserves outer card nodes, selection and retained history while fields are re-rendered.

import { CARD_STYLE_VARIANT_VALUES, resolveClientCardStyleVariant, normalizeCardDetailColumns, normalizeClientCardStyleOverride,
    normalizeCardDetailColumnOverride, resolveCardDetailColumns }
    from './card_detail_layout_options.js';

// Owners retain only transient configuration, never DOM nodes or saved credentials.
const datasetPreviews = new Map();

function datasetCards(datasetName) {
    return [...document.querySelectorAll('.card[data-card-presentation-view="card"]')]
        .filter(card => card.dataset.datasetName === datasetName || card._table_name === datasetName);
}

function refreshDatasetCards(datasetName) {
    datasetCards(datasetName).forEach(card => card._refreshFieldPresentation?.forEach(refresh => refresh()));
}

function effectiveDatasetOverrides(card) {
    const datasetName = card.dataset.datasetName || card._table_name;
    const preview = [...datasetPreviews.values()].findLast(entry => entry.datasetName === datasetName);
    return preview?.settings || {
        card_style_variant: normalizeClientCardStyleOverride(card.dataset.cardStyleOverride),
        card_detail_columns: normalizeCardDetailColumnOverride(Number(card.dataset.cardColumnsOverride)),
    };
}

export function setDatasetCardPresentationPreview(owner, datasetName, settings) {
    datasetPreviews.delete(owner);
    datasetPreviews.set(owner, { datasetName, settings: {
        card_style_variant: normalizeClientCardStyleOverride(settings.card_style_variant),
        card_detail_columns: normalizeCardDetailColumnOverride(settings.card_detail_columns),
    } });
    refreshDatasetCards(datasetName);
}

export function releaseDatasetCardPresentationPreview(owner) {
    const entry = datasetPreviews.get(owner);
    datasetPreviews.delete(owner);
    if (entry) refreshDatasetCards(entry.datasetName);
}

/** Project a verified API response into the existing metadata cache and connected cards. */
export function applySavedDatasetCardPresentation(datasetName, settings) {
    const raw = {
        card_style_variant: normalizeClientCardStyleOverride(settings.card_style_variant),
        card_detail_columns: normalizeCardDetailColumnOverride(settings.card_detail_columns),
    };
    try {
        const key = datasetName + '_tableMeta';
        const previous = JSON.parse(localStorage.getItem(key) || '{}');
        localStorage.setItem(key, JSON.stringify({ ...previous, ...raw }));
    } catch { /* Existing cards still update if browser storage is unavailable. */ }
    datasetCards(datasetName).forEach(card => {
        for (const [attribute, value] of [['cardStyleOverride', raw.card_style_variant], ['cardColumnsOverride', raw.card_detail_columns]]) {
            if (value === null) delete card.dataset[attribute];
            else card.dataset[attribute] = String(value);
        }
    });
    refreshDatasetCards(datasetName);
}

export function cardShowsAllFields(viewKey = 'card', legacyShowAll = true) {
    return viewKey === 'card'
        ? document.documentElement.dataset.cardShowAllFields !== 'false'
        : legacyShowAll;
}

export function isEmptyCardFieldValue(value, isMultilingual = false) {
    if (value === null || value === undefined) return true;
    const text = String(value).trim();
    if (!text) return true;
    // The locale reader retains {} when a marked language map has no translations.
    // Ordinary JSON, explicit 0/false and user-authored dash/N/A remain values.
    if (isMultilingual === true && text.startsWith('{') && text.endsWith('}')) {
        try {
            const parsed = JSON.parse(text);
            return parsed !== null && !Array.isArray(parsed) && Object.keys(parsed).length === 0;
        } catch { /* Invalid JSON is visible data, not an empty field. */ }
    }
    return false;
}

export function selectCardFieldEntries(entries, showAll, dataTypes = {}) {
    return entries.filter((entry) => showAll || !isEmptyCardFieldValue(
        entry.rawValue,
        entry.isMultilingual ?? dataTypes[entry.sourceColumn || entry.dataColumn || entry.column]?.is_multilingual,
    ));
}

/** Register a caller-owned field group; no global collection retains detached cards. */
export function mountCardFieldGroup(card, parent, viewKey, render, legacyShowAll = true) {
    const marker = document.createComment('card field group');
    parent.appendChild(marker);
    let nodes = [];
    let applied;
    let cleanup;
    const refresh = () => {
        const showAll = cardShowsAllFields(viewKey, legacyShowAll);
        const overrides = effectiveDatasetOverrides(card);
        const style = viewKey === 'card'
            ? resolveClientCardStyleVariant(overrides.card_style_variant, document.documentElement.dataset.cardStyleVariant)
            : card.dataset.cardStyleVariant;
        const columns = viewKey === 'card'
            ? resolveCardDetailColumns(overrides.card_detail_columns, Number(document.documentElement.dataset.cardDetailColumns))
            : undefined;
        if (viewKey === 'card') {
            card.dataset.cardDetailColumns = String(columns);
            const list = card.parentElement?.closest('.card_container');
            if (list) list.dataset.cardDetailColumns = String(columns);
        }
        const presentation = `${showAll}:${style}:${columns}`;
        if (presentation === applied) return;
        if (viewKey === 'card') {
            card.dataset.cardStyleVariant = style;
            card.classList.toggle('card--modern', style === CARD_STYLE_VARIANT_VALUES.MODERN);
        }
        cleanup?.();
        nodes.forEach((node) => node.remove());
        const previous = new Set(parent.childNodes);
        cleanup = render(parent, showAll, style, columns);
        nodes = [...parent.childNodes].filter((node) => !previous.has(node));
        marker.before(...nodes);
        applied = presentation;
    };
    card.dataset.cardPresentationView = viewKey;
    (card._refreshFieldPresentation ||= []).push(refresh);
    refresh();
}

/** The root attribute is a projection of effective site settings, never a stored override. */
export function applyCardFieldPresentationSetting(showAll, styleVariant, detailColumns) {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.cardShowAllFields = String(showAll !== false);
    if (styleVariant !== undefined) {
        document.documentElement.dataset.cardStyleVariant = resolveClientCardStyleVariant(null, styleVariant);
    }
    if (detailColumns !== undefined) {
        document.documentElement.dataset.cardDetailColumns = String(normalizeCardDetailColumns(detailColumns));
    }
    document.querySelectorAll('.card[data-card-presentation-view="card"]').forEach((card) => {
        card._refreshFieldPresentation?.forEach((refresh) => refresh());
    });
}
