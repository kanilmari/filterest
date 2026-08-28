// big_card_child_tabs.js
// Builds the horizontal reverse-FK tab bar shown below a big card modal.
// Bridges referring-row datasets and comments with a configurable, ordered tab UI.
// Exists to surface related rows from linked tables in a single panel beneath any article view.

import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { createRelatedRecordCard, getRelatedRecordDisplayName } from './child_card_formatter.js';
import { format_column_name } from './card_field_formatter.js';
import { DATASET_PREFIX, setParams } from '../../navigation/nav_engine/query_params.js';
import { getTranslationForKey } from '../../lang/translation_handler.js';
import {
    hasDatasetPermission,
    primeDatasetPermissions,
    primeMultipleDatasetPermissions,
} from '../../route_permission_checker.js';
import { showConfirmModal } from '../../../reusable_components/modal/confirm_modal_builder.js';
import {
    showErrorToast,
    showSuccessToast,
} from '../../../reusable_components/notifications/toast_notification_printer.js';
import { buildConfirmationMessage } from '../../general_tables/gt_1_row_crud/gt_1_4_row_delete/row_remover_helpers.js';
import { setUnifiedTableState } from '../../state_stores/table_state_store.js';
import { handle_all_navigation } from '../../navigation/nav_engine/navigation_handler.js';
import { custom_views } from '../../navigation/admin_and_user_tools/custom_view_reader.js';
import { closeRowArticle } from './row_article_ui_handler.js';
import {
    buildRelatedDatasetParams,
    buildRelatedTabKey,
    findMatchingRelatedTableEntry,
    getRelatedTableFilterValue,
    getRelatedTableRowCount,
    getRelatedTableReferenceDirection,
    isBridgeRelationTable,
    isOutgoingRelatedTable,
    shouldHandleSpaNavigationClick,
    shouldLazyLoadRelatedTableRows,
} from './big_card_child_tabs_helpers.js';

/**
 * Builds a horizontal tab bar for FK-referring tables plus the comments tab.
 * Each reverse-FK dataset gets one tab. Comments tab is last.
 * Returns null if there are no referring datasets and no logged-in user (for comments).
 *
 * @param {Array} related_tables - from fetchDynamicChildren response child_tables payload
 * @param {string} table_name - parent table name
 * @param {number|string} row_id - parent row id
 * @param {number|null} current_user_id - logged-in user id
 * @returns {HTMLElement|null} tab container element
 */
