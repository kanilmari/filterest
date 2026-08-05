// view_selector_printer.js
// Renders view-selector buttons (e.g. Table, Card) and wires their click handlers.
// Bridges view-key configuration with table_refresh_unified, tab path updates, and URL parameter state.
// Exists to keep view-switching UI and state management separate from table rendering and navigation logic.
/**
 * Yhdistetty funktio, joka osaa luoda minkä tahansa joukon näkymävalintanappeja
 * samasta rakenteesta:
 *    [ { label: "...", viewKey: "..."}, ... ]
 */
import { refreshTableUnified } from "../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import { updateTabPathsForView } from "../navigation/main_tabs/main_tab_printer.js";
import { updateShowMenuButtonPosition } from "../navigation/menu_button/navbar_visibility_handler.js";
import { applyPermission, hasRoutePermission } from "../route_permission_checker.js";
import { getDefaultViewSync } from "../config_fetcher.js";
import { getSelectedDataset } from "../state_stores/dataset_selection_saver.js";
import { getUnifiedTableState, setUnifiedTableState } from "../state_stores/table_state_store.js";
import { getParams, setParams, updateURL } from "../navigation/nav_engine/query_params.js";
import { createMaskIconSpan } from "../../icons/icon_mask_builder.js";
import {
    ARTICLE_VIEW_KEY,
    DATASET_VIEW_SELECTOR_TEXT,
    getDatasetViewLangKey,
    getDatasetViewLabelFallback,
    getDatasetViewPermissionRoute,
    isDatasetViewSelectorAlias,
    resolveDatasetViewSelectionTarget,
    usesFullWidthDatasetContent,
} from "./dataset_view_registry.js";

function createViewSelectorHeading() {
    const heading = document.createElement("div");
    heading.classList.add("view-selector-heading");

    const icon = createMaskIconSpan(
        "/frontend/icons/general/view-palette-icon.svg",
        ["view-selector-heading-icon"]
    );
    icon.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.dataset.langKey = DATASET_VIEW_SELECTOR_TEXT.heading.langKey;
    label.textContent = DATASET_VIEW_SELECTOR_TEXT.heading.labelFallback;

    heading.append(icon, label);
    return heading;
}

/**
 * Luo geneerisen näkymävalitsimen, jonka sisällä on annettu joukko nappeja.
 * @param {string} tableName        Taulun nimi
 * @param {string} currentView      Nykyinen näkymäavain (esim. "normal", "table", jne.)
 * @param {Array}  buttonList       Taulukko: [ { label, viewKey }, ... ]
 * @param {Array}  extraClasses     (Valinnainen) lista lisäluokkia containeriin, esim. ["new-view-selector"]
 * @param {{includeHeading?: boolean}} options
 */
export function createGenericViewSelector(
    tableName,
    currentView,
    buttonList = [],
    extraClasses = [],
    options = {},
) {
    const container = document.createElement("div");
    container.classList.add("view-selector-buttons", ...extraClasses);
    container.dataset.tableName = tableName;
    if (options.includeHeading !== false) {
        container.appendChild(createViewSelectorHeading());
    }

    buttonList.forEach(({ label, viewKey, langKey }) => {
        const btn = createGenericViewButton(
            label,
            viewKey,
            tableName,
            currentView,
            langKey
        );
        container.appendChild(btn);
    });

    return container;
}

function getRowId(row) {
    return row?.id ?? null;
}

function getFirstRenderableSearchRowId(searchResult) {
    const rows = Array.isArray(searchResult?.data) ? searchResult.data : [];
    const firstRow = rows.find((row) => getRowId(row) != null) || rows[0] || null;
    return getRowId(firstRow);
}

function rememberDatasetViewUrlState(tableName, viewKey, { pushUrl = true, replace = false } = {}) {
    const params = {
        ...getParams(tableName),
        view: viewKey,
    };
    if (pushUrl) {
        if (replace) {
            updateURL(tableName, params, undefined, { replace: true });
        } else {
            updateURL(tableName, params);
        }
        return;
    }
    setParams(tableName, params);
}

function prepareArticleViewTarget(tableName, selectedViewKey, previousViewKey) {
    if (selectedViewKey !== ARTICLE_VIEW_KEY) {
        return null;
    }

    return (async () => {
        const committedSearchTerm = String(getParams(tableName)?.search || "").trim();
        let firstSearchRowId = null;
        if (committedSearchTerm) {
            try {
                const { getCachedSearchResultForRender } = await import(
                    "../filterbar/text_search/dataset_search_executor.js"
                );
                firstSearchRowId = getFirstRenderableSearchRowId(
                    getCachedSearchResultForRender(tableName)
                );
            } catch (error) {
                console.warn("view selector search target sync failed:", error);
            }
        }

        const currentState = getUnifiedTableState(tableName);
        if (previousViewKey) {
            rememberDatasetViewUrlState(tableName, previousViewKey, {
                pushUrl: true,
                replace: true,
            });
        }
        rememberDatasetViewUrlState(tableName, ARTICLE_VIEW_KEY, { pushUrl: false });
        setUnifiedTableState(tableName, {
            cardView: {
                ...(currentState.cardView || {}),
                collapsed: true,
                expandedId: firstSearchRowId,
                pendingAutoOpenFirstSearchResult: Boolean(committedSearchTerm) && firstSearchRowId == null,
                pendingAutoOpenFirstRenderedResult: !committedSearchTerm && firstSearchRowId == null,
            },
        });
    })();
}

