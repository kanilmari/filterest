// dataset_default_view.js
// Resolves the one effective dataset default shared by rendering and selectors.
// Bridges current row metadata, cached row metadata and older navigation specs.
// Keeps default-view availability independent of an administrator-only tree.
import { getDefaultViewSync } from "../config_fetcher.js";
import { getAllSpecs } from "../state_stores/table_specs_reader.js";
import { isRenderableDatasetView, resolveDatasetViewSelectionTarget } from "./dataset_view_registry.js";

function readCachedTableMeta(datasetName) {
    try {
        return JSON.parse(globalThis.localStorage?.getItem(datasetName + "_tableMeta") || "null");
    } catch {
        return null;
    }
}

function renderableView(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    const view = resolveDatasetViewSelectionTarget(value.trim());
    return isRenderableDatasetView(view) ? view : null;
}

/** Current metadata wins; an explicit null means inherit the site's default. */
export function resolveDatasetDefaultView(datasetName, {
    tableMeta = readCachedTableMeta(datasetName),
    tableSpecs = getAllSpecs(),
    globalDefault = getDefaultViewSync(),
} = {}) {
    const value = tableMeta && Object.hasOwn(tableMeta, "default_view_name")
        ? tableMeta.default_view_name
        : tableSpecs?.[datasetName]?.default_view_name;
    return renderableView(value) || renderableView(globalDefault) || "card";
}
