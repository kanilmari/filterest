// history_navigation_handler.js
// Responds to browser popstate events and restores the correct table or view state.
// Bridges the History API with the navigation engine (handle_all_navigation, setUnifiedTableState).
// Exists to decouple history restoration logic from the main navigation entry point.

import { handleImageFirstViewHistory } from "./image_first_view_history.js";
import { HISTORY_ENTRY_ID, getHistoryDatasetView, writeHistoryEntry } from "./history_entry_state.js";
import { canRestoreCardArticleReturn, restoreCardArticleReturn, getCardArticleReturnToken, refreshCardArticleReturnViewport } from "./card_article_return_state.js";
import { custom_views } from '../admin_and_user_tools/custom_view_reader.js';
import { setParams, DATASET_PREFIX, parseTableQueryString } from './query_params.js';
import { handle_all_navigation } from './navigation_handler.js';
import {
    getUnifiedTableState,
    invalidateTableRefresh,
    setUnifiedTableState,
} from '../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js';
import { closeRowArticle } from '../../table_views/card_view/row_article_ui_handler.js';
import {
    ARTICLE_VIEW_KEY,
    resolveDatasetViewSelectionTarget,
} from '../../table_views/dataset_view_registry.js';
import {
    getPrefixFromPathname,
    parseDeepLink,
    buildParamsFromParsed,
    isDatasetBasePath,
} from './history_navigation_handler_helpers.js';

function getTargetView(datasetName, parsed) {
    const view = parsed.view || getHistoryDatasetView(datasetName);
    return view ? resolveDatasetViewSelectionTarget(view) : null;
}

function targetViewNeedsRender(datasetName, parsed) {
    const targetView = getTargetView(datasetName, parsed);
    const renderedView = document.getElementById(`${datasetName}_container`)
        ?.querySelector('.tab_parts_container')?.dataset.view;
    return Boolean(targetView && targetView !== renderedView);
}

function applyParsedUrlState(datasetName, parsed) {
    const params = buildParamsFromParsed(parsed);
    setParams(datasetName, params);

    const targetView = getTargetView(datasetName, parsed);
    if (targetView) localStorage.setItem(`${datasetName}_view`, targetView);

    return params;
}

function clearClosedArticleState(datasetName) {
    setUnifiedTableState(datasetName, {
        articleView: {
            collapsed: false,
            expandedId: null,
            pendingAutoOpenFirstRenderedResult: false,
            pendingAutoOpenFirstSearchResult: false,
        },
    });
}

async function restoreDatasetBasePathState(datasetName, isCurrentNavigation) {
    if (!isCurrentNavigation()) return true;
    const parsed = parseTableQueryString(window.location.search);
    applyParsedUrlState(datasetName, parsed);

    const targetView = getTargetView(datasetName, parsed);
    if (!targetView && await restoreArticleReturnView(datasetName, isCurrentNavigation)) {
        return true;
    }

    if (!isCurrentNavigation()) return true;
    if (targetView === ARTICLE_VIEW_KEY) {
        // Older entries can describe a collection article after its selected
        // row closes. Its full-size summaries are not a card presentation.
        // Restore only the actual recorded return view; otherwise reopen the
        // literal article view (its first row replaces this same entry).
        const returnView = getArticleReturnView(datasetName);
        const nextView = returnView || ARTICLE_VIEW_KEY;
        localStorage.setItem(`${datasetName}_view`, nextView);
        setParams(datasetName, { ...buildParamsFromParsed(parsed), view: nextView });
        clearClosedArticleState(datasetName);
        const result = await handle_all_navigation(datasetName, custom_views, {
            skipUrlUpdate: true, isCurrentNavigation, forceReload: true,
        });
        if (returnView && !result?.abort && isCurrentNavigation()) {
            // Permission and capability checks may have selected a fallback.
            const effectiveView = resolveDatasetViewSelectionTarget(localStorage.getItem(`${datasetName}_view`) || returnView);
            setParams(datasetName, { ...buildParamsFromParsed(parsed), view: effectiveView });
            const url = new URL(window.location.href);
            url.searchParams.set("view", effectiveView);
            writeHistoryEntry(url.pathname + url.search + url.hash, {}, { replace: true });
        }
        return true;
    }
    clearClosedArticleState(datasetName);
    if (targetView && targetView !== ARTICLE_VIEW_KEY) {
        await handle_all_navigation(datasetName, custom_views, {
            skipUrlUpdate: true,
            isCurrentNavigation,
            forceReload: targetViewNeedsRender(datasetName, parsed),
        });
        return true;
    }

    return false;
}

function getArticleReturnView(datasetName) {
    const returnView = getUnifiedTableState(datasetName)?.articleView?.returnView;
    return typeof returnView === 'string' && returnView && returnView !== ARTICLE_VIEW_KEY
        ? returnView
        : null;
}

async function restoreArticleReturnView(datasetName, isCurrentNavigation) {
    if (!isCurrentNavigation()) return true;
    const returnView = getArticleReturnView(datasetName);
    if (!returnView) {
        return false;
    }

    localStorage.setItem(`${datasetName}_view`, returnView);
    setUnifiedTableState(datasetName, {
        articleView: {
            collapsed: false,
            expandedId: null,
            returnView: null,
        },
    });
    await handle_all_navigation(datasetName, custom_views, {
        skipUrlUpdate: true,
        isCurrentNavigation,
        forceReload: true,
    });
    return true;
}

