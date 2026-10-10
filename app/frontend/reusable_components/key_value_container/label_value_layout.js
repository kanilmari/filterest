// label_value_layout.js
// Applies the site-wide label/value arrangement without changing field visibility or contents.
// Connects shared presentation settings, live palette previews and result-card pair renderers.
// One adapter keeps placement independent of card style and column metadata.

import { readAppearanceAttribute, appearanceScopeElements } from '../appearance_scope_reader.js';
import { projectAppearanceAttribute } from '../appearance_projection_writer.js';

import { isExperimentalFreeLayoutAvailable } from "../../core_components/table_views/experimental_free_layout_card/experimental_free_layout_card_store.js";

// Mirrors normalizeSiteLabelValueLayout in backend/core_components/system_table_tools/site_presentation_validator.go.
export function normalizeLabelValueLayout(value) {
    return value === "inline" || value === "stacked"
        || (value === "auto" && isExperimentalFreeLayoutAvailable()) ? value : "stacked";
}

export function readSiteLabelValueLayout(element = null) {
    return normalizeLabelValueLayout(readAppearanceAttribute(element, 'labelValueLayout'));
}

/** Project the saved choice or palette preview onto connected card pairs in place. */
export function applySiteLabelValueLayoutSetting(setting, scope = document.documentElement) {
    const layout = normalizeLabelValueLayout(setting);
    projectAppearanceAttribute(scope, 'labelValueLayout', layout);
    appearanceScopeElements(scope, ".label-value-layout").forEach(container => {
        projectAppearanceAttribute(container, 'labelValueLayout', layout);
    });
}

/** Visibility has already been resolved by the caller; an absent label stays absent. */
export function applyLabelValueLayout(container, label, value, setting = readSiteLabelValueLayout(container)) {
    if (!container || !value) return false;
    container.classList.add("label-value-layout");
    projectAppearanceAttribute(container, 'labelValueLayout', normalizeLabelValueLayout(setting));
    container.classList.toggle("label-value-layout--value-only", !label);
    if (label) label.classList.add("label-value-layout__label");
    value.classList.add("label-value-layout__value");
    container.style.removeProperty("display");
    container.style.removeProperty("grid-template-columns");
    value.style.removeProperty("margin-left");
    value.classList.remove("kv-dropped");
    return true;
}
