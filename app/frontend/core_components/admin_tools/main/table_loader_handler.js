// table_loader_handler.js
// Loads admin-visible tables and coordinates the initial admin navigation state.
// Bridges table metadata, navigation helpers, and redirect/session state during admin tool startup.
// Exists to keep admin table-loading and first-open behavior out of generic navigation modules.

import { isRenderableDatasetView, resolveDatasetViewSelectionTarget } from "../../table_views/dataset_view_registry.js";
import { isImageFirstViewURL, getImageFirstViewBackingView, handleImageFirstViewHistory } from "../../navigation/nav_engine/image_first_view_history.js";
import { create_navigation_buttons } from '../../navigation/database_tree/nav_builder.js';
import {
    custom_views,
    ensure_private_custom_views_loaded,
} from '../../navigation/admin_and_user_tools/custom_view_reader.js';
import { openNavTab } from '../../navigation/main_tabs/main_tab_printer.js';
import { count_this_function } from '../../dev_tools/function_counter.js';
import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { DATASET_PREFIX, normalizePath } from '../../navigation/nav_engine/query_params.js';
import { primeDatasetAccessRegistry, beginDatasetAccessRefresh, isCurrentDatasetAccessRefresh } from '../../navigation/nav_engine/dataset_access_registry.js';
import { setUnifiedTableState } from '../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js';
import { forgetOpenRow } from '../../state_stores/table_state_store.js';
import {
    forgetChosenDatasetView,
    getChosenDatasetView,
    setChosenDatasetView,
} from '../../state_stores/dataset_view_choice_saver.js';
import {
    setRedirectNotice,
    clearDatasetSelectionState,
    setSelectedDataset,
    getSelectedDataset,
} from '../../state_stores/dataset_selection_saver.js';
import { parseDeepLink, resolveTableName } from './table_loader_handler_helpers.js';

// The page's first load forgets earlier visits; later loads in the same page --
// the one after signing in -- must keep what this visit has chosen.
let earlierVisitsForgotten = false;

/**
 * A fresh page shows what its address asks for -- a row or a view -- and
 * otherwise each dataset's own default view. Nothing carries over from an
 * earlier visit in this tab: the stored view also recorded that an article had
 * been left open, so such an article reopened on every later visit whatever
 * the dataset's default said. Within a visit the stored view still carries the
 * person's current choice from one render to the next, and the address keeps
 * it across a reload.
 *
 * Only this tab's own memory is forgotten (owner decision K143). The chosen
 * views and open rows live in the tab's session storage, so a tab opened beside
 * another never erases what that tab shows, and the sorting, filters and paging
 * that every tab shares stay as they are. The view in the cached address
 * parameters needs no forgetting: it lives only in the page's memory
 * (query_params.js), so a new page starts with none.
 *
 * A reload of an open article's own address is that reading continuing: when
 * `reloadedArticle` names the row this tab had open, the article's related tab
 * and scroll position are kept (forgetOpenRow in table_state_store.js).
 *
 * @param {Iterable<string>} datasetNames
 * @param {{datasetName: string, rowId: string}|null} [reloadedArticle]
 */
function forgetViewsFromEarlierVisits(datasetNames, reloadedArticle = null) {
    if (earlierVisitsForgotten) {
        return;
    }
    earlierVisitsForgotten = true;
    for (const datasetName of datasetNames) {
        forgetChosenDatasetView(datasetName);
        forgetOpenRow(datasetName, datasetName === reloadedArticle?.datasetName ? reloadedArticle.rowId : null);
    }
}

export function resetEarlierVisitForgettingForTests() {
    earlierVisitsForgotten = false;
}

/**
 * Lataa taululistan, luo navigointipainikkeet ja avaa oikean näkymän.
 * 1) Jos tullaan URL:lla /{taulu}, se voittaa kaiken muun.
 * 2) Muuten katsotaan localStorage.
 * 3) Ellei kumpikaan tuota tulosta, avataan oletustaulu.
 */