export async function buildRelatedTabs(
    related_tables,
    table_name,
    row_id,
    current_user_id,
    preferred_active_tab_key = null,
    options = {}
) {
    const renderableRelatedTables = related_tables.filter((relatedTable) => !isBridgeRelationTable(relatedTable));
    let tabsWithRows = renderableRelatedTables.filter((relatedTable) => getRelatedTableRowCount(relatedTable) > 0);
    const has_comments = !!current_user_id;

    if (tabsWithRows.length === 0 && !has_comments) {
        return null;
    }

    const preloadedRelatedDatasets = [...new Set(
        renderableRelatedTables
            .map((relatedTable) => String(relatedTable?.dataset || '').trim())
            .filter(Boolean)
    )];
    const primeDeleteRightsPromise = preloadedRelatedDatasets.length > 1
        ? primeMultipleDatasetPermissions(
            preloadedRelatedDatasets.map((datasetName) => ({
                dataset: datasetName,
                routes: ['/api/delete-rows'],
            }))
        )
        : preloadedRelatedDatasets.length === 1
            ? primeDatasetPermissions(preloadedRelatedDatasets[0], ['/api/delete-rows'])
            : Promise.resolve(new Map());
    const deleteRightPromisesByDataset = new Map(
        preloadedRelatedDatasets.map((datasetName) => {
            return [
                datasetName,
                (async () => {
                    await primeDeleteRightsPromise;
                    return hasDatasetPermission('/api/delete-rows', datasetName);
                })(),
            ];
        })
    );

    // Fetch child tab config in parallel with dataset delete-right priming.
    let configMap = {};
    try {
        const config = await endpoint_router('getChildTabConfig', { url_params: table_name });
        if (Array.isArray(config)) {
            config.forEach((tabConfig) => {
                configMap[tabConfig.tab_key] = tabConfig;
            });
        }
    } catch { /* no config — use defaults */ }

    // Filter hidden related tabs
    tabsWithRows = tabsWithRows.filter((relatedTable) => {
        const cfg = configMap[relatedTable.dataset];
        return !cfg || !cfg.hidden;
    });

    // Sort by config tab_order (unconfigured tabs go to end)
    tabsWithRows.sort((a, b) => {
        const oa = configMap[a.dataset]?.tab_order ?? 9999;
        const ob = configMap[b.dataset]?.tab_order ?? 9999;
        return oa - ob;
    });

    const comments_hidden = configMap.__comments?.hidden;
    if (tabsWithRows.length === 0 && (!has_comments || comments_hidden)) {
        return null;
    }

    const uniqueRelatedDatasets = [...new Set(tabsWithRows.map((relatedTable) => relatedTable.dataset))];
    const deleteRightByDataset = new Map(
        await Promise.all(
            uniqueRelatedDatasets.map(async (datasetName) => ([
                datasetName,
                await (deleteRightPromisesByDataset.get(datasetName)
                    || hasDatasetPermission('/api/delete-rows', datasetName)),
            ]))
        )
    );

    const container = document.createElement('div');
    container.classList.add('related_tabs_container', 'child_tabs_container');

    const tab_bar = document.createElement('nav');
    tab_bar.classList.add('related_tabs_bar', 'child_tabs_bar');

    const tab_content = document.createElement('div');
    tab_content.classList.add('related_tabs_content', 'child_tabs_content');

    const fetchDynamicChildren = ({
        childTable = "",
        forceRefresh = false,
    } = {}) => {
        if (typeof options?.fetchDynamicChildren === "function") {
            return options.fetchDynamicChildren({ childTable, forceRefresh });
        }

        return endpoint_router('fetchDynamicChildren', {
            method: 'POST',
            url_params: `?dataset=${table_name}`,
            body_data: {
                parent_dataset: table_name,
                parent_pk_value: String(row_id),
                ...(childTable ? { child_table: childTable } : {}),
            },
        });
    };

    const reloadRelatedTabs = async (nextActiveTabKey = null) => {
        try {
            const fresh = await fetchDynamicChildren({
                forceRefresh: true,
            });
            const nextTabs = await buildRelatedTabs(
                fresh?.child_tables || [],
                table_name,
                row_id,
                current_user_id,
                nextActiveTabKey,
                options
            );
            if (nextTabs) {
                container.replaceWith(nextTabs);
            } else {
                container.remove();
            }
        } catch (err) {
            console.warn('related tab reload error:', err.message);
            showErrorToast(getTranslationForKey('delete_failed') || 'Poisto ei onnistunut.');
        }
    };

    const activate_tab = (btn, panel) => {
        tab_bar.querySelectorAll('.related_tab_button').forEach((tabButton) => tabButton.classList.remove('active'));
        tab_content.querySelectorAll('.related_tab_panel').forEach((tabPanel) => tabPanel.classList.remove('active'));
        btn.classList.add('active');
        panel.classList.add('active');
    };

    let first_tab = true;

    // ── Related table tabs ──────────────────────────
    for (const relatedTable of tabsWithRows) {
        const tab_key = buildRelatedTabKey(relatedTable);
        const initialRows = Array.isArray(relatedTable.rows) ? relatedTable.rows : [];
        const initialRowCount = getRelatedTableRowCount(relatedTable);
        const can_delete_rows = !isOutgoingRelatedTable(relatedTable)
            && deleteRightByDataset.get(relatedTable.dataset) === true;
        let relatedDataTypes = getRelatedTableDataTypes(relatedTable);
        let relatedRowsLoaded = !shouldLazyLoadRelatedTableRows(relatedTable);
        let relatedRowsLoadPromise = null;

        const label = format_column_name(relatedTable.dataset);
        const btn = document.createElement('button');
        btn.classList.add('related_tab_button', 'child_tab_button');
        btn.dataset.tabKey = tab_key;
        const labelSpan = document.createElement('span');
        labelSpan.classList.add('related_tab_dataset_label');
        labelSpan.dataset.langKey = relatedTable.dataset;
        labelSpan.textContent = label;
        const countSpan = document.createElement('span');
        countSpan.classList.add('related_tab_count');
        btn.append(labelSpan, document.createTextNode(' ('), countSpan, document.createTextNode(')'));
        const updateTabButtonLabel = (nextCount = initialRowCount) => {
            countSpan.textContent = String(nextCount);
        };
        updateTabButtonLabel(initialRowCount);

        const panel = document.createElement('div');
        panel.classList.add('related_tab_panel', 'child_tab_panel');
        panel.dataset.tabKey = tab_key;

        const relatedDatasetParams = buildRelatedDatasetParams(
            relatedTable.column,
            getRelatedTableFilterValue(relatedTable, row_id)
        );
        const link = document.createElement('a');
        link.href = `${DATASET_PREFIX}${relatedTable.dataset}?${new URLSearchParams(relatedDatasetParams).toString()}`;
        link.rel = 'noopener';
        link.classList.add('related_tab_open_link', 'child_tab_open_link');
        link.textContent = getTranslationForKey('open') || 'Avaa';
        link.addEventListener('click', async (event) => {
            if (!shouldHandleSpaNavigationClick(event)) {
                return;
            }

            event.preventDefault();
            closeCurrentBigCard(table_name, row_id, container);
            setParams(relatedTable.dataset, relatedDatasetParams);
            await handle_all_navigation(relatedTable.dataset, custom_views, {
                forceReload: true,
            });
        });
        panel.appendChild(link);

        const row_list = document.createElement('div');
        row_list.classList.add('comment_list', 'related_record_list', 'child_record_list');
        const renderRelatedRows = (rowsToRender = [], totalRowCount = initialRowCount) => {
            row_list.replaceChildren();

            if (rowsToRender.length > 0) {
                row_list.appendChild(createRelatedRecordListHeader(can_delete_rows));
            }

            rowsToRender.forEach((relatedRow) => row_list.appendChild(createRelatedRecordCard(relatedRow, {
                dataTypes: relatedDataTypes,
                onOpen: relatedRow?.id != null
                    ? async () => openRelatedRecord({
                        relatedDataset: relatedTable.dataset,
                        relatedRow,
                        parentDataset: table_name,
                        parentRowId: row_id,
                        relatedTabsContainer: container,
                    })
                    : null,
                onDelete: can_delete_rows && relatedRow?.id != null
                    ? async () => deleteRelatedRecord({
                        relatedDataset: relatedTable.dataset,
                        relatedRow,
                        dataTypes: relatedDataTypes,
                        tabKey: tab_key,
                        reloadRelatedTabs,
                    })
                    : null,
            })));

            if (rowsToRender.length === 0) {
                const empty = document.createElement('div');
                empty.classList.add('comment_empty');
                empty.textContent = getTranslationForKey('no_results') || 'Ei riveja';
                row_list.appendChild(empty);
            }

            updateTabButtonLabel(totalRowCount);
        };
        panel.appendChild(row_list);

        const more = document.createElement('div');
        more.classList.add('related_tab_limit_notice', 'child_tab_limit_notice');
        more.textContent = getTranslationForKey('showing_first_50') || 'Naytetaan ensimmaiset 50 rivia';
        more.hidden = true;
        panel.appendChild(more);

        const syncLimitNotice = (totalRowCount, loadedRowCount) => {
            more.hidden = !(loadedRowCount >= 50 || totalRowCount > loadedRowCount);
        };

        const loadRelatedRows = async () => {
            if (relatedRowsLoaded) {
                return;
            }
            if (relatedRowsLoadPromise) {
                return relatedRowsLoadPromise;
            }

            row_list.replaceChildren();
            const loading = document.createElement('div');
            loading.classList.add('comment_empty');
            loading.textContent = getTranslationForKey('loading') || 'Ladataan...';
            row_list.appendChild(loading);
            more.hidden = true;

            relatedRowsLoadPromise = fetchDynamicChildren({
                childTable: relatedTable.dataset,
            }).then((fresh) => {
                const freshChild = findMatchingRelatedTableEntry(
                    fresh?.child_tables || [],
                    relatedTable.dataset,
                    relatedTable.column,
                    getRelatedTableReferenceDirection(relatedTable),
                ) || relatedTable;
                const nextRows = Array.isArray(freshChild?.rows) ? freshChild.rows : [];
                const nextCount = getRelatedTableRowCount(freshChild);
                relatedDataTypes = getRelatedTableDataTypes(freshChild, relatedDataTypes);
                renderRelatedRows(nextRows, nextCount);
                syncLimitNotice(nextCount, nextRows.length);
                relatedRowsLoaded = true;
            }).catch((err) => {
                console.warn('related tab lazy-load error:', err.message);
                row_list.replaceChildren();
                const failed = document.createElement('div');
                failed.classList.add('comment_empty');
                failed.textContent = getTranslationForKey('load_failed') || 'Lataus epaonnistui';
                row_list.appendChild(failed);
                more.hidden = true;
            }).finally(() => {
                relatedRowsLoadPromise = null;
            });

            return relatedRowsLoadPromise;
        };

        if (relatedRowsLoaded) {
            renderRelatedRows(initialRows, initialRowCount);
            syncLimitNotice(initialRowCount, initialRows.length);
        } else {
            more.hidden = true;
        }

        if (preferred_active_tab_key && preferred_active_tab_key === tab_key) {
            btn.classList.add('active');
            panel.classList.add('active');
            if (!relatedRowsLoaded) void loadRelatedRows();
            first_tab = false;
        } else if (first_tab) {
            btn.classList.add('active');
            panel.classList.add('active');
            if (!relatedRowsLoaded) void loadRelatedRows();
            first_tab = false;
        }

        btn.addEventListener('click', () => {
            activate_tab(btn, panel);
            if (!relatedRowsLoaded) void loadRelatedRows();
        });
        tab_bar.appendChild(btn);
        tab_content.appendChild(panel);
    }

    // ── Comments tab ──────────────────────────────
    if (has_comments && !comments_hidden) {
        const btn = document.createElement('button');
        btn.classList.add('related_tab_button', 'child_tab_button');
        btn.textContent = getTranslationForKey('comments') || 'Kommentit';
        btn.dataset.tabKey = '__comments';

        const panel = document.createElement('div');
        panel.classList.add('related_tab_panel', 'child_tab_panel', 'comments_tab_panel');
        panel.dataset.tabKey = '__comments';

        // Comment form
        const form = document.createElement('div');
        form.classList.add('comment_form');

        const textarea = document.createElement('textarea');
        textarea.classList.add('comment_input');
        textarea.placeholder = getTranslationForKey('write_comment') || 'Kirjoita kommentti...';
        textarea.maxLength = 5000;
        textarea.rows = 3;

        const submit_btn = document.createElement('button');
        submit_btn.classList.add('comment_submit');
        submit_btn.textContent = getTranslationForKey('send') || 'Lähetä';

        form.appendChild(textarea);
        form.appendChild(submit_btn);
        panel.appendChild(form);

        // Comment list container
        const comment_list = document.createElement('div');
        comment_list.classList.add('comment_list');
        panel.appendChild(comment_list);

        let comments_loaded = false;

        const load_comments = async () => {
            try {
                const data = await endpoint_router('fetchComments', {
                    url_params: `?dataset=${table_name}&row_id=${row_id}&page=1`,
                });
                comment_list.replaceChildren();
                const comments = data?.comments || [];
                comments.forEach(c => comment_list.appendChild(
                    render_comment(c, current_user_id, table_name, row_id, load_comments)
                ));
                if (comments.length === 0) {
                    const empty = document.createElement('div');
                    empty.classList.add('comment_empty');
                    empty.textContent = getTranslationForKey('no_comments') || 'Ei kommentteja';
                    comment_list.appendChild(empty);
                }
                // Update tab button count
                btn.textContent = `${getTranslationForKey('comments') || 'Kommentit'} (${comments.length})`;
                comments_loaded = true;
            } catch (err) {
                console.warn('comment load error:', err.message);
            }
        };

        // Submit handler
        submit_btn.addEventListener('click', async () => {
            const text = textarea.value.trim();
            if (!text) return;
            submit_btn.disabled = true;
            try {
                await endpoint_router('createComment', {
                    method: 'POST',
                    body_data: {
                        dataset: table_name,
                        row_id: Number(row_id),
                        comment_text: text,
                    },
                });
                textarea.value = '';
                await load_comments();
            } catch (err) {
                console.warn('comment create error:', err.message);
            } finally {
                submit_btn.disabled = false;
            }
        });

        // Lazy-load on first click
        if (preferred_active_tab_key === '__comments') {
            btn.classList.add('active');
            panel.classList.add('active');
            load_comments();
            first_tab = false;
        } else if (first_tab) {
            btn.classList.add('active');
            panel.classList.add('active');
            load_comments();
            first_tab = false;
        }

        btn.addEventListener('click', () => {
            activate_tab(btn, panel);
            if (!comments_loaded) load_comments();
        });

        tab_bar.appendChild(btn);
        tab_content.appendChild(panel);
    }

    container.appendChild(tab_bar);
    container.appendChild(tab_content);
    return container;
}

