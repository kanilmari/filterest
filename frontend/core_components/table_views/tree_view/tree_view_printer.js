// tree_view_printer.js
// Renders dataset rows into the tree-view presentation.
// Bridges fetched row data and column metadata into the reusable vanilla tree renderer.
// Exists to provide a dataset-aware tree view without embedding tree rules into generic components.

import { render_tree } from '../../../reusable_components/vanilla_tree/vanilla_tree_builder.js';
import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { getLanguageWithBrowserFallback } from '../../state_stores/lang_preference_reader.js';
import {
    bindDatasetLanguageRenderer,
    resolveDatasetDisplayValue,
} from '../dataset_value_localizer.js';

const DATABASE_CATALOG_TREE_DATASETS = new Set([
    'system_table_folders',
    'system_db_tables',
]);
const DATABASE_CATALOG_TREE_CACHE_KEY = 'full_tree_data';
const DATABASE_CATALOG_TREE_CACHE_TS_KEY = 'full_tree_data_cached_at';
const DATABASE_CATALOG_TREE_CACHE_TTL_MS = 5 * 60 * 1000;
const DATASET_TREE_LANGUAGE_RENDERERS = new WeakMap();

function shouldRenderDatabaseCatalogTree(tableName) {
    return DATABASE_CATALOG_TREE_DATASETS.has(tableName);
}

function readCachedDatabaseCatalogTreeData() {
    const rawTreeData = localStorage.getItem(DATABASE_CATALOG_TREE_CACHE_KEY);
    if (!rawTreeData) return null;

    try {
        const parsedTreeData = JSON.parse(rawTreeData);
        return Array.isArray(parsedTreeData?.nodes) ? parsedTreeData : null;
    } catch (error) {
        console.warn('tree_view_printer: failed to parse cached database catalog tree data', error);
        return null;
    }
}

function persistDatabaseCatalogTreeData(treeData) {
    if (!Array.isArray(treeData?.nodes)) return;
    localStorage.setItem(DATABASE_CATALOG_TREE_CACHE_KEY, JSON.stringify(treeData));
    localStorage.setItem(DATABASE_CATALOG_TREE_CACHE_TS_KEY, String(Date.now()));
}

function isDatabaseCatalogTreeCacheFresh() {
    const cachedAt = Number.parseInt(
        localStorage.getItem(DATABASE_CATALOG_TREE_CACHE_TS_KEY) || '',
        10
    );
    return Number.isFinite(cachedAt)
        && cachedAt > 0
        && Date.now() - cachedAt < DATABASE_CATALOG_TREE_CACHE_TTL_MS;
}

async function loadDatabaseCatalogTreeData() {
    const cachedTreeData = readCachedDatabaseCatalogTreeData();
    if (cachedTreeData?.nodes?.length && isDatabaseCatalogTreeCacheFresh()) {
        return cachedTreeData;
    }

    const fetchedTreeData = await endpoint_router('fetchTreeData');
    persistDatabaseCatalogTreeData(fetchedTreeData);
    return fetchedTreeData;
}

function createTreeRenderHost(treeViewContainer, tableName, treeKind) {
    const treeRenderHost = document.createElement('div');
    treeRenderHost.id = `${tableName}_${treeKind}_tree_render_host`;
    treeViewContainer.replaceChildren(treeRenderHost);
    return treeRenderHost;
}

function buildLocalizedDatasetTreeData(data, columnSelection, dataTypes, chosenLanguage) {
    const resolveTreeValue = (row, column) => resolveDatasetDisplayValue(
        row[column],
        dataTypes?.[column] || null,
        chosenLanguage
    ).trim();

    return data.map((row) => {
        const typeVal = columnSelection.typeColumn && row[columnSelection.typeColumn]
            ? resolveTreeValue(row, columnSelection.typeColumn)
            : '';
        const nameVal = columnSelection.nameColumn && row[columnSelection.nameColumn] != null
            ? resolveTreeValue(row, columnSelection.nameColumn)
            : String(row[columnSelection.idColumn]);
        const nodeLabel = typeVal
            ? `${typeVal.charAt(0).toUpperCase() + typeVal.slice(1)}: ${nameVal}`
            : nameVal;

        return {
            id: row[columnSelection.idColumn],
            parent_id: columnSelection.parentColumn ? row[columnSelection.parentColumn] : null,
            name: nodeLabel,
        };
    });
}

async function handleDatabaseCatalogTreeButtonClick(nodeData) {
    if (!nodeData?.table_uid && !nodeData?.is_view) return;

    if (nodeData.is_view) {
        const { loadDatabaseView } = await import('../../database_view_fetcher.js');
        history.pushState({}, '', `/${nodeData.name}`);
        await loadDatabaseView(nodeData.name);
        return;
    }

    const { handle_all_navigation } = await import('../../navigation/nav_engine/navigation_handler.js');
    await handle_all_navigation(nodeData.name, []);
}

