// dataset_icon_builder.js
// Builds table-level filesystem symbol icons for card and row article headings.
// Bridges system_db_tables.icon_key metadata from local table meta with the shared asset resolver.
// Exists so dataset icons render consistently outside the main navigation tabs.

import { createSymbolMaskElement } from "../../../reusable_components/symbol_asset_resolver.js";

function readTableMeta(tableName) {
    if (!tableName) {
        return {};
    }

    try {
        return JSON.parse(localStorage.getItem(`${tableName}_tableMeta`) || "{}") || {};
    } catch {
        return {};
    }
}

function resolveDatasetIconKey(tableName) {
    const iconKey = readTableMeta(tableName)?.icon_key;
    if (typeof iconKey === "string" && iconKey.trim()) {
        return iconKey.trim();
    }
    return "";
}

export function createDatasetIconElement(tableName, className = "") {
    const iconKey = resolveDatasetIconKey(tableName);
    if (!iconKey) {
        return null;
    }

    return createSymbolMaskElement(
        iconKey,
        ["dataset_table_icon", className].filter(Boolean)
    );
}