export const buildChildTabs = buildRelatedTabs;
export const buildRowArticleRelatedTabs = buildRelatedTabs;

async function deleteRelatedRecord({
    relatedDataset,
    relatedRow,
    dataTypes = {},
    tabKey,
    reloadRelatedTabs,
}) {
    const itemName = getRelatedRecordDisplayName(relatedRow, { dataTypes });
    const { messageLangKey, messagePlainText } = buildConfirmationMessage(1, Boolean(itemName));

    const ok = await showConfirmModal({
        titleLangKey: 'delete_confirm_title',
        titlePlainText: 'Vahvista poisto',
        messageLangKey,
        messagePlainText,
        confirmLangKey: 'delete',
        confirmText: 'Poista',
        cancelLangKey: 'dont_delete',
        cancelText: 'Älä poista',
        isDanger: true,
        itemNames: itemName ? [itemName] : null,
    });
    if (!ok) return;

    try {
        await endpoint_router('deleteRows', {
            method: 'POST',
            url_params: `?dataset=${relatedDataset}`,
            body_data: { ids: [relatedRow.id] },
        });
        showSuccessToast(getTranslationForKey('delete_success') || 'Kohde poistettu.');
        await reloadRelatedTabs(tabKey);
    } catch (err) {
        console.warn('related row delete error:', err.message);
        showErrorToast(getTranslationForKey('delete_failed') || 'Poisto ei onnistunut.');
    }
}