async function renderDatabaseCatalogTree(tableName, treeViewContainer) {
    const treeRenderHost = createTreeRenderHost(treeViewContainer, tableName, 'database_catalog');

    try {
        const treeData = await loadDatabaseCatalogTreeData();
        const nodes = Array.isArray(treeData?.nodes) ? treeData.nodes : [];

        await render_tree(nodes, {
            container_id: treeRenderHost.id,
            id_suffix: `_${tableName}_database_catalog_tree`,
            render_mode: 'button',
            checkbox_mode: 'none',
            use_icons: false,
            populate_checkbox_selection: false,
            max_recursion_depth: 32,
            tree_model: 'flat',
            initial_open_level: 1,
            show_node_count: true,
            show_search: true,
            use_data_lang_key: true,
            button_action_function: handleDatabaseCatalogTreeButtonClick,
        });
    } catch (error) {
        console.warn('tree_view_printer: failed to render database catalog tree', error);
        treeRenderHost.textContent = 'Puun lataus ei onnistunut.';
    }

    return treeRenderHost;
}

export async function create_tree_view(table_name, columns, data, data_types = {}) {
    const tree_view_div = document.getElementById(`${table_name}_tree_view_container`);
    if (!tree_view_div) return null;

    if (shouldRenderDatabaseCatalogTree(table_name)) {
        return await renderDatabaseCatalogTree(table_name, tree_view_div);
    }

    const treeRenderHost = createTreeRenderHost(tree_view_div, table_name, 'dataset_row');

    let id_column = null;
    let parent_column = null;
    for (const col of columns) {
        const lower = col.toLowerCase();
        if (!id_column && lower === 'id') {
            id_column = col;
        }
        if (!parent_column && lower.startsWith('parent_')) {
            parent_column = col;
        }
    }
    if (!id_column) {
        treeRenderHost.innerHTML = '<div>Ei "id"-saraketta – ei puuta.</div>';
        return treeRenderHost;
    }

    // Etsitään name/nimi-sarake
    let name_column = null;
    const name_candidates = columns.filter(c => {
        const lower = c.toLowerCase();
        return lower.includes('name') || lower.includes('nimi');
    });
    if (name_candidates.length > 0) {
        name_column = name_candidates[0];
    }

    // Etsitään type-sarake
    let type_column = null;
    for (const col of columns) {
        if (col.toLowerCase() === 'type') {
            type_column = col;
            break;
        }
    }

    // Rakennetaan "flat"-data. Raaka rividata säilyy muuttumattomana;
    // vain puussa näkyvä tyyppi ja nimi rajataan aktiiviseen kieleen.
    const columnSelection = {
        idColumn: id_column,
        parentColumn: parent_column,
        nameColumn: name_column,
        typeColumn: type_column,
    };
    const renderConfig = {
        container_id: treeRenderHost.id,
        id_suffix: `_${table_name}_tree`,
        render_mode: 'button',
        checkbox_mode: 'none',
        use_icons: false,
        populate_checkbox_selection: false,
        max_recursion_depth: 64,
        tree_model: 'flat',
        initial_open_level: 2,
        show_node_count: true,
        show_search: true,
        use_data_lang_key: false,
        // button_action_function: (nodeData) => {
        //     // console.log("Klikkasit solmua:", nodeData);
        // }
    };
    treeRenderHost.classList.add('dataset-row-tree-language-refreshable');
    const renderChosenLanguage = (chosenLanguage) => {
        return render_tree(
            buildLocalizedDatasetTreeData(
                data,
                columnSelection,
                data_types,
                chosenLanguage
            ),
            renderConfig
        );
    };
    DATASET_TREE_LANGUAGE_RENDERERS.set(treeRenderHost, renderChosenLanguage);
    await bindDatasetLanguageRenderer(treeRenderHost, renderChosenLanguage);

    return treeRenderHost;
}

/**
 * Re-renders mounted dataset row trees from their retained raw rows.
 * Between the language selector and tree nodes already present in the document.
 * Avoids a dataset refetch while keeping every visible node on the active language.
 * @param {string} chosenLanguage
 * @param {ParentNode} root
 * @returns {Promise<number>} refreshed tree count
 */
export async function refresh_mounted_tree_view_languages(
    chosenLanguage = getLanguageWithBrowserFallback(),
    root = document
) {
    const treeHosts = root.querySelectorAll('.dataset-row-tree-language-refreshable');
    let refreshedCount = 0;
    for (const treeHost of treeHosts) {
        const renderer = DATASET_TREE_LANGUAGE_RENDERERS.get(treeHost);
        if (!renderer) continue;
        await renderer(chosenLanguage);
        refreshedCount += 1;
    }
    return refreshedCount;
}
