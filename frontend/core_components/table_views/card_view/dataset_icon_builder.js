// dataset_icon_builder.js
// Builds table-level icon SVGs for card and row article headings.
// Bridges system_db_tables.icon_key metadata from local table meta with the shared tab icon registry.
// Exists so dataset icons render consistently outside the main navigation tabs.

import { getTabIconPath } from "../../navigation/main_tabs/tab_icon_library.js";

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
    if (tableName === "system_users") {
        return "group_filled";
    }
    return undefined;
}

export function createDatasetIconElement(tableName, className = "") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("dataset_table_icon");
    if (className) {
        svg.classList.add(className);
    }
    svg.setAttribute("viewBox", "0 -960 960 960");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", getTabIconPath(resolveDatasetIconKey(tableName)));
    path.setAttribute("fill", "currentColor");
    svg.appendChild(path);

    return svg;
}