function getRelatedTableDataTypes(relatedTable, fallback = {}) {
    const dataTypes = relatedTable?.types || relatedTable?.data_types || relatedTable?.column_types;
    if (dataTypes && typeof dataTypes === 'object' && !Array.isArray(dataTypes)) {
        return dataTypes;
    }
    return fallback;
}

function createRelatedRecordListHeader(hasActions = false) {
    const header = document.createElement('div');
    header.classList.add('related_record_list_header', 'child_record_list_header');

    [
        { label: getRelatedHeaderLabel('id', 'ID'), modifier: 'id' },
        { label: getRelatedHeaderLabel('name', 'Nimi'), modifier: 'title' },
        { label: getRelatedHeaderLabel('created', 'Luotu'), modifier: 'created' },
        { label: getRelatedHeaderLabel('updated', 'Muokattu'), modifier: 'updated' },
    ].forEach((column) => {
        const cell = document.createElement('span');
        cell.classList.add(
            'related_record_list_header_cell',
            'child_record_list_header_cell',
            `related_record_list_header_cell--${column.modifier}`,
            `child_record_list_header_cell--${column.modifier}`,
        );
        cell.textContent = column.label;
        header.appendChild(cell);
    });

    if (hasActions) {
        const actions = document.createElement('span');
        actions.classList.add(
            'related_record_list_header_cell',
            'child_record_list_header_cell',
            'related_record_list_header_cell--actions',
            'child_record_list_header_cell--actions',
        );
        header.appendChild(actions);
    }

    return header;
}

