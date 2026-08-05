// table_loader_handler.js
// Loads admin-visible tables and coordinates the initial admin navigation state.
// Bridges table metadata, navigation helpers, and redirect/session state during admin tool startup.
// Exists to keep admin table-loading and first-open behavior out of generic navigation modules.

import { create_navigation_buttons } from '../../navigation/database_tree/nav_builder.js';
import {
    custom_views,
    ensure_private_custom_views_loaded,
} from '../../navigation/admin_and_user_tools/custom_view_reader.js';
import { openNavTab } from '../../navigation/main_tabs/main_tab_printer.js';
import { count_this_function } from '../../dev_tools/function_counter.js';
import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { DATASET_PREFIX, normalizePath } from '../../navigation/nav_engine/query_params.js';
import { primeDatasetAccessRegistry } from '../../navigation/nav_engine/dataset_access_registry.js';
import { setUnifiedTableState } from '../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js';
import {
    setRedirectNotice,
    clearDatasetSelectionState,
    setSelectedDataset,
    getSelectedDataset,
    setInitialQueryParams,
} from '../../state_stores/dataset_selection_saver.js';
import { parseDeepLink, resolveTableName } from './table_loader_handler_helpers.js';

/**
 * Lataa taululistan, luo navigointipainikkeet ja avaa oikean näkymän.
 * 1) Jos tullaan URL:lla /{taulu}, se voittaa kaiken muun.
 * 2) Muuten katsotaan localStorage.
 * 3) Ellei kumpikaan tuota tulosta, avataan oletustaulu.
 */
export async function load_tables(options = {}) {
    count_this_function("load_tables");
    const { forceReload = false } = options;

    try {
        // Haetaan taululista palvelimelta
        const result_from_server = await endpoint_router('fetchContentTables');
        const array_of_grouped_tables = result_from_server?.datasets || []; // esim. [{ dataset_name: 'users' }, ...]
        primeDatasetAccessRegistry(result_from_server);
        await ensure_private_custom_views_loaded();

        // Luodaan sovelluksen "näkymä"-painikkeet (await: admin_tools-puu renderöidään async)
        await create_navigation_buttons(custom_views);

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

        /* ----------------------------------------------------------
           Lopuksi avataan oikea välilehti
        ---------------------------------------------------------- */
        if (resolved_table_name) {
            // If a deep-linked row ID is present, pre-set cardView state
            // so table_refresh_unified auto-opens the big card after data loads
            if (deepLinkedRowId) {
                setUnifiedTableState(resolved_table_name, {
                    cardView: { collapsed: true, expandedId: deepLinkedRowId }
                });
            }
            // Persist initial query params for consumers (e.g., deep link filters)
            setInitialQueryParams(window.location.search || '');
            await openNavTab(resolved_table_name, {
                skipUrlUpdate: isLandingOnFrontpage || Boolean(deepLinkedRowId),
                forceReload,
            });
        }

        return result_from_server;
    } catch (error) {
        console.warn("Error in load_tables:", error);
        return null;
    }
}
