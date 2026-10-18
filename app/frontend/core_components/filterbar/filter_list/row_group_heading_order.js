// row_group_heading_order.js
// Orders category headings using the administrator's order or first-response sums.
// Connects each persistent category card with the existing appearance projection.
// Keeps visit references local to their card and never changes server value order.
import { appearanceScopeElements } from '../../../reusable_components/appearance_scope_reader.js';

const headingKey = group => group.heading?.id ?? 0;
export const headingResultSum = group => group.values.reduce((sum, value) => sum + value.row_count, 0);

/** This is the original printer comparator, including the untitled 0/0 group. */
export function compareManualHeadings(a, b) {
    return (a.heading?.sort_order ?? 0) - (b.heading?.sort_order ?? 0)
        || (a.heading?.id ?? 0) - (b.heading?.id ?? 0);
}

/** Group without changing the server's order of values inside a heading. */
export function groupFacetsByHeading(facets) {
    const groups = new Map();
    for (const facet of facets) {
        const key = facet.heading?.id ?? null;
        if (!groups.has(key)) groups.set(key, { heading: facet.heading, values: [] });
        groups.get(key).values.push(facet);
    }
    return [...groups.values()];
}

/** Known reference headings precede arrivals; each set uses its own summed counts. */
export function orderRowGroupHeadings(groups, mode, reference) {
    if (mode !== 'result_count') return [...groups].sort(compareManualHeadings);
    const current = new Map(groups.map(group => [headingKey(group), headingResultSum(group)]));
    const sums = reference || current;
    return [...groups].sort((a, b) => {
        const aKnown = sums.has(headingKey(a)), bKnown = sums.has(headingKey(b));
        return Number(bKnown) - Number(aKnown)
            || (sums.get(headingKey(b)) ?? current.get(headingKey(b)))
                - (sums.get(headingKey(a)) ?? current.get(headingKey(a)))
            || compareManualHeadings(a, b);
    });
}

/** One instance belongs to one card. Cached renders cannot establish a reference. */
export function createRowGroupHeadingOrder() {
    // Manual retains dormant first-response sums solely for a later live switch.
    let reference = null;
    return {
        accept(groups, authoritative) {
            if (authoritative && reference === null) {
                reference = new Map(groups.map(group => [headingKey(group), headingResultSum(group)]));
            }
        },
        sort: (groups, mode) => orderRowGroupHeadings(groups, mode, reference),
    };
}

/** Appearance repaint reaches mounted cards, including live site previews, without fetching. */
export function applyRowGroupHeadingOrder(mode, surface) {
    appearanceScopeElements(surface, '.row-group-facets')
        .forEach(host => host.rowGroupCard?.setHeadingOrder(mode));
}