function getRelatedHeaderLabel(langKey, fallbackText) {
    const translated = getTranslationForKey(langKey);
    return translated && translated !== langKey ? translated : fallbackText;
}

async function openRelatedRecord({
    relatedDataset,
    relatedRow,
    parentDataset,
    parentRowId,
    relatedTabsContainer,
}) {
    const relatedId = relatedRow?.id;
    if (relatedId == null) return;

    closeCurrentBigCard(parentDataset, parentRowId, relatedTabsContainer);

    setUnifiedTableState(relatedDataset, {
        cardView: { collapsed: true, expandedId: relatedId },
    });

    await handle_all_navigation(relatedDataset, custom_views, {
        forceReload: true,
        skipUrlUpdate: true,
    });
}

function closeCurrentBigCard(parentDataset, parentRowId, relatedTabsContainer) {
    const wrapper = relatedTabsContainer.closest('.card_view_wrapper');
    const bigCard = relatedTabsContainer.closest('.active_row_article, .active_big_card');
    const cardContainer = wrapper?.querySelector('.card_container');
    const selectedCard = cardContainer?.querySelector(`.card[data-id="${parentRowId}"]`) || null;

    if (wrapper && bigCard && cardContainer) {
        closeRowArticle(wrapper, cardContainer, bigCard, selectedCard, parentDataset, true);
    }
}

