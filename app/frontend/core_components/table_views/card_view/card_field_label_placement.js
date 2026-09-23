// card_field_label_placement.js
// Decides where a result card puts a field's name: beside the value, or not at all.
// Between one column's own description — its card role, its declared type and its
// per-column layout setting — and the card renderer that builds that field.
// Exists so the decision is read from the column and never from one row's value,
// so two rows of the same dataset can never place the same field's name differently.

/**
 * The card role whose whole purpose is the card's running text. A card shows
 * only its first couple of lines, so its name would spend one of them.
 */
const CARD_RUNNING_TEXT_ROLE = /^description\d*$/;

/**
 * Declared types that carry no length bound at all, so the column may hold a
 * paragraph. A bounded string, a number, money, a truth value, a date, a time,
 * an identifier or an enumerated value always fits beside its name.
 */
const UNBOUNDED_TEXT_DATA_TYPES = new Set(["text", "json", "jsonb", "xml"]);

/** The arrangements a column may state for itself; anything else lets the rule decide. */
const EXPLICIT_LABEL_LAYOUTS = new Set(["inline", "stacked"]);

export const CARD_FIELD_LABEL_PLACEMENTS = Object.freeze({
    HIDDEN: "hidden",
    INLINE: "inline",
    STACKED: "stacked",
});

/**
 * Whether the column holds long text on a card.
 *
 * The card role answers first, because it is the author's own statement of what
 * the field is for on a card: the running-text role is long text, and every
 * other role names a fact that belongs beside its name. Only a column that
 * states no role at all is judged by its declared type.
 *
 * @param {string[]} baseRoles - the column's card roles, already parsed
 * @param {string} dataType - the column's declared database type
 * @returns {boolean}
 */
export function isLongTextCardField(baseRoles, dataType) {
    const roles = (Array.isArray(baseRoles) ? baseRoles : [])
        .map((role) => String(role || "").trim())
        .filter(Boolean);
    if (roles.some((role) => CARD_RUNNING_TEXT_ROLE.test(role))) return true;
    if (roles.length > 0) return false;
    return UNBOUNDED_TEXT_DATA_TYPES.has(String(dataType || "").trim().toLowerCase());
}

/**
 * Where one card field's name goes.
 *
 * `hidden` leaves the name out, `inline` puts it on the same line as the value
 * with a colon between them, and `stacked` keeps it on its own line above the
 * value. The column's own visibility setting still decides whether a name is
 * shown at all, and its own layout setting is the exception that overrules the
 * long-text rule in either direction.
 *
 * @param {object} field
 * @param {boolean} field.labelRequested - the column's visibility setting already said a name is shown
 * @param {string[]} [field.baseRoles] - the column's card roles, already parsed
 * @param {string} [field.dataType] - the column's declared database type
 * @param {string|null} [field.labelValueLayout] - the column's own arrangement, when it states one
 * @returns {"hidden"|"inline"|"stacked"}
 */
export function resolveCardFieldLabelPlacement({
    labelRequested,
    baseRoles = [],
    dataType = "",
    labelValueLayout = null,
} = {}) {
    if (!labelRequested) return CARD_FIELD_LABEL_PLACEMENTS.HIDDEN;

    const stated = String(labelValueLayout || "").trim().toLowerCase();
    if (EXPLICIT_LABEL_LAYOUTS.has(stated)) return stated;

    return isLongTextCardField(baseRoles, dataType)
        ? CARD_FIELD_LABEL_PLACEMENTS.HIDDEN
        : CARD_FIELD_LABEL_PLACEMENTS.INLINE;
}
