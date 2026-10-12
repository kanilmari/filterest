// dataset_view_renderer.js
// Creates dataset renderers and commits replacement or appended listing rows.
// Connects listing loaders to the same dispatch that owns initial view construction.
// Keeps each renderer's row policy explicit without putting view branches in pagination.
import { create_table_element } from './table_view/table_structure_builder.js';
import { create_card_view, appendDataToCardView } from './card_view/card_view_printer.js';
import { appendDataToTable } from './table_view/table_row_printer.js';
import { disposeCardResources, notifyCardsMounted } from './card_view/card_resource_lifecycle.js';
import { showDatasetResultBuildFailure } from './dataset_result_build_failure.js';
import { create_article_view } from './article_view/article_view_printer.js';
import { create_tree_view } from './tree_view/tree_view_printer.js';
import { TableComponent } from './table_component_builder.js';
import { create_settings_view } from './settings_view/settings_view_printer.js';
import { create_product_card_view } from './product_card_view/product_card_view_printer.js';
import { create_calendar_view } from './calendar_view/calendar_view_printer.js';
import { create_map_view } from './map_view/map_view_printer.js';
import { createConfiguredChartView } from './price_chart_view/chart_configuration.js';
import { create_cloud_management_view } from './cloud_management_view/cloud_management_view_printer.js';
import { getChosenDatasetView } from '../state_stores/dataset_view_choice_saver.js';
import { getDatasetViewContainerId, getDatasetViewDefinition } from './dataset_view_registry.js';

const DATASET_VIEW_RENDERERS = {
    article_view: { commitRows: commitCardRows, create: (tableName, columns, data, _types, options) => create_article_view(columns, data, tableName, options) },
    table: {
        commitRows: commitTableRows,
        create: (table_name, columns, data, data_types) => {
            const tableElement = create_table_element(
                columns,
                data,
                table_name,
                data_types
            );
            // applySavedColumnVisibility(tableElement);
            return tableElement;
        },
    },
    card: {
        commitRows: commitCardRows,
        create: async (table_name, columns, data, _types, options) => {
            //   console.log('view_dataset.js: card create kutsuu create_card_view');
            return await create_card_view(columns, data, table_name, options);
            // Note: create_card_view does not (yet) accept a data_types argument;
            // it reads data types from localStorage.
        },
    },
    product_card: {
        commitRows: commitOwnedRows,
        create: (table_name, columns, data, data_types) => {
            return create_product_card_view(table_name, columns, data, data_types);
        },
    },
    calendar: {
        commitRows: commitOwnedRows,
        create: (table_name, columns, data, data_types) => {
            return create_calendar_view(table_name, columns, data, data_types);
        },
    },
    map: {
        commitRows: retainInitialRows,
        create: (table_name, columns, data, data_types) => {
            return create_map_view(table_name, columns, data, data_types);
        },
    },
    price_chart: {
        commitRows: commitOwnedRows,
        create: (table_name, columns, data, data_types, options) => {
            return createConfiguredChartView(table_name, columns, data, data_types, options);
        },
    },
    tree: {
        commitRows: commitOwnedRows,
        create: async (table_name, columns, data, data_types) => {
            //   console.log('view_dataset.js: tree create kutsuu create_tree_view');
            return await create_tree_view(table_name, columns, data, data_types);
        },
    },
    normal: {
        commitRows: commitComponentRows,
        create: (table_name, columns, data, data_types) => {
            const headers = columns.map((c) => ({ label: c, key: c }));
            const tableComp = new TableComponent({
                data,
                headers,
                table_name: table_name, // ★ passed to component
                initialView: "normal",
                dataTypes: data_types,
            });
            return tableComp.getElement();
        },
    },

    /* ---------- TRANSPOSED VIEW --------------------------------- */
    transposed: {
        commitRows: commitComponentRows,
        create: (table_name, columns, data, data_types) => {
            const headers = columns.map((c) => ({ label: c, key: c }));
            const tableComp = new TableComponent({
                data,
                headers,
                table_name: table_name, // ★
                initialView: "transposed",
                dataTypes: data_types,
            });
            return tableComp.getElement();
        },
    },

    /* ---------- TICKET VIEW ------------------------------------- */
    ticket: {
        commitRows: commitComponentRows,
        create: (table_name, columns, data, data_types) => {
            const headers = columns.map((c) => ({ label: c, key: c }));
            const tableComp = new TableComponent({
                data,
                headers,
                table_name: table_name, // ★
                initialView: "ticket",
                dataTypes: data_types,
            });
            return tableComp.getElement();
        },
    },

    /* ---------- SETTINGS-VIEW ----------------------------------- */
    settings: {
        commitRows: commitOwnedRows,
        create: (table_name, columns, data, data_types) => {
            return create_settings_view(table_name, columns, data, data_types);
        },
    },
    cloud_management: {
        commitRows: retainIndependentSurface,
        create: (table_name, columns, data, data_types) => {
            return create_cloud_management_view(table_name, columns, data, data_types);
        },
    },
};