window.addEventListener('popstate', async () => {
    const targetEntryId = history.state?.[HISTORY_ENTRY_ID] ?? null;
    const targetURL = window.location.href;
    const isCurrentNavigation = () => window.location.href === targetURL
        && (history.state?.[HISTORY_ENTRY_ID] ?? null) === targetEntryId;
    const targetPrefix = getPrefixFromPathname(window.location.pathname, DATASET_PREFIX);
    const target = targetPrefix ? parseDeepLink(window.location.pathname.slice(targetPrefix.length)) : null;
    if (await handleImageFirstViewHistory({
        tableName: target?.name, rowId: target?.deepLinkedRowId, isCurrentNavigation,
    })) return;
    if (!isCurrentNavigation()) return;
    if (target?.name && !target.deepLinkedRowId && canRestoreCardArticleReturn(target.name)) {
        const datasetName = target.name;
        await handle_all_navigation(datasetName, custom_views, {
            skipUrlUpdate: true,
            isCurrentNavigation,
            forceReload: true,
            restoreMountedView: {
                isCurrent: () => canRestoreCardArticleReturn(datasetName),
                commit: () => {
                    invalidateTableRefresh(datasetName);
                    const wrapper = document.getElementById(datasetName + "_article_view_container")
                        ?.querySelector(".card_view_wrapper.big-card-open");
                    const article = wrapper?.querySelector(".active_row_article, .active_big_card");
                    const cards = wrapper?.querySelector(".card_container");
                    if (article && cards) closeRowArticle(wrapper, cards, article, null, datasetName, true, { restoreScroll: false });
                    window.__bigCardClosing = false;
                    applyParsedUrlState(datasetName, parseTableQueryString(window.location.search));
                    return restoreCardArticleReturn(datasetName);
                },
            },
        });
        return;
    }
    // If a big card is open, close it first to clean up DOM and restore scroll
    const openCardWrapper = document.querySelector('.card_view_wrapper.big-card-open');
    if (openCardWrapper) {
        const activeBigCard = openCardWrapper.querySelector('.active_row_article, .active_big_card');
        const cardContainer = openCardWrapper.querySelector('.card_container');
        const baseDataset =
            openCardWrapper.dataset?.tableName ||
            activeBigCard?._table_name ||
            null;

        if (activeBigCard && cardContainer) {
            // skipHistoryBack avoids an extra history.back() because popstate already moved history
            closeRowArticle(openCardWrapper, cardContainer, activeBigCard, null, baseDataset, true);
        } else {
            // Fallback: ensure wrapper isn't stuck in open state
            openCardWrapper.classList.remove('big-card-open');
        }

        // If we navigated back within the same dataset, no further navigation is needed
        const pathAfterPop = window.location.pathname;
        if (baseDataset && isDatasetBasePath(pathAfterPop, DATASET_PREFIX, baseDataset)) {
            window.__bigCardClosing = false; // ensure flag reset if it was set elsewhere
            if (await restoreDatasetBasePathState(baseDataset, isCurrentNavigation)) {
                return;
            }
            return;
        }
    }
    // If closeRowArticle triggered history.back(), skip re-navigation
    // because the card DOM is already cleaned up.
    if (window.__bigCardClosing) {
        window.__bigCardClosing = false;
        const pathAfterClose = window.location.pathname;
        const closePrefix = getPrefixFromPathname(pathAfterClose, DATASET_PREFIX);
        if (closePrefix) {
            const { name: closedDatasetName } = parseDeepLink(pathAfterClose.slice(closePrefix.length));
            if (
                closedDatasetName
                && isDatasetBasePath(pathAfterClose, DATASET_PREFIX, closedDatasetName)
                && await restoreDatasetBasePathState(closedDatasetName, isCurrentNavigation)
            ) {
                return;
            }
        }
        return;
    }
    const path = window.location.pathname;
    const prefix = getPrefixFromPathname(path, DATASET_PREFIX);
    if (!prefix) return;

    const rawName = path.slice(prefix.length);
    const { name, deepLinkedRowId } = parseDeepLink(rawName);

    const parsed = parseTableQueryString(window.location.search);
    if (deepLinkedRowId) refreshCardArticleReturnViewport(name);
    applyParsedUrlState(name, parsed);

    const preserveCardReturn = deepLinkedRowId ? getCardArticleReturnToken(name) : null;
    // Pre-set cardView state to auto-open big card after data loads
    if (deepLinkedRowId) {
        localStorage.setItem(`${name}_view`, ARTICLE_VIEW_KEY);
        setUnifiedTableState(name, {
            articleView: { collapsed: true, expandedId: deepLinkedRowId, ...(preserveCardReturn ? { returnView: "card" } : {}) }
        });
    } else {
        clearClosedArticleState(name);
    }

    await handle_all_navigation(name, custom_views, {
        skipUrlUpdate: true,
        isCurrentNavigation,
        forceReload: Boolean(deepLinkedRowId) || targetViewNeedsRender(name, parsed),
        ...(preserveCardReturn ? { preserveCardReturn } : {}),
    });
});