export async function load_tables(options = {}) {
    count_this_function("load_tables");
    const { forceReload = false } = options;

    const accessGeneration = beginDatasetAccessRefresh();
    try {
        // Haetaan taululista palvelimelta
        const result_from_server = await endpoint_router('fetchContentTables');
        const array_of_grouped_tables = result_from_server?.datasets || []; // esim. [{ dataset_name: 'users' }, ...]
        if (!primeDatasetAccessRegistry(result_from_server, accessGeneration)) return null;
        await ensure_private_custom_views_loaded();
        if (!isCurrentDatasetAccessRefresh(accessGeneration)) return null;

        // Luodaan sovelluksen "näkymä"-painikkeet (await: admin_tools-puu renderöidään async)
        await create_navigation_buttons(custom_views);
        if (!isCurrentDatasetAccessRefresh(accessGeneration)) return null;

        // Koonti: kaikki taulut + custom-näkymät samaan joukkoon
        const set_of_every_table_and_view_name = new Set();
        custom_views.forEach((view) => set_of_every_table_and_view_name.add(view.name));
        array_of_grouped_tables.forEach((table) =>
            set_of_every_table_and_view_name.add(table.dataset_name)
        );

        /* ----------------------------------------------------------
           1) Tarkistetaan, tultiinko deep-linkillä /{taulu} tai /{taulu}/{id}
        ---------------------------------------------------------- */
        const current_pathname = normalizePath(window.location.pathname);
        const isLandingOnFrontpage = current_pathname === '/' || current_pathname === '';

        const deepLink = parseDeepLink(current_pathname, DATASET_PREFIX);
        let deepLinkedName = deepLink.tableName;
        let deepLinkedRowId = deepLink.rowId;

        // Validate deep-linked row ID against available tables
        if (deepLinkedRowId && deepLinkedName && !set_of_every_table_and_view_name.has(deepLinkedName)) {
            deepLinkedRowId = null;
            deepLinkedName = null;
        }

        const resolution = resolveTableName({
            deepLinkedName,
            storedName: getSelectedDataset(),
            availableNames: set_of_every_table_and_view_name,
            tables: array_of_grouped_tables,
            customViews: custom_views,
            isLandingOnFrontpage,
            tabOrder: result_from_server?.tab_order || [],
        });

        let resolved_table_name = resolution.resolvedName;

        if (resolution.deepLinkInvalid) {
            try {
                setRedirectNotice({ datasetName: deepLink.tableName, reason: 'missing' });
            } catch (storageError) {
                console.warn('dataset redirect notice storage failed', storageError);
            }
            try {
                clearDatasetSelectionState();
            } catch (storageError) {
                console.warn('dataset redirect storage cleanup failed', storageError);
            }
            if (!isLandingOnFrontpage) {
                window.history.replaceState({}, '', '/');
            }
        }

        if (resolved_table_name) {
            setSelectedDataset(resolved_table_name);
        } else if (!isLandingOnFrontpage) {
            // no-op: stored name was invalid, resolution handled it
        } else {
            clearDatasetSelectionState();
        }

        // The image-first route owns its row and never restored the ordinary
        // article's reading position, so only an ordinary article row counts.
        const opensImageFirst = Boolean(deepLinkedRowId) && isImageFirstViewURL();
        const reloadedArticle = resolved_table_name && deepLinkedRowId && !opensImageFirst
            ? { datasetName: resolved_table_name, rowId: deepLinkedRowId }
            : null;
        forgetViewsFromEarlierVisits(set_of_every_table_and_view_name, reloadedArticle);

        /* ----------------------------------------------------------
           Lopuksi avataan oikea välilehti
        ---------------------------------------------------------- */
        if (resolved_table_name) {
            // If a deep-linked row ID is present, pre-set cardView state
            // so table_refresh_unified auto-opens the big card after data loads
            if (deepLinkedRowId && !opensImageFirst) {
                setChosenDatasetView(resolved_table_name, "article_view");
                setUnifiedTableState(resolved_table_name, {
                    articleView: { collapsed: true, expandedId: deepLinkedRowId, returnView: "card" }
                });
            }
            // The image-first route owns its row. The backing dataset must not
            // also auto-open the ordinary article or overwrite the IFAV URL.
            const targetURL = window.location.href;
            const initialParams = new URLSearchParams(window.location.search);
            if (!deepLinkedRowId) {
                const requestedView = initialParams.get("view");
                const explicitView = resolveDatasetViewSelectionTarget(requestedView);
                if (requestedView && isRenderableDatasetView(explicitView)
                    && getChosenDatasetView(resolved_table_name) !== explicitView) {
                    setChosenDatasetView(resolved_table_name, explicitView);
                }
            }
            if (opensImageFirst) {
                const backingView = getImageFirstViewBackingView();
                setChosenDatasetView(resolved_table_name, backingView);
                initialParams.set("view", backingView);
            }
            const navigation = await openNavTab(resolved_table_name, {
                skipUrlUpdate: isLandingOnFrontpage || Boolean(deepLinkedRowId),
                forceReload,
                ...(opensImageFirst ? { replacementParams: Object.fromEntries(initialParams) } : {}),
            });
            if (opensImageFirst && !navigation?.abort && isCurrentDatasetAccessRefresh(accessGeneration)
                && window.location.href === targetURL) {
                await handleImageFirstViewHistory({
                    tableName: resolved_table_name, rowId: deepLinkedRowId,
                    isCurrentNavigation: () => isCurrentDatasetAccessRefresh(accessGeneration)
                        && window.location.href === targetURL,
                });
            }
        }

        return result_from_server;
    } catch (error) {
        console.warn("Error in load_tables:", error);
        return null;
    }
}