export function createDatasetViewElement(viewDefinition, tableName, columns, data, dataTypes, options) {
    const renderer = DATASET_VIEW_RENDERERS[viewDefinition?.rendererKey];
    if (!renderer?.create) {
        console.warn(`Unknown view: ${viewDefinition?.viewKey}`);
        return null;
    }
    return renderer.create(tableName, columns, data, dataTypes, options);
}

/**
 * Commits one listing batch through its renderer's policy.
 * Pagination owns deduplication, raw offsets and retained projections. This
 * boundary owns only the visible rows, and guards the exact surface across
 * asynchronous work. Empty replacement is a real commit; empty append is inert.
 * Map retains its initial output until WL162 batch 5 replaces that explicit
 * policy. A retained answer preserves its existing paging behavior.
 * @param {string} tableName
 * @param {object[]} rows Already deduplicated against the committed prefix.
 * @param {{mode?: 'replace'|'append', viewKey?: string, container?: HTMLElement,
 *   isCurrent?: () => boolean, dataTypes?: object, onBuildFailure?: () => void}} options
 * @returns {Promise<'committed'|'retained'|null>} null means missing/abandoned.
 */
export async function commitDatasetViewRows(tableName, rows, {
    mode = 'append', viewKey = getChosenDatasetView(tableName) || 'table',
    container = document.getElementById(getDatasetViewContainerId(viewKey, tableName)),
    isCurrent, dataTypes, onBuildFailure,
} = {}) {
    if (!['replace', 'append'].includes(mode)) throw new Error(`Unknown row commit mode: ${mode}`);
    const canCommit = () => (!isCurrent || isCurrent()) && container?.isConnected
        && document.getElementById(getDatasetViewContainerId(viewKey, tableName)) === container
        && (getChosenDatasetView(tableName) || 'table') === viewKey;
    if (!canCommit()) return null;
    const renderer = DATASET_VIEW_RENDERERS[getDatasetViewDefinition(viewKey)?.rendererKey];
    if (!renderer?.commitRows) return null;
    const outcome = await renderer.commitRows({ tableName, rows, container,
        append: mode === 'append', isCurrent: canCommit, dataTypes, onBuildFailure });
    return canCommit() ? outcome : null;
}

function commitTableRows({ tableName, container, rows, append }) {
    const table = container.querySelector('table');
    if (!table) return null;
    if (append && rows.length === 0) return 'committed';
    const columns = JSON.parse(table.dataset.columns);
    const dataTypes = JSON.parse(table.dataset.dataTypes);
    if (!append) {
        const tbody = table.querySelector('tbody');
        if (tbody) tbody.replaceChildren();
        else table.appendChild(document.createElement('tbody'));
    }
    appendDataToTable(table, rows, columns, dataTypes, tableName);
    return 'committed';
}

async function commitCardRows({ tableName, container, rows, append, isCurrent, dataTypes, onBuildFailure }) {
    const cardContainer = container.querySelector('.card_container');
    if (!cardContainer) return null;
    if (append && rows.length === 0) return 'committed';
    const ownsCards = () => isCurrent() && cardContainer.isConnected
        && container.querySelector('.card_container') === cardContainer;
    const columns = JSON.parse(localStorage.getItem(`${tableName}_columns`)) || [];
    const options = { isCurrent: ownsCards, dataTypes };
    if (append) {
        await appendDataToCardView(cardContainer, columns, rows, tableName, options);
        return ownsCards() ? 'committed' : null;
    }
    // WL103: one off-screen build and one swap; keep shared category controls.
    const replacement = document.createElement('div');
    replacement.className = 'card_container';
    try {
        await appendDataToCardView(replacement, columns, rows, tableName, options);
        if (!ownsCards()) return null;
        const controls = [...cardContainer.children].filter(child => child.classList.contains('card_top_controls'));
        [...cardContainer.children].filter(child => !controls.includes(child)).forEach(disposeCardResources);
        cardContainer.replaceChildren(...controls, ...replacement.childNodes);
        notifyCardsMounted(cardContainer);
        return 'committed';
    } catch (error) {
        if (!ownsCards()) return null;
        onBuildFailure?.();
        showDatasetResultBuildFailure(tableName, container, error);
        throw error;
    } finally {
        disposeCardResources(replacement);
    }
}

function commitComponentRows({ container, rows, append }) {
    const component = container.querySelector('.table-component-root')?.tableComponentInstance;
    if (!component) return null;
    if (append && rows.length === 0) return 'committed';
    if (append) component.appendData(rows);
    else component.setData(rows);
    return 'committed';
}

async function commitOwnedRows({ container, rows, append, isCurrent }) {
    const root = [...container.querySelectorAll('[data-dataset-row-committer]')]
        .find(element => typeof element.commitDatasetRows === 'function');
    if (!root) return null;
    if (append && rows.length === 0) return 'committed';
    const ownsRoot = () => isCurrent() && root.isConnected && container.contains(root);
    const committed = await root.commitDatasetRows(rows, { append, isCurrent: ownsRoot });
    if (!ownsRoot()) return null;
    return committed === false ? null : 'committed';
}

// These views deliberately keep their current output in this interface batch.
function retainInitialRows() { return 'retained'; }

// Cloud operations load their own status endpoint; listing rows are not inputs.
function retainIndependentSurface() { return 'retained'; }
