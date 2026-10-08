// row_group_filter_contract.js
// Canonicalizes per-heading category modes at the browser state boundary.
// Connects unified filters, URL state and the shared server category contract.
// Keeps safe heading identities and bounded preferences consistent across views.

export const ROW_GROUP_FILTER_KEY = "row_group";
export const ROW_GROUP_MODE_KEY = "row_group_mode";

// The server twin is dtt_1_row_read/row_group_facet_fetcher.go; shared examples
// live in testing/shared_contracts/row_group_mode_examples.json.
export function parseRowGroupModes(raw = "") {
    if (new TextEncoder().encode(raw).length > 512) return null;
    const modes = {};
    if (!raw.trim()) return modes;
    const tokens = raw.split(",");
    if (tokens.length > 20) return null;
    const seen = new Set();
    for (const token of tokens) {
        const match = /^(0|[1-9][0-9]*):(any|all)$/.exec(token.trim());
        if (!match || !Number.isSafeInteger(Number(match[1])) || seen.has(match[1])) return null;
        seen.add(match[1]);
        if (match[2] === "all") modes[match[1]] = "all";
    }
    return modes;
}

export function serializeRowGroupModes(modes) {
    return Object.entries(modes || {}).filter(([id, mode]) =>
        mode === "all" && /^(0|[1-9][0-9]*)$/.test(id) && Number.isSafeInteger(Number(id)))
        .sort(([a], [b]) => Number(a) - Number(b)).map(([id]) => `${id}:all`).join(",");
}
