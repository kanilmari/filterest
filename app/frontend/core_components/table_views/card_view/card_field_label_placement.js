// card_field_label_placement.js
// Decides whether a result card shows a field's name.
// Between one column's own description — its card role, its declared type and its
// visibility setting — and the card renderer that builds that field.
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
 * Whether one card field's name is visible.
 *
 * `hidden` leaves the name out; the legacy `inline` marker means the name is
 * shown without added punctuation. The column's own visibility setting decides
 * whether a name is shown at all. The shared site adapter decides placement separately.
 *
 * @param {object} field
 * @param {boolean} field.labelRequested - the column's visibility setting already said a name is shown
 * @param {string[]} [field.baseRoles] - the column's card roles, already parsed
 * @param {string} [field.dataType] - the column's declared database type
 * @returns {"hidden"|"inline"}
 */
export function resolveCardFieldLabelPlacement({
    labelRequested,
    baseRoles = [],
    dataType = "",
} = {}) {
    if (!labelRequested) return CARD_FIELD_LABEL_PLACEMENTS.HIDDEN;

    return isLongTextCardField(baseRoles, dataType)
        ? CARD_FIELD_LABEL_PLACEMENTS.HIDDEN
        : CARD_FIELD_LABEL_PLACEMENTS.INLINE;
}
