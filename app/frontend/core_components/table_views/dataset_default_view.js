// dataset_default_view.js
// Resolves the one effective dataset default shared by rendering and selectors.
// Bridges current row metadata, cached row metadata and older navigation specs.
// Keeps default-view availability independent of an administrator-only tree.
import { getDefaultViewSync } from "../config_fetcher.js";
import { getAllSpecs } from "../state_stores/table_specs_reader.js";
import { hasRoutePermission } from "../route_permission_checker.js";
import { getDatasetViewPermissionRoute, isRenderableDatasetView, resolveDatasetViewSelectionTarget } from "./dataset_view_registry.js";
import { datasetSupportsTreeView } from "./dataset_tree_availability_checker.js";
import { datasetSupportsChartView } from "./price_chart_view/price_chart_data_reader.js";

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
    // K364: configuring the developing Chart as a default never grants access.
    // Share this fallback with selectors and direct-address rendering; other
    // views retain their established default-view availability for dataset readers.
    if (view === 'price_chart' && !hasRoutePermission(getDatasetViewPermissionRoute(view))) return null;
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

/**
 * Rendering's fallback for a view this dataset or reader cannot show: the dataset's default, the site's default,
 * then cards or a table, skipping views the rows cannot show or the reader may not open. Without rows (columns
 * and types empty) Chart and Tree never qualify. Moved here from dataset_view_printer.js so the side menu predicts
 * an unopened dataset's view with rendering's own rule (side_menu_tab_shape.js, owner 2026-11-22).
 */
export function resolveFallbackViewForUnavailableView(datasetName, tableSpecs, globalDefault, unavailableView, columns, dataTypes) {
    const defaultViewName = tableSpecs[datasetName]?.default_view_name;
    const fallbackCandidates = [defaultViewName, globalDefault, "card", "table",
        ...(unavailableView === "price_chart" ? ["normal", "transposed", "article_view", "product_card"] : [])];
    const fallbackView = fallbackCandidates.find((candidate) => (
        candidate
        && candidate !== unavailableView
        && isRenderableDatasetView(candidate)
        && (candidate !== "price_chart" || datasetSupportsChartView(columns, dataTypes))
        && (candidate !== "tree" || datasetSupportsTreeView(datasetName, columns, dataTypes))
        && (!getDatasetViewPermissionRoute(candidate) || hasRoutePermission(getDatasetViewPermissionRoute(candidate)))
    ));
    return fallbackView || "card";
}

/** A default Article view the reader may not open falls back as rendering does; other views pass unchanged. */
export function resolveArticlePermissionFallback(datasetName, view, { tableSpecs, globalDefault, columns = [], dataTypes = {} }) {
    return view === "article_view" && !hasRoutePermission("/ui/view/article_view")
        ? resolveFallbackViewForUnavailableView(datasetName, tableSpecs, globalDefault, "article_view", columns, dataTypes)
        : view;
}

/**
 * The view a dataset opens in when this page has drawn none of it yet, as far as it is known without its rows:
 * its effective default and rendering's Article permission fallback. A Map, Tree or Chart default the rows cannot
 * show falls back only when the dataset is drawn. `tableMeta` carries the catalogue's default (null inherits the
 * site's default); without it, cached row metadata and the administrator tree decide, as in rendering.
 */
export function predictDatasetOpeningView(datasetName, {
    tableMeta = readCachedTableMeta(datasetName),
    tableSpecs = getAllSpecs(),
    globalDefault = getDefaultViewSync(),
} = {}) {
    const specs = tableMeta && Object.hasOwn(tableMeta, "default_view_name")
        ? { ...tableSpecs, [datasetName]: { ...tableSpecs?.[datasetName], default_view_name: tableMeta.default_view_name } }
        : tableSpecs || {};
    const view = resolveDatasetDefaultView(datasetName, { tableMeta, tableSpecs: specs, globalDefault });
    return resolveArticlePermissionFallback(datasetName, view, { tableSpecs: specs, globalDefault });
}