/**
 * Renders a single comment element.
 */
function render_comment(comment, current_user_id, table_name, row_id, reload_fn) {
    const el = document.createElement('div');
    el.classList.add('comment_item');

    const header = document.createElement('div');
    header.classList.add('comment_header');

    const author = document.createElement('span');
    author.classList.add('comment_author');
    author.textContent = comment.username || 'Unknown';

    const date = document.createElement('span');
    date.classList.add('comment_date');
    date.textContent = format_date(comment.created);

    header.appendChild(author);
    header.appendChild(date);

    // Delete button — owner or admin
    if (comment.created_by === current_user_id) {
        const del_btn = document.createElement('button');
        del_btn.classList.add('comment_delete');
        del_btn.textContent = '×';
        del_btn.title = getTranslationForKey('delete') || 'Poista';
        del_btn.addEventListener('click', async () => {
            del_btn.disabled = true;
            try {
                await endpoint_router('deleteComment', {
                    method: 'DELETE',
                    url_params: `?id=${comment.id}`,
                });
                await reload_fn();
            } catch (err) {
                console.warn('comment delete error:', err.message);
                del_btn.disabled = false;
            }
        });
        header.appendChild(del_btn);
    }

    const body = document.createElement('div');
    body.classList.add('comment_body');
    body.textContent = comment.comment_text;

    el.appendChild(header);
    el.appendChild(body);
    return el;
}

function format_date(iso_str) {
    if (!iso_str) return '';
    try {
        const parsedDate = new Date(iso_str);
        return parsedDate.toLocaleDateString('fi-FI') + ' ' + parsedDate.toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' });
    } catch {
        return iso_str;
    }
}
