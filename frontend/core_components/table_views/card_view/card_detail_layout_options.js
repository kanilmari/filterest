// card_detail_layout_options.js
// Defines selectable card-detail layout and card-style modes for rendering and admin settings.
// Bridges persisted table metadata and concrete small-card detail/card renderers.
// Exists so legacy multiline values and current layout options normalize in one place.

export const CARD_DETAILS_LAYOUT_VALUES = Object.freeze({
    SINGLE_LINE: "single_line",
    CONDITIONAL_MULTILINE: "conditional_multiline",
    STACKED: "stacked",
    INLINE: "inline",
});

export const LEGACY_MULTILINE_CARD_DETAILS_LAYOUT = "multiline";

export const CARD_STYLE_VARIANT_VALUES = Object.freeze({
    STANDARD: "standard",
    MODERN: "modern",
});

export const CARD_DETAILS_LAYOUT_OPTIONS = Object.freeze([
    {
        value: CARD_DETAILS_LAYOUT_VALUES.SINGLE_LINE,
        label: "Single line",
    },
    {
        value: CARD_DETAILS_LAYOUT_VALUES.CONDITIONAL_MULTILINE,
        label: "Conditional multiline",
    },
    {
        value: CARD_DETAILS_LAYOUT_VALUES.STACKED,
        label: "Stacked",
    },
    {
        value: CARD_DETAILS_LAYOUT_VALUES.INLINE,
        label: "Inline",
    },
]);

export const CARD_STYLE_VARIANT_OPTIONS = Object.freeze([
    {
        value: CARD_STYLE_VARIANT_VALUES.STANDARD,
        label: "Standard",
    },
    {
        value: CARD_STYLE_VARIANT_VALUES.MODERN,
        label: "Modern",
    },
]);

export function normalizeClientCardDetailsLayout(layout) {
    const normalized = String(layout || "").trim().toLowerCase();
    if (normalized === CARD_DETAILS_LAYOUT_VALUES.SINGLE_LINE) {
        return CARD_DETAILS_LAYOUT_VALUES.SINGLE_LINE;
    }
    if (normalized === CARD_DETAILS_LAYOUT_VALUES.STACKED) {
        return CARD_DETAILS_LAYOUT_VALUES.STACKED;
    }
    if (normalized === CARD_DETAILS_LAYOUT_VALUES.INLINE) {
        return CARD_DETAILS_LAYOUT_VALUES.INLINE;
    }
    if (
        normalized === CARD_DETAILS_LAYOUT_VALUES.CONDITIONAL_MULTILINE
        || normalized === LEGACY_MULTILINE_CARD_DETAILS_LAYOUT
    ) {
        return CARD_DETAILS_LAYOUT_VALUES.CONDITIONAL_MULTILINE;
    }
    return CARD_DETAILS_LAYOUT_VALUES.CONDITIONAL_MULTILINE;
}

export function resolveKvLayoutModeForCardDetails(cardDetailsLayout) {
    const normalizedLayout = normalizeClientCardDetailsLayout(cardDetailsLayout);
    if (normalizedLayout === CARD_DETAILS_LAYOUT_VALUES.STACKED) {
        return "stacked";
    }
    if (normalizedLayout === CARD_DETAILS_LAYOUT_VALUES.INLINE) {
        return "inline";
    }
    return "conditional";
}

export function normalizeClientCardStyleVariant(variant) {
    const normalized = String(variant || "").trim().toLowerCase();
    if (normalized === CARD_STYLE_VARIANT_VALUES.MODERN) {
        return CARD_STYLE_VARIANT_VALUES.MODERN;
    }
    return CARD_STYLE_VARIANT_VALUES.STANDARD;
}
