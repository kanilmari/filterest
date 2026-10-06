// label_value_layout.js
// Applies the site-wide label/value arrangement without changing field visibility or contents.
// Connects shared presentation settings, live palette previews and every pair renderer.
// One adapter keeps placement independent of card style and column metadata.

import { isExperimentalFreeLayoutAvailable } from "../../core_components/table_views/experimental_free_layout_card/experimental_free_layout_card_store.js";

// Mirrors normalizeSiteLabelValueLayout in backend/core_components/system_table_tools/site_presentation_settings.go.
export function normalizeLabelValueLayout(value) {
    return value === "inline" || value === "stacked"
        || (value === "auto" && isExperimentalFreeLayoutAvailable()) ? value : "stacked";
}

export function readSiteLabelValueLayout() {
    return normalizeLabelValueLayout(document.documentElement.dataset.labelValueLayout);
}

/** Project the saved choice or palette preview onto connected cards and articles in place. */
export function applySiteLabelValueLayoutSetting(setting) {
    const layout = normalizeLabelValueLayout(setting);
    document.documentElement.dataset.labelValueLayout = layout;
    document.querySelectorAll(".label-value-layout").forEach(container => {
        container.dataset.labelValueLayout = layout;
    });
}

/** Visibility has already been resolved by the caller; an absent label stays absent. */
export function applyLabelValueLayout(container, label, value, setting = readSiteLabelValueLayout()) {
    if (!container || !value) return false;
    container.classList.add("label-value-layout");
    container.dataset.labelValueLayout = normalizeLabelValueLayout(setting);
    container.classList.toggle("label-value-layout--value-only", !label);
    if (label) label.classList.add("label-value-layout__label");
    value.classList.add("label-value-layout__value");
    container.style.removeProperty("display");
    container.style.removeProperty("grid-template-columns");
    value.style.removeProperty("margin-left");
    value.classList.remove("kv-dropped");
    return true;
}
