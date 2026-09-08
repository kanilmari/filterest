// label_value_layout.js
// Applies an explicit field label/value arrangement without changing its contents.
// Connects nullable column metadata with card and article pair renderers.
// Preserves each renderer's existing layout when no new default is configured.

export function normalizeLabelValueLayout(value) {
    return ["auto", "inline", "stacked"].includes(value) ? value : null;
}

/** Apply the shared column default to an already-authorized visible field pair. */
export function applyLabelValueLayout(container, label, value, setting) {
    const layout = normalizeLabelValueLayout(setting);
    if (!layout || !container || !value) return false;
    container.classList.add("label-value-layout");
    container.dataset.labelValueLayout = layout;
    container.classList.toggle("label-value-layout--value-only", !label);
    if (label) label.classList.add("label-value-layout__label");
    value.classList.add("label-value-layout__value");
    // Older inline and measured renderers set these directly on their own DOM.
    container.style.removeProperty("display");
    container.style.removeProperty("grid-template-columns");
    value.style.removeProperty("margin-left");
    value.classList.remove("kv-dropped");
    return true;
}
