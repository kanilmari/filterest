// row_group_value_order.js
// Orders dropdown values by their current result counts without changing metadata.
// Connects each category popup opening to a stable sequence of value slugs.
// Keeps administrator order for ties and appends arrivals until the next opening.
export function orderRowGroupValues(values) {
    return [...values].sort((a, b) => b.row_count - a.row_count);
}

/** One sequence belongs to one popup; refreshed counts never move known values. */
export function createRowGroupValueOrder() {
    let slugs = null;
    return {
        open(values) { slugs = orderRowGroupValues(values).map(value => value.slug); },
        close() { slugs = null; },
        sort(values) {
            if (slugs === null) return orderRowGroupValues(values);
            const known = new Set(slugs);
            slugs.push(...orderRowGroupValues(values.filter(value => !known.has(value.slug))).map(value => value.slug));
            const current = new Map(values.map(value => [value.slug, value]));
            return slugs.filter(slug => current.has(slug)).map(slug => current.get(slug));
        },
    };
}
