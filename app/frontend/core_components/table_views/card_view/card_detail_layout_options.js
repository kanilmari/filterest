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

export const DEFAULT_CARD_DETAIL_COLUMNS = 2;

/** The palette count is a maximum; narrow cards select a smaller layout in CSS. */
export function normalizeCardDetailColumns(value) {
    return Number.isInteger(value) && value >= 1 && value <= 4
        ? value : DEFAULT_CARD_DETAIL_COLUMNS;
}

/** A missing dataset value inherits; it must never become an explicit default. */
export function normalizeCardDetailColumnOverride(value) {
    return Number.isInteger(value) && value >= 1 && value <= 4 ? value : null;
}

export function resolveCardDetailColumns(override, siteDefault) {
    return normalizeCardDetailColumnOverride(override) ?? normalizeCardDetailColumns(siteDefault);
}

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
        label: "Plain", labelKey: "card_style_plain", fi: "Tavallinen",
    },
    {
        value: CARD_STYLE_VARIANT_VALUES.MODERN,
        label: "Glowy", labelKey: "card_style_glowy", fi: "Hohtava",
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

/** Normalize the site-wide style; modern is the public default. */
export function normalizeClientCardStyleVariant(variant) {
    return variant === CARD_STYLE_VARIANT_VALUES.STANDARD
        ? CARD_STYLE_VARIANT_VALUES.STANDARD : CARD_STYLE_VARIANT_VALUES.MODERN;
}

/** Keep dataset inheritance separate from the two concrete rendering styles. */
export function normalizeClientCardStyleOverride(variant) {
    return Object.values(CARD_STYLE_VARIANT_VALUES).includes(variant) ? variant : null;
}

export function resolveClientCardStyleVariant(override, siteDefault) {
    return normalizeClientCardStyleOverride(override) ?? normalizeClientCardStyleVariant(siteDefault);
}
