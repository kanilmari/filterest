// row_geometry_helpers.js
// Pure helper functions for geometry suggestion label, field mapping, and WKT conversion.
// Between row_geometry_builder.js and plain suggestion data payloads.
// Exists to make geocoding transformations testable without DOM access.

export const GEOMETRY_FIELD_MAP = [
    "title",
    "label",
    "country_code",
    "country_name",
    "state",
    "county",
    "city",
    "district",
    "street",
    "house_number",
    "postal_code",
];

/** Maps matching suggestion fields into a plain object for downstream state updates. */
export function mapSuggestionToFields(suggestion, fieldNames) {
    if (!suggestion || !Array.isArray(fieldNames)) {
        return {};
    }

    return fieldNames.reduce((mappedFields, fieldName) => {
        if (Object.prototype.hasOwnProperty.call(suggestion, fieldName)) {
            mappedFields[fieldName] = suggestion[fieldName];
        }
        return mappedFields;
    }, {});
}

/** Converts a latitude/longitude pair into WKT POINT text when both coordinates are valid. */
export function toWKTPoint(position) {
    const lng = Number(position?.lng);
    const lat = Number(position?.lat);

    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return null;
    }

    return `POINT(${lng} ${lat})`;
}

/** Returns the most user-friendly suggestion label available. */
export function getSuggestionLabel(suggestion) {
    return suggestion?.label || suggestion?.title || "";
}
