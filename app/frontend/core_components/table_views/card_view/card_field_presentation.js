// card_field_presentation.js
// Selects non-empty card fields and updates only their mounted presentation groups.
// Bridges the public palette projection with existing card renderers without app imports.
// Preserves outer card nodes, selection and retained history while fields are re-rendered.

import { readAppearanceAttribute, appearanceScopeElements } from '../../../reusable_components/appearance_scope_reader.js';
import { projectAppearanceAttribute, projectAppearanceClass } from '../../../reusable_components/appearance_projection_writer.js';

import { CARD_STYLE_VARIANT_VALUES, resolveClientCardStyleVariant, normalizeCardDetailColumns, normalizeClientCardStyleOverride,
    normalizeCardDetailColumnOverride, resolveCardDetailColumns }
    from './card_detail_layout_options.js';

// Legacy cards without a resolved snapshot still read their nullable projections.
function effectiveDatasetOverrides(card) {
    return card.dataset.datasetAppearanceResolved === 'true' ? {
        card_style_variant: null, card_detail_columns: null,
    } : {
        card_style_variant: normalizeClientCardStyleOverride(card.dataset.cardStyleOverride),
        card_detail_columns: normalizeCardDetailColumnOverride(Number(card.dataset.cardColumnsOverride)),
    };
}

export function cardShowsAllFields(viewKey = 'card', legacyShowAll = true, card = null) {
    return viewKey === 'card'
        ? readAppearanceAttribute(card, 'cardShowAllFields') !== 'false'
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
        const showAll = cardShowsAllFields(viewKey, legacyShowAll, card);
        const overrides = effectiveDatasetOverrides(card);
        const style = viewKey === 'card'
            ? resolveClientCardStyleVariant(overrides.card_style_variant, readAppearanceAttribute(card, 'cardStyleVariant'))
            : card.dataset.cardStyleVariant;
        const columns = viewKey === 'card'
            ? resolveCardDetailColumns(overrides.card_detail_columns, Number(readAppearanceAttribute(card, 'cardDetailColumns')))
            : undefined;
        if (viewKey === 'card') {
            projectAppearanceAttribute(card, 'cardDetailColumns', String(columns));
            const list = card.parentElement?.closest('.card_container');
            const listUID = list?.closest('[data-dataset-appearance-scope]')?.dataset.datasetAppearanceUid;
            if (list && (!listUID || listUID === card.dataset.datasetAppearanceUid)) {
                projectAppearanceAttribute(list, 'cardDetailColumns', String(columns));
            }
        }
        const presentation = `${showAll}:${style}:${columns}`;
        if (viewKey === 'card') {
            projectAppearanceAttribute(card, 'cardStyleVariant', style);
            projectAppearanceClass(card, 'card--modern', style === CARD_STYLE_VARIANT_VALUES.MODERN);
        }
        if (presentation === applied) return;
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

/** Project resolved settings only onto fields belonging to this surface. */
export function applyCardFieldPresentationSetting(showAll, styleVariant, detailColumns, scope = document.documentElement) {
    if (typeof document === 'undefined') return;
    projectAppearanceAttribute(scope, 'cardShowAllFields', String(showAll !== false));
    if (styleVariant !== undefined) {
        projectAppearanceAttribute(scope, 'cardStyleVariant', resolveClientCardStyleVariant(null, styleVariant));
    }
    if (detailColumns !== undefined) {
        projectAppearanceAttribute(scope, 'cardDetailColumns', String(normalizeCardDetailColumns(detailColumns)));
    }
    appearanceScopeElements(scope, '.card[data-card-presentation-view="card"]').forEach((card) => {
        card._refreshFieldPresentation?.forEach((refresh) => refresh());
    });
}
