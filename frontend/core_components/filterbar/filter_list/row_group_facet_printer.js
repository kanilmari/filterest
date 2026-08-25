// row_group_facet_printer.js
// Renders localized row-group facets and applies one group as a normal dataset filter.
// Bridges get-results facet metadata, unified table state, route params, and shared view refreshes.
// Exists so every dataset view gets the same safe, centered group-filter controls.

import {
    bindDatasetLanguageRenderer,
    resolveDatasetDisplayValue,
} from "../../table_views/dataset_value_localizer.js";
import {
    getUnifiedTableState,
    setUnifiedTableState,
} from "../../state_stores/table_state_store.js";
import {
    getParams,
    setParams,
    updateURL,
} from "../../navigation/nav_engine/query_params.js";

export const ROW_GROUP_FILTER_KEY = "row_group";
const SAFE_ROW_GROUP_SLUG = /^[a-z0-9][a-z0-9_-]{0,63}$/;

function normalizeFacet(facet) {
    const id = Number(facet?.id);
    const slug = String(facet?.slug || "").trim();
    const rowCount = Number(facet?.row_count);
    if (
        !Number.isSafeInteger(id)
        || id <= 0
        || !SAFE_ROW_GROUP_SLUG.test(slug)
        || !Number.isSafeInteger(rowCount)
        || rowCount <= 0
    ) {
        return null;
    }
    return {
        id,
        slug,
        title: facet?.title ?? null,
        row_count: rowCount,
    };
}

function getFacetHostId(tableName) {
    return `${tableName}_row_group_facets`;
}

function getFacetFallbackTitle(slug) {
    return slug.replaceAll("_", " ").replaceAll("-", " ");
}

export function clearRowGroupFacets(tableName) {
    document.getElementById(getFacetHostId(tableName))?.remove();
}

export async function toggleRowGroupFacet(tableName, requestedSlug) {
    const slug = String(requestedSlug || "").trim();
    if (!SAFE_ROW_GROUP_SLUG.test(slug)) {
        return false;
    }

    const currentState = getUnifiedTableState(tableName);
    const filters = { ...(currentState.filters || {}) };
    const isAlreadyActive = filters[ROW_GROUP_FILTER_KEY] === slug;
    if (isAlreadyActive) {
        delete filters[ROW_GROUP_FILTER_KEY];
    } else {
        filters[ROW_GROUP_FILTER_KEY] = slug;
    }
    setUnifiedTableState(tableName, { filters, offset: 0 });

    const params = getParams(tableName);
    delete params.offset;
    if (isAlreadyActive) {
        delete params[ROW_GROUP_FILTER_KEY];
    } else {
        params[ROW_GROUP_FILTER_KEY] = slug;
    }
    setParams(tableName, params);
    updateURL(tableName, params);

    const { refreshTableUnified } = await import(
        "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js"
    );
    const committedSearchTerm = String(params.search || "").trim();
    if (committedSearchTerm) {
        const { do_intelligent_search } = await import(
            "../text_search/dataset_search_executor.js"
        );
        await do_intelligent_search(tableName, committedSearchTerm);
        return true;
    }
    await refreshTableUnified(tableName, { skipUrlParams: true });
    return true;
}

/**
 * Renders first-page group counts below the shared result count.
 * A null or empty value deliberately removes metadata, including when cached search owns the result view.
 */
export function renderRowGroupFacets(
    tableName,
    rawFacets,
    { onToggle = toggleRowGroupFacet } = {}
) {
    clearRowGroupFacets(tableName);
    const topControls = document.getElementById(`${tableName}_card_top_controls`);
    if (!topControls || !Array.isArray(rawFacets)) {
        return null;
    }

    const facets = rawFacets.map(normalizeFacet).filter(Boolean);
    if (facets.length === 0) {
        return null;
    }

    const host = document.createElement("div");
    host.id = getFacetHostId(tableName);
    host.classList.add("row-group-facets");
    host.dataset.testid = "row-group-facets";
    host.setAttribute("role", "group");
    topControls.appendChild(host);

    bindDatasetLanguageRenderer(host, (chosenLanguage) => {
        const activeSlug = String(
            getUnifiedTableState(tableName)?.filters?.[ROW_GROUP_FILTER_KEY] || ""
        );
        host.setAttribute(
            "aria-label",
            chosenLanguage === "fi" ? "Tulosjoukon ryhmät" : "Result groups"
        );
        host.replaceChildren();

        facets.forEach((facet) => {
            const title = resolveDatasetDisplayValue(
                facet.title,
                { is_multilingual: true },
                chosenLanguage
            ) || getFacetFallbackTitle(facet.slug);
            const button = document.createElement("button");
            button.type = "button";
            button.classList.add("row-group-facet-chip");
            button.classList.toggle("row-group-facet-chip--active", facet.slug === activeSlug);
            button.dataset.rowGroupSlug = facet.slug;
            button.dataset.testid = "row-group-facet-chip";
            button.setAttribute("aria-pressed", String(facet.slug === activeSlug));
            button.setAttribute("aria-label", `${title}: ${facet.row_count}`);

            const label = document.createElement("span");
            label.classList.add("row-group-facet-chip__label");
            label.textContent = title;
            const count = document.createElement("span");
            count.classList.add("row-group-facet-chip__count");
            count.textContent = String(facet.row_count);
            count.setAttribute("aria-hidden", "true");
            button.append(label, count);
            button.addEventListener("click", async () => {
                host.setAttribute("aria-busy", "true");
                try {
                    await onToggle(tableName, facet.slug);
                } finally {
                    host.removeAttribute("aria-busy");
                }
            });
            host.appendChild(button);
        });
    });

    return host;
}