/**
 * Yhdistetty nappifunktio, joka käyttää samaa logiikkaa riippumatta siitä,
 * onko kyse "normal"/"ticket"/"transposed" vai "table"/"card"/"tree".
 */
function createGenericViewButton(label, viewKey, tableName, currentView, langKey = "") {
    const btn = document.createElement("button");
    btn.textContent = label || getDatasetViewLabelFallback(viewKey);
    btn.dataset.testid = `view-btn-${viewKey}`;
    btn.dataset.tableName = tableName;
    btn.dataset.viewKey = viewKey;
    btn.dataset.langKey = langKey || getDatasetViewLangKey(viewKey);

    // Anna kaikille sama perusluokka, halutessa voi myös lisätä muita
    btn.classList.add("unified-view-button");
    btn.classList.add("fw-btn");

    // Korostus, jos tämä on valittu näkymä
    const activeViewKey = getEffectiveActiveViewKey(tableName, currentView);
    if (viewKey === activeViewKey) {
        btn.classList.add("active");
    }
    btn.setAttribute("aria-pressed", viewKey === activeViewKey ? "true" : "false");

    const defaultView = getDefaultViewSync();
    if (viewKey !== defaultView && !isDatasetViewSelectorAlias(viewKey)) {
        const route = getDatasetViewPermissionRoute(viewKey);
        if (route) {
            applyPermission(btn, route);
        }
    }

    // Klikattaessa tallennetaan localStorageen ja kutsutaan refresh
    btn.addEventListener("click", () => {

        const datasetName = tableName;
        const previousViewKey = localStorage.getItem(`${datasetName}_view`) || currentView || defaultView;
        const route = getDatasetViewPermissionRoute(viewKey);
        let nextViewKey = resolveDatasetViewSelectionTarget(viewKey);
        if (!isDatasetViewSelectorAlias(viewKey) && viewKey !== defaultView && route && !hasRoutePermission(route)) {
            nextViewKey = defaultView;
        }
        localStorage.setItem(`${datasetName}_view`, nextViewKey);
        syncActiveViewButtons(tableName, nextViewKey);
        applyViewStyling(tableName);
        const articlePreparation = prepareArticleViewTarget(tableName, viewKey, previousViewKey);
        if (articlePreparation) {
            void articlePreparation.finally(() => {
                refreshTableUnified(tableName);
            });
            return;
        }
        rememberDatasetViewUrlState(tableName, nextViewKey);
        refreshTableUnified(tableName);
    });

    return btn;
}

function isRowArticleOpenForTable(tableName) {
    return Boolean(document.querySelector(
        `#${tableName}_card_view_container .card_view_wrapper.big-card-open`
    ));
}

function getEffectiveActiveViewKey(tableName, storedViewKey) {
    return isRowArticleOpenForTable(tableName) ? ARTICLE_VIEW_KEY : storedViewKey;
}

function syncActiveViewButtons(tableName, activeViewKey) {
    if (!tableName || !activeViewKey) return;

    const effectiveActiveViewKey = getEffectiveActiveViewKey(tableName, activeViewKey);

    document.querySelectorAll(".view-selector-buttons").forEach((container) => {
        if (container.dataset.tableName !== tableName) return;

        container.querySelectorAll(".unified-view-button").forEach((button) => {
            const isActive = button.dataset.viewKey === effectiveActiveViewKey;
            button.classList.toggle("active", isActive);
            button.setAttribute("aria-pressed", isActive ? "true" : "false");
        });
    });
}

document.addEventListener("row-article-toggle", (event) => {
    const tableName = event.detail?.tableName;
    if (!tableName) return;
    const storedViewKey = localStorage.getItem(`${tableName}_view`) || "card";
    syncActiveViewButtons(tableName, storedViewKey);
});

/**
 * applyViewStyling
 * ----------------
 * - Päivittää sivun ulkoasun ja lokittaa, jos korttinäkymä on aktiivinen.
 * - Piilottaa (.hidden) sarake-näytä/piilota-checkboksit korttinäkymässä
 *        ja näyttää ne muissa näkymissä.
 */
export function applyViewStyling(table_name) {
    const bodyContent = document.querySelector(".body_content");
    const bodyWrapper = document.querySelector(".body_wrapper");

    if (!bodyContent || !bodyWrapper) return;

    /* --- Selvitä valittu taulu ja näkymäavain ---------------------- */
    const selectedTable = getSelectedDataset();
    if (selectedTable !== table_name) {
        bodyContent.style.maxWidth = "unset";
        bodyWrapper.style.display = "unset";
        updateTabPathsForView(table_name);
        updateShowMenuButtonPosition();
        return;
    }

    const datasetName = table_name;
    const storedViewKey = localStorage.getItem(`${datasetName}_view`);
    syncActiveViewButtons(table_name, storedViewKey);

    /* --- PIILOTA / NÄYTÄ sarakkeiden checkboxit ------------------- */
    document.querySelectorAll(".column-visibility-toggle").forEach((el) => {
        if (storedViewKey === "card") {
            el.classList.add("hidden");
        } else {
            el.classList.remove("hidden");
        }
    });

    /* --- Max-width-asettelu (ennallaan) --------------------------- */
    if (usesFullWidthDatasetContent(storedViewKey)) {
        bodyContent.style.maxWidth = "100%";
    } else {
        bodyContent.style.maxWidth = "2560px";
    }
    updateShowMenuButtonPosition();

    updateTabPathsForView(table_name);

}
